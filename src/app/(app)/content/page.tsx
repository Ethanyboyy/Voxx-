import Link from "next/link";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { EmptyState } from "@/components/ui/EmptyState";

export default function ContentPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Content</h1>
      <p className="mt-1 text-sm text-muted">A content-creation workspace isn&apos;t built in VOX yet.</p>

      <GlassPanel className="mt-6 p-6">
        <EmptyState
          title="Not built yet"
          description="This section exists in the nav as an honest placeholder for a real gap, not a working feature. There's no script generator, no publishing pipeline, no drafts — none of it is wired up. If you want it, it needs to be designed and built like everything else in VOX: real data, real permissions, no fabricated output."
        />
        <p className="mt-4 text-sm text-muted">
          In the meantime, Ideas and Memory can hold content concepts, and Chat can help draft text.
        </p>
        <div className="mt-3 flex gap-3">
          <Link href="/projects" className="text-sm font-medium text-accent">
            Open Projects →
          </Link>
          <Link href="/chat" className="text-sm font-medium text-accent">
            Open Chat →
          </Link>
        </div>
      </GlassPanel>
    </div>
  );
}
