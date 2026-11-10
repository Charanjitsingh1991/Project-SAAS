/** Pure CRM helpers (no server-only imports so they can be unit-tested). */

export const STUCK_DAYS = 21;
export const ACTIVE_WINDOW_DAYS = 14;

export type LeadScoreInput = {
  hasEmail: boolean;
  hasPhone: boolean;
  hasCompany: boolean;
  /** 0–1 rank of the deal value among the workspace's deals (0 when no deal). */
  valuePercentile: number;
  /** Any activity logged in the last 14 days. */
  recentActivity: boolean;
  /** Days the deal has sat in its current stage (null when there is no open deal). */
  daysInStage: number | null;
};

/** Rule-based 0–100: +20 email, +10 phone, +10 company, up to +30 value percentile, +20 recent activity, −20 stuck > 21d. */
export function leadScore(i: LeadScoreInput) {
  let s = 0;
  if (i.hasEmail) s += 20;
  if (i.hasPhone) s += 10;
  if (i.hasCompany) s += 10;
  s += Math.round(30 * Math.min(1, Math.max(0, i.valuePercentile)));
  if (i.recentActivity) s += 20;
  if (i.daysInStage !== null && i.daysInStage > STUCK_DAYS) s -= 20;
  return Math.min(100, Math.max(0, s));
}

/** Share of `all` values that are ≤ value (0 for empty lists or non-positive values). */
export function valuePercentile(value: number, all: number[]) {
  if (!all.length || value <= 0) return 0;
  return all.filter((v) => v <= value).length / all.length;
}

export function scoreTone(score: number): "mint" | "butter" | "rose" {
  return score >= 60 ? "mint" : score >= 30 ? "butter" : "rose";
}

export type ForecastDeal = { value: number; probability: number; expectedClose: string | null };

/** "YYYY-MM" keys for `n` months starting at the month of `todayYmd`. */
export function monthKeys(todayYmd: string, n = 6) {
  let y = Number(todayYmd.slice(0, 4));
  let m = Number(todayYmd.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Weighted (value × probability) and raw totals per expected-close month. Deals outside the window are ignored. */
export function weightedForecast(deals: ForecastDeal[], months: string[]) {
  const rows = months.map((month) => ({ month, weighted: 0, total: 0, count: 0 }));
  for (const d of deals) {
    const row = d.expectedClose ? rows.find((r) => r.month === d.expectedClose!.slice(0, 7)) : undefined;
    if (!row) continue;
    row.weighted += Math.round((d.value * d.probability) / 100);
    row.total += d.value;
    row.count++;
  }
  return rows;
}

/** won / (won + lost) as a 0–100 percentage; null when nothing is closed. */
export function winRate(won: number, lost: number) {
  return won + lost === 0 ? null : Math.round((won / (won + lost)) * 100);
}

export function avgDealSize(values: number[]) {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
}

/** Mean whole days between created and closed (YYYY-MM-DD pairs); null when empty. */
export function avgCycleDays(pairs: { created: string; closed: string }[]) {
  if (!pairs.length) return null;
  const days = pairs.map((p) => Math.max(0, Math.round((Date.parse(`${p.closed}T00:00:00Z`) - Date.parse(`${p.created}T00:00:00Z`)) / 86_400_000)));
  return Math.round(days.reduce((a, b) => a + b, 0) / days.length);
}

/** Whole days since a Date (epoch ms) at `nowMs`. */
export function daysSince(date: Date, nowMs: number) {
  return Math.max(0, Math.floor((nowMs - date.getTime()) / 86_400_000));
}
