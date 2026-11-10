/** Pure helpdesk helpers: SLA due dates, SLA state, metrics. No DB access. */

export type Priority = "low" | "medium" | "high" | "urgent";
export type TicketStatus = "open" | "pending" | "on_hold" | "resolved" | "closed";
export type SlaState = "on_track" | "at_risk" | "breached" | "met";

export const AT_RISK_FRACTION = 0.25;
const MIN = 60_000;

/** Wall clock for server pages (kept out of component bodies for the purity lint). */
export const wallClock = () => Date.now();

export function slaDue(createdAt: Date, mins: number) {
  return new Date(createdAt.getTime() + mins * MIN);
}

/**
 * State of one SLA target.
 * - finished (doneAt set): "met" when within the due time, else "breached"
 * - running: "breached" once past due, "at_risk" when under 25% of the window is left, else "on_track"
 */
export function slaState(a: { createdAt: Date; dueAt: Date; doneAt?: Date | null; nowMs: number }): SlaState {
  const due = a.dueAt.getTime();
  if (a.doneAt) return a.doneAt.getTime() <= due ? "met" : "breached";
  if (a.nowMs > due) return "breached";
  const total = due - a.createdAt.getTime();
  const left = due - a.nowMs;
  return total > 0 && left < total * AT_RISK_FRACTION ? "at_risk" : "on_track";
}

export type SlaTicket = {
  status: TicketStatus;
  createdAt: Date;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
};

export type SlaView = { kind: "response" | "resolution"; state: SlaState; dueAt: Date; remainingMs: number } | null;

export const isActive = (status: TicketStatus) => status !== "resolved" && status !== "closed";

/** The SLA that matters now: response until the first public reply, then resolution. */
export function ticketSla(t: SlaTicket, nowMs: number): SlaView {
  const finishedAt = t.resolvedAt ?? t.closedAt;
  if (!isActive(t.status) && t.resolutionDueAt) {
    return {
      kind: "resolution",
      state: slaState({ createdAt: t.createdAt, dueAt: t.resolutionDueAt, doneAt: finishedAt ?? t.createdAt, nowMs }),
      dueAt: t.resolutionDueAt,
      remainingMs: t.resolutionDueAt.getTime() - (finishedAt?.getTime() ?? nowMs),
    };
  }
  if (!t.firstRespondedAt && t.firstResponseDueAt) {
    const dueAt = t.firstResponseDueAt;
    return { kind: "response", state: slaState({ createdAt: t.createdAt, dueAt, nowMs }), dueAt, remainingMs: dueAt.getTime() - nowMs };
  }
  if (t.resolutionDueAt) {
    const dueAt = t.resolutionDueAt;
    return { kind: "resolution", state: slaState({ createdAt: t.createdAt, dueAt, nowMs }), dueAt, remainingMs: dueAt.getTime() - nowMs };
  }
  return null;
}

/** Lower sorts first: breached (most overdue first), then nearest due; finished tickets last. */
export function slaSortKey(t: SlaTicket, nowMs: number): number {
  if (!isActive(t.status)) return Number.MAX_SAFE_INTEGER;
  const s = ticketSla(t, nowMs);
  if (!s) return Number.MAX_SAFE_INTEGER - 1;
  return s.dueAt.getTime();
}

export function formatDuration(ms: number) {
  const abs = Math.abs(ms);
  const mins = Math.round(abs / MIN);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
  return `${Math.round(h / 24)}d`;
}

/** "2h 10m left" / "3h overdue" / "Met" */
export function slaLabel(s: NonNullable<SlaView>) {
  if (s.state === "met") return "Met";
  if (s.state === "breached" && s.remainingMs < 0) return `${formatDuration(s.remainingMs)} overdue`;
  if (s.state === "breached") return "Missed";
  return `${formatDuration(s.remainingMs)} left`;
}

type Resolved = { createdAt: Date; resolvedAt: Date | null; resolutionDueAt: Date | null };

/** % of tickets resolved within their resolution due time among those resolved on/after `sinceMs`. Null when none. */
export function slaCompliance(rows: Resolved[], sinceMs: number): number | null {
  const done = rows.filter((r) => r.resolvedAt && r.resolutionDueAt && r.resolvedAt.getTime() >= sinceMs);
  if (!done.length) return null;
  const ok = done.filter((r) => r.resolvedAt!.getTime() <= r.resolutionDueAt!.getTime()).length;
  return Math.round((ok / done.length) * 100);
}

export function avgMs(pairs: { from: Date; to: Date | null }[]): number | null {
  const xs = pairs.filter((p) => p.to).map((p) => p.to!.getTime() - p.from.getTime());
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function avg(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Field changes needed when a ticket moves to `next` (resolve/close/reopen bookkeeping). */
export function statusPatch(cur: { resolvedAt: Date | null; closedAt: Date | null }, next: TicketStatus, now: Date) {
  if (next === "resolved") return { resolvedAt: now, closedAt: null };
  if (next === "closed") return { resolvedAt: cur.resolvedAt ?? now, closedAt: now };
  return { resolvedAt: null, closedAt: null };
}

/** URL-safe slug; falls back to "article". */
export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "article"
  );
}

export const PRIORITY_ORDER: Priority[] = ["urgent", "high", "medium", "low"];
export const HELPDESK_CATEGORIES = ["General", "Billing", "Account", "Orders", "Technical", "Getting started"] as const;
