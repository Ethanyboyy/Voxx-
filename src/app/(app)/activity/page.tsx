import { getCurrentUser } from "@/lib/auth/session";
import { listRecentEvents } from "@/lib/observability/events";
import { ActivityClient } from "@/components/activity/ActivityClient";

export default async function ActivityPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const events = await listRecentEvents(user.id, 100);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Activity</h1>
      <p className="mt-1 text-sm text-muted">
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
