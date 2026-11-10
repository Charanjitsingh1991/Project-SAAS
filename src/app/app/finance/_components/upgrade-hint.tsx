import Link from "next/link";
import type { Feature } from "@/lib/plans";

/** Shown in place of a plan-gated Finance feature. */
export function UpgradeHint({ feature, title, children }: { feature: Feature; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] border border-dashed border-ink/20 bg-butter/30 p-6">
      <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Growth plan</p>
      <h2 className="mt-1 font-display text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-xl text-sm text-ink-soft">{children}</p>
      <Link href={`/app/billing?upgrade=${feature}`} className="mt-4 inline-flex h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-paper hover:bg-ink/85">
        Upgrade to unlock
      </Link>
    </section>
  );
}
