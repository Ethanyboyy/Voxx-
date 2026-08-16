"use client";

import { Component, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";

/**
 * Renders a real .glb/.gltf suit asset via drei's useGLTF — the "drop a
 * real file in and it just works" half of the architecture. Suspends while
 * loading (parent Canvas already wraps children in <Suspense>).
 */
export function GltfSuitModel({ url }: { url: string }) {
  const gltf = useGLTF(url);
  return <primitive object={gltf.scene} />;
}

interface GltfErrorBoundaryState {
  failed: boolean;
}

/**
 * A LabSuit.modelUrl can point at a file that doesn't exist yet, was moved,
 * or fails to parse — that must degrade to the procedural fallback, not
 * crash the whole holographic viewer. useGLTF throws inside R3F's render
 * tree, which only a class-based error boundary can catch (no functional
 * equivalent exists in React).
 */
export class GltfErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, GltfErrorBoundaryState> {
  state: GltfErrorBoundaryState = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
