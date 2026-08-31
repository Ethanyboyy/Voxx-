import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getRunTrace } from "@/lib/capabilities/trace";
import { getProviderStatuses } from "@/lib/capabilities/availability";
import { RunWorkspace, type RunTracePayload } from "@/components/capabilities/RunWorkspace";
import { RoomHeader } from "@/components/ui/Instrument";

/**
 * One orchestrated run, live.
 *
 * The first frame is rendered on the server so the page never opens empty,
 * then the client takes over on the event stream. Dates are serialized here
 * rather than in the trace module, because the trace is also read by
 * server-side callers that want real Date objects.
 */
export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { id } = await params;
  const trace = await getRunTrace(user.id, { runId: id });
  if (!trace.runId) notFound();

  const initial = JSON.parse(JSON.stringify(trace)) as RunTracePayload;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <RoomHeader
        system="Execution"
        title="Workspace"
        description="What VOX is doing, as it does it. Every step, provider call and result below is read from the run's own records — nothing here is a simulation of progress."
      />
      <div className="mt-6">
        <RunWorkspace runId={id} initial={initial} providers={getProviderStatuses()} />
      </div>
    </div>
  );
}
