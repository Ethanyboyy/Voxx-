import { getCurrentUser } from "@/lib/auth/session";
import { getVolaraObserverState } from "@/lib/volara/observer";
import { ObserverClient } from "@/components/observer/ObserverClient";

/**
 * [P4-G] The Global Observer.
 *
 * The first paint comes from the server so the screen is correct before any
 * client code runs; after that the client re-reads the same projection when the
 * live event stream says something relevant changed. There is only ever one
 * source of this state, and it is `getVolaraObserverState()`.
 *
 * `getCurrentUser()` is the tenant boundary, and the projection is scoped to
 * that id at every query inside it — nothing here filters after the fact.
 */
export default async function ObserverPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const state = await getVolaraObserverState(user.id);
  return <ObserverClient initialState={state} />;
}
