/** Pure performance helpers (no server-only imports) so they can be unit-tested. Dates are "YYYY-MM-DD". */

export const GOAL_STATUSES = ["on_track", "at_risk", "off_track", "done"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const REVIEW_STATUSES = ["self_review", "manager_review", "completed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const RATING_LABELS: Record<number, string> = {
  1: "Needs improvement",
  2: "Below expectations",
  3: "Meets expectations",
  4: "Exceeds expectations",
  5: "Outstanding",
};

export function clampProgress(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

const dayMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

/**
 * Goal health from progress vs. time elapsed between start and due date.
 * Done at 100%; overdue and unfinished is off track; otherwise compare with the linear expectation.
 */
export function goalStatus(g: { progress: number; dueDate: string | null; startDate: string }, today: string): GoalStatus {
  const p = clampProgress(g.progress);
  if (p >= 100) return "done";
  if (!g.dueDate) return "on_track";
  if (today > g.dueDate) return "off_track";
  const span = dayMs(g.dueDate) - dayMs(g.startDate);
  if (span <= 0) return "on_track";
  const expected = Math.min(100, ((dayMs(today) - dayMs(g.startDate)) / span) * 100);
  const gap = expected - p;
  if (gap <= 15) return "on_track";
  if (gap <= 35) return "at_risk";
  return "off_track";
}

/** Counts per status plus weighted average progress. */
export function goalSummary(rows: readonly { status: GoalStatus; progress: number; weight: number }[]) {
  const counts = Object.fromEntries(GOAL_STATUSES.map((s) => [s, 0])) as Record<GoalStatus, number>;
  let w = 0;
  let wp = 0;
  for (const r of rows) {
    counts[r.status] += 1;
    const weight = Math.max(1, r.weight);
    w += weight;
    wp += weight * clampProgress(r.progress);
  }
  const healthy = counts.on_track + counts.done;
  return {
    counts,
    total: rows.length,
    avgProgress: w ? Math.round(wp / w) : null,
    onTrackPct: rows.length ? Math.round((healthy / rows.length) * 100) : null,
  };
}

/** Average of the given 1–5 ratings to one decimal; nulls ignored. */
export function averageRating(ratings: readonly (number | null | undefined)[]): number | null {
  const xs = ratings.filter((r): r is number => typeof r === "number" && r >= 1 && r <= 5);
  if (!xs.length) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
}

/** Rating distribution 1..5. */
export function ratingDistribution(ratings: readonly (number | null | undefined)[]) {
  const out = [0, 0, 0, 0, 0];
  for (const r of ratings) if (typeof r === "number" && r >= 1 && r <= 5) out[r - 1] += 1;
  return out;
}

export type ReviewAction = "submit_self" | "complete" | "reopen";

/** Review workflow: employee self-review → manager review → completed (managers may skip the self step or reopen). */
export function nextReviewStatus(status: ReviewStatus, action: ReviewAction, byManager: boolean): ReviewStatus | null {
  if (action === "submit_self") return status === "self_review" ? "manager_review" : null;
  if (action === "complete") return byManager && status !== "completed" ? "completed" : null;
  if (action === "reopen") return byManager && status === "completed" ? "manager_review" : null;
  return null;
}

/** Half-year cycle label for a date, e.g. "2026-H2". */
export function cycleOf(ymd: string) {
  const m = Number(ymd.slice(5, 7));
  return `${ymd.slice(0, 4)}-H${m <= 6 ? 1 : 2}`;
}

export const CYCLE_RE = /^\d{4}-(H[12]|Q[1-4]|FY)$/;

/** First and last date of a cycle label ("2026-H2", "2026-Q1", "2026-FY"). */
export function cycleRange(cycle: string): { start: string; end: string } | null {
  if (!CYCLE_RE.test(cycle)) return null;
  const y = cycle.slice(0, 4);
  const part = cycle.slice(5);
  if (part === "FY") return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (part === "H1") return { start: `${y}-01-01`, end: `${y}-06-30` };
  if (part === "H2") return { start: `${y}-07-01`, end: `${y}-12-31` };
  const q = Number(part.slice(1));
  const startM = (q - 1) * 3 + 1;
  const endM = startM + 2;
  const last = new Date(Date.UTC(Number(y), endM, 0)).getUTCDate();
  return { start: `${y}-${String(startM).padStart(2, "0")}-01`, end: `${y}-${String(endM).padStart(2, "0")}-${last}` };
}
