import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: { default: "Platform admin", template: "%s · Admin · saas.tech" } };

const LINKS = [
  { href: "/admin", label: "Workspaces" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/enquiries", label: "Enquiries" },
];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-5 md:px-8">
          <Logo />
          <span className="rounded-full bg-lime px-2.5 py-0.5 font-mono text-[11px] uppercase">Admin</span>
          <nav className="flex gap-1 overflow-x-auto">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-full px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-2 hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
          <Link href="/app" className="ml-auto shrink-0 text-sm font-medium underline-offset-4 hover:underline">
            ← My workspace
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-5 py-8 md:px-8 md:py-10">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-[20px] bg-paper-2" />}>{children}</Suspense>
      </main>
    </div>
  );
}
