import Link from "next/link";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  tabs,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: { href: string; label: string; active?: boolean }[];
}) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-ink-soft">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && (
        <nav className="mt-6 flex gap-1 border-b border-line">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                t.active ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[20px] border border-line bg-card", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "card" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone }) {
  return (
    <div className={cn("rounded-[20px] border border-ink/10 p-5", TONE_BG[tone])}>
      <p className="font-mono text-[11px] tracking-widest text-ink/60 uppercase">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-sm text-ink/60">{hint}</p>}
    </div>
  );
}

export type Tone = "card" | "mint" | "butter" | "sky" | "peach" | "lilac" | "rose" | "lime" | "ink" | "signal";

const TONE_BG: Record<Tone, string> = {
  card: "bg-card",
  mint: "bg-mint",
  butter: "bg-butter",
  sky: "bg-sky",
  peach: "bg-peach",
  lilac: "bg-lilac",
  rose: "bg-rose",
  lime: "bg-lime",
  ink: "bg-ink text-paper",
  signal: "bg-signal text-white",
};

export function Badge({ tone = "card", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border border-ink/10 px-2.5 py-0.5 text-xs font-medium text-ink capitalize", TONE_BG[tone])}>
      {children}
    </span>
  );
}

/** Consistent colours for status values across modules. */
export const STATUS_TONE: Record<string, Tone> = {
  active: "mint",
  inactive: "card",
  pending: "butter",
  approved: "mint",
  rejected: "rose",
  lead: "card",
  qualified: "sky",
  proposal: "butter",
  won: "mint",
  lost: "rose",
  draft: "card",
  sent: "sky",
  paid: "mint",
  void: "rose",
  overdue: "rose",
  planning: "lilac",
  on_hold: "butter",
  done: "mint",
  todo: "card",
  doing: "sky",
  open: "peach",
  resolved: "mint",
  low: "card",
  medium: "sky",
  high: "peach",
  urgent: "rose",
  new: "butter",
  contacted: "sky",
  closed: "card",
  notice: "butter",
  exited: "card",
  probation: "lilac",
  negotiation: "peach",
  partial: "butter",
  unpaid: "peach",
  ordered: "sky",
  received: "mint",
  cancelled: "card",
  backlog: "card",
  in_progress: "sky",
  review: "lilac",
  absent: "rose",
  present: "mint",
  half_day: "butter",
  leave: "sky",
  holiday: "lilac",
  wfh: "lime",
  customer: "mint",
  prospect: "sky",
  churned: "rose",
  breached: "rose",
  at_risk: "butter",
  on_track: "mint",
  off_track: "rose",
  applied: "card",
  screening: "sky",
  interview: "lilac",
  offer: "butter",
  hired: "mint",
  self_review: "sky",
  manager_review: "lilac",
  completed: "mint",
  submitted: "butter",
  reimbursed: "mint",
  accepted: "mint",
  declined: "rose",
  expired: "card",
  invoiced: "mint",
  paused: "butter",
  matched: "mint",
  unmatched: "peach",
};

export function StatusBadge({ value }: { value: string }) {
  return <Badge tone={STATUS_TONE[value] ?? "card"}>{value.replaceAll("_", " ")}</Badge>;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-dashed border-ink/20 px-6 py-10 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

/** Table primitives with consistent styling. */
export function Table({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div className="-mx-5 -my-5 overflow-x-auto">
      <table className={cn("w-full text-left text-sm", !compact && "min-w-[640px]")}>{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("border-b border-line px-5 py-3 font-mono text-[11px] font-normal tracking-widest text-ink-mute uppercase", className)}>{children}</th>;
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("border-b border-line/70 px-5 py-3 align-middle", className)}>{children}</td>;
}
