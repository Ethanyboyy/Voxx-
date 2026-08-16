"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { HolographicPanel, LabSectionLabel } from "@/components/lab/primitives";
import { cn } from "@/lib/utils/cn";

interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
}

interface TutorialDetail {
  id: string;
  title: string;
  category: string;
  difficulty: string;
  lesson: string;
  demonstration: string | null;
  exercisePrompt: string | null;
  quiz: string | null;
  completed: boolean;
  score: number | null;
  prerequisiteTitle: string | null;
  unlocks: { id: string; title: string }[];
}

const CATEGORY_LABEL: Record<string, string> = {
  SUIT_TECHNOLOGY: "Suit Technology",
  MATERIALS: "Materials",
  PHYSICS: "Physics",
  ENGINEERING: "Engineering",
  MOVEMENT: "Movement",
  DEFENSIVE_AWARENESS: "Defensive Awareness",
  SIMULATION: "Simulation",
  EQUIPMENT_OPERATION: "Equipment Operation",
  LABORATORY_SAFETY: "Laboratory Safety",
};

function parseQuiz(raw: string | null): QuizQuestion[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (q): q is QuizQuestion =>
        q && typeof q.question === "string" && Array.isArray(q.options) && typeof q.answerIndex === "number"
    );
  } catch {
    return [];
  }
}

export function TutorialDetailClient({ tutorial }: { tutorial: TutorialDetail }) {
  const router = useRouter();
  const questions = useMemo(() => parseQuiz(tutorial.quiz), [tutorial.quiz]);

  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [graded, setGraded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ score: number; correct: number } | null>(
    tutorial.completed && tutorial.score != null ? { score: tutorial.score, correct: -1 } : null
  );

  const allAnswered = questions.length > 0 && answers.every((a) => a != null);

  function selectAnswer(qIndex: number, optIndex: number) {
    if (graded) return;
    setAnswers((prev) => prev.map((a, i) => (i === qIndex ? optIndex : a)));
  }

  async function submitQuiz() {
    if (!allAnswered) return;
    const correct = questions.reduce((acc, q, i) => acc + (answers[i] === q.answerIndex ? 1 : 0), 0);
    const score = Math.round((correct / questions.length) * 100);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/lab/tutorials/${tutorial.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to record quiz result.");
        return;
      }
      setGraded(true);
      setResult({ score, correct });
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  function retake() {
    setAnswers(questions.map(() => null));
    setGraded(false);
    setResult(null);
    setError(null);
  }

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div>
        <Link href="/lab/training/tutorials" className="text-xs text-muted-foreground hover:text-foreground">
          ← Tutorials
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="vox-headline text-2xl">{tutorial.title}</h1>
          <span className="lab-mono rounded-full border border-border bg-surface-hover px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {CATEGORY_LABEL[tutorial.category] ?? tutorial.category}
          </span>
          <span className="lab-mono rounded-full border border-border bg-surface-hover px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {tutorial.difficulty.toLowerCase()}
          </span>
          {tutorial.completed ? (
            <span className="lab-mono rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
              Completed{tutorial.score != null ? ` · ${tutorial.score}/100` : ""}
            </span>
          ) : null}
        </div>
        {tutorial.prerequisiteTitle ? (
          <p className="mt-1 text-xs text-muted-foreground">Prerequisite: {tutorial.prerequisiteTitle}</p>
        ) : null}
      </div>

      <HolographicPanel className="p-4">
        <LabSectionLabel>Lesson</LabSectionLabel>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{tutorial.lesson}</p>
      </HolographicPanel>

      {tutorial.demonstration ? (
        <HolographicPanel className="p-4">
          <LabSectionLabel>Demonstration</LabSectionLabel>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{tutorial.demonstration}</p>
        </HolographicPanel>
      ) : null}

      {tutorial.exercisePrompt ? (
        <HolographicPanel className="p-4">
          <LabSectionLabel>Exercise</LabSectionLabel>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{tutorial.exercisePrompt}</p>
        </HolographicPanel>
      ) : null}

      <HolographicPanel className="p-4">
        <LabSectionLabel>Quiz</LabSectionLabel>
        {questions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">This tutorial has no quiz — review the lesson above.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-5">
            {questions.map((q, qi) => (
              <div key={qi}>
                <p className="text-sm font-medium text-foreground">
                  {qi + 1}. {q.question}
                </p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {q.options.map((opt, oi) => {
                    const selected = answers[qi] === oi;
                    const showCorrectness = graded;
                    const isCorrectOption = oi === q.answerIndex;
                    return (
                      <button
                        key={oi}
                        type="button"
                        disabled={graded}
                        onClick={() => selectAnswer(qi, oi)}
                        className={cn(
                          "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          !showCorrectness && selected && "border-[var(--border-strong)] bg-accent-muted text-accent",
                          !showCorrectness && !selected && "border-border text-foreground hover:bg-surface-hover",
                          showCorrectness && isCorrectOption && "border-success/50 bg-success/10 text-success",
                          showCorrectness && selected && !isCorrectOption && "border-danger/50 bg-danger-muted text-danger",
                          showCorrectness && !selected && !isCorrectOption && "border-border text-muted-foreground"
                        )}
                      >
                        <span>{opt}</span>
                        {showCorrectness && isCorrectOption ? <span className="lab-mono text-[10px]">CORRECT</span> : null}
                        {showCorrectness && selected && !isCorrectOption ? (
                          <span className="lab-mono text-[10px]">YOUR PICK</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {error ? <p className="text-xs text-danger">{error}</p> : null}

            {result && graded ? (
              <p className="lab-mono text-sm text-accent">
                Score: {result.score}/100 ({result.correct}/{questions.length} correct)
              </p>
            ) : null}

            <div className="flex gap-2">
              {!graded ? (
                <Button onClick={submitQuiz} disabled={!allAnswered || submitting}>
                  {submitting ? "Grading…" : "Submit Quiz"}
                </Button>
              ) : (
                <Button variant="secondary" onClick={retake}>
                  Retake Quiz
                </Button>
              )}
            </div>
          </div>
        )}
      </HolographicPanel>

      {tutorial.unlocks.length > 0 ? (
        <HolographicPanel className="p-4">
          <LabSectionLabel>Unlocks</LabSectionLabel>
          <div className="mt-2 flex flex-col gap-1">
            {tutorial.unlocks.map((u) => (
              <Link key={u.id} href={`/lab/training/tutorials/${u.id}`} className="text-sm text-foreground hover:text-accent">
                {u.title}
              </Link>
            ))}
          </div>
        </HolographicPanel>
      ) : null}
    </div>
  );
}
