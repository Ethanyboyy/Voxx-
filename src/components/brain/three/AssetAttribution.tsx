"use client";

import { listAssets } from "@/lib/3d/assetRegistry";

/**
 * Licence attribution for a bundled third-party 3D asset.
 *
 * NOT decorative and NOT optional. The anatomical brain is CC BY 4.0, which
 * requires attribution wherever the work is displayed — so this is a condition
 * of shipping the model at all, not a nicety that can be tidied away when the
 * HUD gets busy.
 *
 * It reads the registry rather than hardcoding a name, so it cannot drift out
 * of date when the asset is replaced, and it renders NOTHING when no
 * third-party asset is registered — attributing a model the build does not
 * actually ship would be its own kind of false claim.
 */
export function AssetAttribution({ kind = "brain" }: { kind?: "brain" | "suit" }) {
  const attributed = listAssets(kind).filter((a) => a.provenance.origin === "THIRD_PARTY");
  if (attributed.length === 0) return null;

  return (
    <div className="pointer-events-auto max-w-[min(92vw,26rem)] text-[10px] leading-relaxed text-muted-foreground/70">
      {attributed.map((asset) => (
        <p key={asset.assetId}>
          {asset.label} —{" "}
          {asset.provenance.sourceUrl ? (
            <a
              href={asset.provenance.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-foreground"
            >
              NIH 3D
            </a>
          ) : (
            "NIH 3D"
          )}
          , {asset.provenance.license.split(".")[0]}.
        </p>
      ))}
    </div>
  );
}
