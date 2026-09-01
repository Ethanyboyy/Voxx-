import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { startOfUtcDay, utcDaysAgo, utcHourBucket, ECONOMIC_TIMEZONE } from "@/lib/economic/time";
import { getPnlReport } from "@/lib/economic/pnl";
import { tickKeyFor, TICK_BUCKET_MS } from "@/lib/economic/scheduler";
import { createTestUser, seedLedgerEntry } from "./helpers";

/**
 * Time boundaries.
 *
 * The bug these replace: `startOfDay()` used `setHours(0,0,0,0)`, so the daily
 * profit floor was measured in whatever timezone the server happened to run in.
 * That made the same ledger produce different answers in different regions, and
 * a 23- or 25-hour "day" on the two DST transitions each year.
 *
 * Every assertion below is written so it holds regardless of the machine's TZ.
 * The DST cases use real transition instants in zones that observe it — if the
 * implementation ever reverts to local-time arithmetic, they break in CI on any
 * machine not running UTC, and the fixed-offset checks break everywhere.
 */

describe("startOfUtcDay", () => {
  it("returns midnight UTC, not midnight local", () => {
    const day = startOfUtcDay(new Date("2026-09-01T23:59:59.999Z"));
    expect(day.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("is stable across the whole day and flips exactly at the UTC boundary", () => {
    const first = startOfUtcDay(new Date("2026-03-14T00:00:00.000Z"));
    const last = startOfUtcDay(new Date("2026-03-14T23:59:59.999Z"));
    const next = startOfUtcDay(new Date("2026-03-15T00:00:00.000Z"));
    expect(first.toISOString()).toBe(last.toISOString());
    expect(next.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("handles the US spring-forward instant without gaining or losing an hour", () => {
    // 2026-03-08 07:00Z is 02:00 EST -> 03:00 EDT. Under setHours, "today" on
    // this date is 23 hours long in America/New_York.
    const before = startOfUtcDay(new Date("2026-03-08T06:59:59.999Z"));
    const after = startOfUtcDay(new Date("2026-03-08T07:00:00.000Z"));
    expect(before.toISOString()).toBe("2026-03-08T00:00:00.000Z");
    expect(after.toISOString()).toBe("2026-03-08T00:00:00.000Z");
  });

  it("handles the autumn fall-back instant, where a local hour repeats", () => {
    const first = startOfUtcDay(new Date("2026-11-01T05:30:00.000Z"));
    const second = startOfUtcDay(new Date("2026-11-01T06:30:00.000Z"));
    expect(first.toISOString()).toBe(second.toISOString());
  });

  it("handles month, year and leap-day boundaries", () => {
    expect(startOfUtcDay(new Date("2026-01-31T23:59:59.999Z")).toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2026-02-01T00:00:00.000Z")).toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2026-12-31T23:59:59.999Z")).toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2027-01-01T00:00:30.000Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2028-02-29T12:00:00.000Z")).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("rejects an invalid Date rather than producing an invalid boundary", () => {
    expect(() => startOfUtcDay(new Date("not a date"))).toThrow(TypeError);
  });
});

describe("utcDaysAgo", () => {
  it("subtracts exact 24-hour days, even across a DST transition", () => {
    // Seven calendar days spanning the US spring-forward. Calendar-field
    // subtraction in a DST zone gives 167 hours here; this must give 168.
    const now = new Date("2026-03-12T12:00:00.000Z");
    const sevenAgo = utcDaysAgo(now, 7);
    expect(now.getTime() - sevenAgo.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(sevenAgo.toISOString()).toBe("2026-03-05T12:00:00.000Z");
  });

  it("spans month and year boundaries by arithmetic, not by calendar fields", () => {
    expect(utcDaysAgo(new Date("2027-01-05T00:00:00.000Z"), 30).toISOString()).toBe("2026-12-06T00:00:00.000Z");
  });

  it("rejects negative or non-finite day counts", () => {
    expect(() => utcDaysAgo(new Date(), -1)).toThrow(TypeError);
    expect(() => utcDaysAgo(new Date(), NaN)).toThrow(TypeError);
    expect(() => utcDaysAgo(new Date(), Infinity)).toThrow(TypeError);
  });
});

describe("utcHourBucket / tickKeyFor", () => {
  it("is identical for every instant inside the hour and changes on the hour", () => {
    expect(tickKeyFor(new Date("2026-09-01T12:00:00.000Z"))).toBe("2026-09-01T12:00:00.000Z");
    expect(tickKeyFor(new Date("2026-09-01T12:59:59.999Z"))).toBe("2026-09-01T12:00:00.000Z");
    expect(tickKeyFor(new Date("2026-09-01T13:00:00.000Z"))).toBe("2026-09-01T13:00:00.000Z");
  });

  it("keeps producing distinct hourly keys through a DST transition", () => {
    // Under local-time bucketing, an autumn fall-back repeats a local hour and
    // two different instants collapse onto the same key — so the second hour's
    // tick would be silently skipped as "already run".
    const keys = [
      tickKeyFor(new Date("2026-11-01T05:30:00.000Z")),
      tickKeyFor(new Date("2026-11-01T06:30:00.000Z")),
    ];
    expect(new Set(keys).size).toBe(2);
  });

  it("crosses midnight, month and year boundaries cleanly", () => {
    expect(tickKeyFor(new Date("2026-12-31T23:30:00.000Z"))).toBe("2026-12-31T23:00:00.000Z");
    expect(tickKeyFor(new Date("2027-01-01T00:30:00.000Z"))).toBe("2027-01-01T00:00:00.000Z");
  });

  it("rejects a nonsensical bucket size", () => {
    expect(() => utcHourBucket(new Date(), 0)).toThrow(TypeError);
    expect(() => utcHourBucket(new Date(), -1)).toThrow(TypeError);
    expect(TICK_BUCKET_MS).toBe(60 * 60 * 1000);
  });
});

describe("P&L windows use the declared timezone", () => {
  let userId: string;
  let assetId: string;

  beforeEach(async () => {
    const user = await createTestUser();
    userId = user.id;
    const asset = await db.economicAsset.create({
      data: { userId, name: "Asset", category: "OTHER", status: "OPERATING" },
    });
    assetId = asset.id;
  });

  it("declares UTC in the report itself, so a reader is never guessing", async () => {
    const pnl = await getPnlReport(userId, new Date("2026-09-01T12:00:00Z"));
    expect(pnl.timezone).toBe(ECONOMIC_TIMEZONE);
    expect(pnl.timezone).toBe("UTC");
    expect(pnl.today.since!.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("puts a 23:59:59Z entry in today and a 00:00:00Z entry in the next day", async () => {
    const lateYesterday = new Date("2026-08-31T23:59:59.000Z");
    const earlyToday = new Date("2026-09-01T00:00:00.000Z");
    await seedLedgerEntry("revenue", { assetId, amountUsd: 11, occurredAt: lateYesterday });
    await seedLedgerEntry("revenue", { assetId, amountUsd: 22, occurredAt: earlyToday });

    const pnl = await getPnlReport(userId, new Date("2026-09-01T12:00:00Z"));
    // Only the 00:00:00Z row is "today"; the 23:59:59Z one belongs to Aug 31.
    expect(pnl.today.recorded.revenueUsd).toBe(22);
    expect(pnl.trailing7d.recorded.revenueUsd).toBe(33);
  });

  it("measures a full 24 hours on a DST transition date", async () => {
    // Spring-forward day in America/New_York. The window must still be exactly
    // one UTC day, containing both an early and a late entry.
    const now = new Date("2026-03-08T23:00:00.000Z");
    await seedLedgerEntry("revenue", { assetId, amountUsd: 5, occurredAt: new Date("2026-03-08T00:30:00.000Z") });
    await seedLedgerEntry("revenue", { assetId, amountUsd: 5, occurredAt: new Date("2026-03-08T22:30:00.000Z") });

    const pnl = await getPnlReport(userId, now);
    expect(pnl.today.recorded.revenueUsd).toBe(10);
    expect(pnl.today.since!.toISOString()).toBe("2026-03-08T00:00:00.000Z");
  });
});
