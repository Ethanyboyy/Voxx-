"use client";

import Link from "next/link";
import { HoloBrain } from "@/components/brain/HoloBrain";
import { Button } from "@/components/ui/Button";

/**
 * The pre-auth entrance to VOX — reuses the exact same HoloBrain canvas
 * that renders the real, interactive brain at /brain (no second brain
 * visualization built for this page). Here it's shown decoratively with
 * no task data, exactly like the dashboard's BrainPreview teaser, since
 * there's no authenticated user's real state to reflect yet.
 */
export function LandingPage({ mode }: { mode: "setup" | "login" }) {
  const isSetup = mode === "setup";

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Ambient vignette + hairline platform glow — same visual grammar as
          the auth pages and Brain workspace, just scaled up for a hero. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 38%, rgba(168,85,247,0.14), transparent 60%), radial-gradient(ellipse 90% 60% at 50% 100%, rgba(99,102,241,0.08), transparent 65%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10">
        <header className="flex items-center justify-between">
          <span className="vox-eyebrow tracking-[0.2em] text-foreground">VOX</span>
          <Link href={isSetup ? "/setup" : "/login"}>
            <Button size="sm" variant="secondary">
              {isSetup ? "Initialize" : "Sign in"}
            </Button>
          </Link>
        </header>

        <div className="grid flex-1 grid-cols-1 items-center gap-8 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-4 lg:py-0">
          <div className="order-2 flex flex-col items-start gap-6 lg:order-1">
            <p className="vox-eyebrow">Autonomous intelligence system</p>
            <h1 className="vox-headline text-4xl sm:text-5xl lg:text-6xl">
              This is <span className="text-accent">VOX</span>.
              <br />A mind that works while you live.
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted">
              VOX remembers, researches, plans, and acts — through a real permission system, not blind
              autonomy. Objectives become work. Work becomes evidence. Evidence becomes memory. Nothing here
              is simulated for effect; every state the Brain shows is the actual system.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={isSetup ? "/setup" : "/login"}>
                <Button size="md">{isSetup ? "Initialize VOX" : "Enter VOX"}</Button>
              </Link>
              <span className="lab-mono text-xs text-muted-foreground">
                {isSetup ? "One-time setup · single-user instance" : "Private instance · your data only"}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
              {[
                ["Memory", "Persistent, provenance-tracked"],
                ["Supervisor", "Bounded autonomous execution"],
                ["Economics", "Real opportunity scoring"],
                ["Laboratory", "Engineering, not fiction"],
              ].map(([label, detail]) => (
                <div key={label}>
                  <dt className="lab-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-xs text-muted">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="order-1 h-[360px] sm:h-[440px] lg:order-2 lg:h-[560px]">
            <HoloBrain taskPoints={[]} onSelectTask={() => {}} />
          </div>
        </div>

        <footer className="pb-6 pt-4 text-center lg:pb-10">
          <p className="lab-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Real state only — nothing shown here is fabricated
          </p>
        </footer>
      </div>
    </div>
  );
}
