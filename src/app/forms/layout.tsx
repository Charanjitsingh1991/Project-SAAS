import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: { default: "Contact us", template: "%s" }, robots: { index: false } };

export default function FormsLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="min-h-dvh" />}>{children}</Suspense>;
}
