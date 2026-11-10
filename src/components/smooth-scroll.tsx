"use client";

import { ReactLenis } from "lenis/react";

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  return (
    <ReactLenis root options={{ lerp: 0.11, anchors: { offset: -72 } }}>
      {children}
    </ReactLenis>
  );
}
