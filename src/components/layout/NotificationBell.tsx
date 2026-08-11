"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  priority: "LOW" | "NORMAL" | "HIGH";
  read: boolean;
  createdAt: string;
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2.5a4 4 0 0 0-4 4v2.2c0 .5-.16.99-.46 1.4L4.3 12.1c-.6.8 0 1.9 1 1.9h9.4c1 0 1.6-1.1 1-1.9l-1.24-2c-.3-.41-.46-.9-.46-1.4V6.5a4 4 0 0 0-4-4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 16a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setNotifications(data.notifications ?? []);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications/read-all", { method: "POST" });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-foreground hover:bg-surface-hover"
        onClick={() => setOpen((v) => !v)}
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="glass-panel-strong absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 ? (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-accent">
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            {!loaded ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Nothing yet. VOX will notify you here when it notices something.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => markRead(n.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-surface-hover",
                    !n.read && "bg-accent-muted/40"
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {!n.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
                    {n.title}
                  </span>
                  <span className="text-xs text-muted">{n.body}</span>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-border px-4 py-2">
            <Link href="/settings" className="text-xs font-medium text-accent" onClick={() => setOpen(false)}>
              Notification preferences →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
