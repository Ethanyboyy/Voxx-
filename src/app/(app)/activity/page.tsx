import { getCurrentUser } from "@/lib/auth/session";
import { listRecentEvents } from "@/lib/observability/events";
import { ActivityClient } from "@/components/activity/ActivityClient";

export default async function ActivityPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const events = await listRecentEvents(user.id, 100);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="vox-eyebrow">Observability</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">Activity</h1>
      <p className="mt-1.5 text-sm text-muted">
        The append-only timeline of everything VOX has recorded — every consequential action and every notable
        domain event, in order.
      </p>
      <ActivityClient
        initialEvents={events.map((e) => ({
          id: e.id,
          type: e.type,
          payload: e.payload,
          consequential: e.consequential,
          subjectType: e.subjectType,
          subjectId: e.subjectId,
          createdAt: e.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
