import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <rect x="7" y="7" width="8" height="8" rx="2" className="fill-paper" />
      <rect x="17" y="7" width="8" height="8" rx="2" className="fill-paper" />
      <rect x="7" y="17" width="8" height="8" rx="2" className="fill-paper" />
      <rect x="17" y="17" width="8" height="8" rx="4" className="fill-signal" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group inline-flex items-center gap-2", className)} aria-label="saasmodels.tech home">
      <LogoMark className="transition-transform duration-500 ease-out-expo group-hover:rotate-90" />
      <span className="font-display text-[22px] font-bold tracking-tight">
        saasmodels<span className="text-signal">.</span>tech
      </span>
    </Link>
  );
}
