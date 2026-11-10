/** Pure recruitment helpers (no server-only imports) so they can be unit-tested. */
import { CANDIDATE_STAGES, JOB_STATUSES } from "@/db/schema";

export type CandidateStage = (typeof CANDIDATE_STAGES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Active pipeline order; "hired" and "rejected" are outcomes. */
export const PIPELINE_STAGES = ["applied", "screening", "interview", "offer"] as const satisfies readonly CandidateStage[];

export const STAGE_LABELS: Record<CandidateStage, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

export const CANDIDATE_SOURCES = ["referral", "careers_page", "linkedin", "naukri", "bayt", "indeed", "agency", "walk_in", "other"] as const;

export type StageCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validates a manual stage move. Hiring goes through the hire action (it creates the employee),
 * so "hired" can't be set directly and hired candidates are final.
 */
export function canMoveStage(from: CandidateStage, to: CandidateStage): StageCheck {
  if (from === to) return { ok: false, reason: "Candidate is already in that stage." };
  if (from === "hired") return { ok: false, reason: "Hired candidates can't be moved." };
  if (to === "hired") return { ok: false, reason: "Use the Hire action on an offer-stage candidate." };
  return { ok: true };
}

/** Hire is only allowed from the offer stage, on an opening that still has vacancies. */
export function canHire(stage: CandidateStage, job: { status: JobStatus; openings: number }, hiredSoFar: number): StageCheck {
  if (stage !== "offer") return { ok: false, reason: "Move the candidate to Offer before hiring." };
  if (job.status === "closed") return { ok: false, reason: "This opening is closed." };
  if (hiredSoFar >= job.openings) return { ok: false, reason: "All positions on this opening are already filled." };
  return { ok: true };
}

/** Candidate count per stage (every stage present, zero-filled). */
export function pipelineCounts(rows: readonly { stage: CandidateStage }[]): Record<CandidateStage, number> {
  const out = Object.fromEntries(CANDIDATE_STAGES.map((s) => [s, 0])) as Record<CandidateStage, number>;
  for (const r of rows) out[r.stage] += 1;
  return out;
}

/** Candidates still in play (not hired/rejected). */
export function activeCount(counts: Record<CandidateStage, number>) {
  return PIPELINE_STAGES.reduce((s, k) => s + counts[k], 0);
}

/** True once hires reach the number of openings. */
export function isFilled(hired: number, openings: number) {
  return openings > 0 && hired >= openings;
}

/** Average whole days from application to hire; null when nothing to average. */
export function avgTimeToHireDays(rows: readonly { appliedAt: Date; hiredAt: Date }[]): number | null {
  const days = rows.map((r) => (r.hiredAt.getTime() - r.appliedAt.getTime()) / 86_400_000).filter((d) => Number.isFinite(d) && d >= 0);
  if (!days.length) return null;
  return Math.round(days.reduce((a, b) => a + b, 0) / days.length);
}

/** Share of applicants that reached each pipeline stage or beyond (rejected candidates count only at "applied"). */
export function conversionPct(counts: Record<CandidateStage, number>, stage: CandidateStage) {
  const total = CANDIDATE_STAGES.reduce((s, k) => s + counts[k], 0);
  if (!total) return null;
  const order: CandidateStage[] = [...PIPELINE_STAGES, "hired"];
  const idx = order.indexOf(stage);
  if (idx < 0) return null;
  const reached = idx === 0 ? total : order.slice(idx).reduce((s, k) => s + counts[k], 0);
  return Math.round((reached / total) * 100);
}

/** Salary band validation (minor units; 0 = not disclosed). */
export function salaryRangeError(min: number, max: number): string | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) return "Enter valid amounts.";
  if (max && min > max) return "Minimum can't exceed maximum.";
  return null;
}

export function isValidRating(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}
