"use client";

// global-error replaces the root layout entirely when an error escapes it,
// so it must define its own <html>/<body> and cannot rely on globals.css or
// metadata exports (both documented Next.js constraints) — inline styles
// only, matching VOX's obsidian/violet identity by hand.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#050308",
          color: "#f5f2ff",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <p
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#a99fc9",
              marginBottom: "0.75rem",
            }}
          >
            VOX
          </p>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            Something went wrong.
          </h1>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#a99fc9" }}>
            {error.digest ? `Reference: ${error.digest}` : "An unexpected error interrupted this page."}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "linear-gradient(135deg, #a855f7, #6366f1)",
              color: "#0a0714",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
