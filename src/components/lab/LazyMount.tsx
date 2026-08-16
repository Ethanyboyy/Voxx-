"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Mounts `children` only while the wrapper is in/near the viewport, and
 * unmounts them once it scrolls back out — falling back to `placeholder`
 * otherwise. Grids that render many WebGL canvases (HolographicModel) need
 * this: browsers cap concurrent WebGL contexts at roughly 8-16, so an
 * unbounded suit archive would silently lose contexts past that point.
 */
export function LazyMount({
  children,
  placeholder,
  rootMargin = "200px",
}: {
  children: ReactNode;
  placeholder: ReactNode;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div ref={ref} className="h-full w-full">
      {visible ? children : placeholder}
    </div>
  );
}
