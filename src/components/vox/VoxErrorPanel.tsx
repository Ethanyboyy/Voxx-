import { VoxCore } from "@/components/vox/VoxCore";

/** A VOX-styled failure state — "VOX Core — Connection Failure" rather than a raw server error string. The technical message is still shown, just framed as VOX explaining what happened instead of a stack trace. */
export function VoxErrorPanel({
  title = "Connection failure",
  message,
  action,
}: {
  title?: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="instrument mx-auto flex max-w-2xl items-start gap-3 border-danger/30 p-4" style={{ boxShadow: "0 0 24px -14px var(--danger)" }}>
      <VoxCore state="error" size="sm" className="mt-0.5 shrink-0" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-danger">VOX Core — {title}</p>
        <p className="mt-1 text-sm text-foreground">{message}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
