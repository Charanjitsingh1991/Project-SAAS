import Link from "next/link";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtQty } from "@/lib/inventory";

export function ExportLink({ href }: { href: string }) {
  return (
    <a href={href} className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
      <Download className="size-4" /> Export CSV
    </a>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink/85">
      {children}
    </Link>
  );
}

export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-5 rounded-xl bg-signal/10 px-4 py-2.5 text-sm text-signal">
      {message}
    </p>
  );
}

/** On-hand quantity: strong red when negative, red at/below reorder level. */
export function Qty({ value, low, className }: { value: number; low?: boolean; className?: string }) {
  return (
    <span className={cn("tabular-nums", value < 0 ? "font-bold text-signal" : low ? "font-medium text-signal" : "", className)}>
      {fmtQty(value)}
      {value < 0 && <span className="ml-1 text-[10px] tracking-wide uppercase">negative</span>}
    </span>
  );
}

export const filterInput = "h-10 rounded-full border border-line bg-paper/60 px-4 text-sm outline-none focus:border-ink";
