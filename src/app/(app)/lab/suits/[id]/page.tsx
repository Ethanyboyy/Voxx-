import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSuit } from "@/lib/lab/suits";
import { getComponentTree } from "@/lib/lab/components";
import { listDesignNotes } from "@/lib/lab/notes";
import { listRequirements } from "@/lib/lab/requirements";
import { listQuestions } from "@/lib/lab/questions";
import { listDecisions } from "@/lib/lab/decisions";
import { listSuitImages } from "@/lib/lab/suitImages";
import { SuitDetailClient } from "@/components/lab/SuitDetailClient";

export default async function SuitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  const suit = await getSuit(user.id, id);
  if (!suit || !suit.currentVersion?.stats) notFound();

  const [components, notes, requirements, questions, decisions, images] = await Promise.all([
    getComponentTree({ suitId: id }),
    listDesignNotes(user.id, "LabSuit", id),
    listRequirements(user.id, id),
    listQuestions(user.id, id),
    listDecisions(user.id, id),
    listSuitImages(user.id, id),
  ]);

  return (
    <SuitDetailClient
      suit={{
        id: suit.id,
        codename: suit.codename,
        designation: suit.designation,
        archetype: suit.archetype,
        description: suit.description,
        status: suit.status,
        realityStatus: suit.realityStatus,
        modelUrl: suit.modelUrl,
        colorPrimary: suit.colorPrimary,
        colorSecondary: suit.colorSecondary,
        silhouette: suit.silhouette,
        materialLanguage: suit.materialLanguage,
        patternStyle: suit.patternStyle,
        armorLevel: suit.armorLevel,
        maskLensStyle: suit.maskLensStyle,
        currentVersionLabel: suit.currentVersion.label,
        stats: suit.currentVersion.stats,
        versions: suit.versions.map((v) => ({
          id: v.id,
          label: v.label,
          note: v.note,
          createdAt: v.createdAt.toISOString(),
          isCurrent: v.id === suit.currentVersionId,
          stats: v.stats,
        })),
      }}
      components={components}
      notes={notes.map((n) => ({ id: n.id, content: n.content, createdAt: n.createdAt.toISOString() }))}
      requirements={requirements.map((r) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        status: r.status,
        priority: r.priority,
        subsystem: r.subsystem,
        verificationMethod: r.verificationMethod,
        evidence: r.evidence,
      }))}
      questions={questions.map((q) => ({
        id: q.id,
        question: q.question,
        importance: q.importance,
        subsystem: q.subsystem,
        resolved: q.resolved,
        currentHypothesis: q.currentHypothesis,
        nextAction: q.nextAction,
      }))}
      decisions={decisions.map((d) => ({
        id: d.id,
        decision: d.decision,
        selectedOption: d.selectedOption,
        rationale: d.rationale,
        author: d.author,
        createdAt: d.createdAt.toISOString(),
      }))}
      images={(images ?? []).map((img) => ({
        id: img.id,
        kind: img.kind,
        url: img.url,
        label: img.label,
      }))}
    />
  );
}
