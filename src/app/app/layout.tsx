import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingBanner } from "@/components/app/billing-banner";
import { Sidebar } from "@/components/app/sidebar";

export const metadata: Metadata = { title: { default: "Workspace", template: "%s · saas.tech" } };

function PageSkeleton() {
  return (
    <div className="space-y-4 p-8">
      <div className="h-9 w-64 animate-pulse rounded-xl bg-paper-2" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-[20px] bg-paper-2" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-[20px] bg-paper-2" />
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="lg:flex">
      <Suspense fallback={<aside className="hidden h-dvh w-[264px] shrink-0 border-r border-line lg:block" />}>
        <Sidebar />
      </Suspense>
      <div className="min-w-0 flex-1">
        <Suspense>
          <BillingBanner />
        </Suspense>
        <main className="mx-auto max-w-[1200px] px-5 py-8 md:px-8 md:py-10">
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
