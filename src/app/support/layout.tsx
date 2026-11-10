import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: { default: "Help center", template: "%s · Help center" } };

export default function SupportLayout({ children }: LayoutProps<"/support">) {
  return <Suspense fallback={<div className="min-h-dvh" />}>{children}</Suspense>;
}
