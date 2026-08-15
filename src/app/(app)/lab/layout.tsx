import type { ReactNode } from "react";
import { LabShell } from "@/components/lab/LabShell";

export default function LabLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-full">
      <LabShell>{children}</LabShell>
    </div>
  );
}
