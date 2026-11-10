"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Lock, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string; icon: React.ReactNode; locked?: boolean; color?: string };

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((it) => {
        const active = it.href === "/app" ? path === "/app" : path.startsWith(it.href);
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                active ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-2 hover:text-ink",
              )}
            >
              <span className={cn("grid size-7 place-items-center rounded-lg border border-ink/10", active ? "bg-paper/15 border-paper/20" : it.color ?? "bg-card")}>
                {it.icon}
              </span>
              <span className="flex-1">{it.label}</span>
              {it.locked && <Lock className="size-3.5 opacity-60" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        className="grid size-10 place-items-center rounded-full bg-ink text-paper"
      >
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-[68px] z-40 max-h-[calc(100dvh-80px)] overflow-y-auto rounded-3xl border border-line bg-card p-3 shadow-xl" onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function OrgSwitcher({
  orgs,
  currentId,
  action,
}: {
  orgs: { id: number; name: string; role: string }[];
  currentId: number;
  action: (fd: FormData) => Promise<void>;
}) {
  const current = orgs.find((o) => o.id === currentId);
  if (orgs.length < 2) {
    return (
      <div className="rounded-xl border border-line bg-card px-3 py-2">
        <p className="truncate text-sm font-semibold">{current?.name}</p>
        <p className="font-mono text-[10px] tracking-widest text-ink-mute uppercase">{current?.role}</p>
      </div>
    );
  }
  return (
    <form action={action} className="relative">
      <select
        name="orgId"
        defaultValue={currentId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Switch workspace"
        className="w-full cursor-pointer appearance-none rounded-xl border border-line bg-card py-2 pr-8 pl-3 text-sm font-semibold outline-none hover:border-ink"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.role}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2" />
    </form>
  );
}
