import { getCurrentUser } from "@/lib/auth/session";
import { listProposals } from "@/lib/cognition/proposals";
import { ProposalsClient } from "@/components/proposals/ProposalsClient";

export default async function ProposalsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const proposals = await listProposals(user.id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="vox-eyebrow">Awaiting your call</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">Proposals</h1>
      <p className="mt-1.5 text-sm text-muted">
        What VOX has noticed and wants to do about it. Nothing here happens until you approve it — approving runs a
        real permission check, and every outcome is recorded.
      </p>
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
