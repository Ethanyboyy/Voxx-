import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">VOX</h1>
          <p className="mt-1 text-sm text-muted">Your private cognitive operating system</p>
        </div>
        {children}
      </div>
    </div>
  );
}
