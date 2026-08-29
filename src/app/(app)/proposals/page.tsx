import { getCurrentUser } from "@/lib/auth/session";
import { listProposals } from "@/lib/cognition/proposals";
import { ProposalsClient } from "@/components/proposals/ProposalsClient";
import { RoomHeader } from "@/components/ui/Instrument";

export default async function ProposalsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const proposals = await listProposals(user.id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <RoomHeader
        system="Awaiting your call"
        title="Proposals"
        description={<>What VOX has noticed and wants to do about it. Nothing here happens until you approve it — approving runs a real permission check, and every outcome is recorded.</>}
      />
      <ProposalsClient
        initialProposals={proposals.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          resolvedAt: p.resolvedAt?.toISOString() ?? null,
          evidence: p.evidence,
        }))}
      />
    </div>
  );
}
