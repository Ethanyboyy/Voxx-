"use client";

import { HoloBrain } from "@/components/brain/HoloBrain";

/**
 * Decorative-only hologram for the dashboard's Vox Mind card — no task
 * data, no click handling, just the ambient particle brain. The real
 * interactive one (with real task neurons) lives at /brain.
 */
export function BrainPreview() {
  return <HoloBrain taskPoints={[]} onSelectTask={() => {}} />;
}
