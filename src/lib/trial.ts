/**
 * Trial clock. Day 1 is the calendar day the workspace was created (in APP_TIMEZONE).
 * - From the start of day 14 (13 full days done) the "add payment" warning shows.
 * - At 00:00 on day 15 the workspace is deactivated unless it has a paid subscription.
 */
export const TRIAL_DAYS = 14;

export function appTimeZone() {
  return process.env.APP_TIMEZONE || "Asia/Kolkata";
}

type Ymd = { y: number; m: number; d: number };

function partsInTz(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

export function ymdInTz(date: Date, tz = appTimeZone()): Ymd {
  const { y, m, d } = partsInTz(date.getTime(), tz);
  return { y, m, d };
}

function offsetMs(utcMs: number, tz: string) {
  const p = partsInTz(utcMs, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** UTC instant of 00:00 local time on the given calendar date. */
export function midnightInTz({ y, m, d }: Ymd, tz = appTimeZone()): Date {
  const guess = Date.UTC(y, m - 1, d);
  const off = offsetMs(guess, tz);
  let t = guess - off;
  const off2 = offsetMs(t, tz);
  if (off2 !== off) t = guess - off2; // DST edge
  return new Date(t);
}

export function addDays({ y, m, d }: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function dayDiff(a: Ymd, b: Ymd) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** Trial end = start of day 15 = midnight of (start date + 14 days). */
export function trialEndFor(start: Date, tz = appTimeZone()) {
  return midnightInTz(addDays(ymdInTz(start, tz), TRIAL_DAYS), tz);
}

export type AccessState =
  | { state: "paid"; status: string }
  | { state: "past_due" }
  | { state: "trial"; day: number; daysLeft: number; lastDay: boolean; endsAt: Date }
  | { state: "locked"; reason: "trial_ended" | "subscription_ended"; endedAt: Date };

type BillingFields = {
  trialStartedAt: Date;
  trialEndsAt: Date;
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
};

export function accessFor(org: BillingFields, now = new Date(), tz = appTimeZone()): AccessState {
  const sub = org.stripeSubscriptionId ? org.subscriptionStatus : null;
  if (sub === "active" || sub === "trialing") return { state: "paid", status: sub };
  if (sub === "past_due") return { state: "past_due" };

  if (now < org.trialEndsAt) {
    const start = ymdInTz(org.trialStartedAt, tz);
    const day = dayDiff(start, ymdInTz(now, tz)) + 1;
    // Warning window: from 00:00 on day 14 (13 full days done) until the trial end.
    const lastDayStart = new Date(org.trialEndsAt.getTime() - 1);
    const lastDay = now >= midnightInTz(ymdInTz(lastDayStart, tz), tz);
    return { state: "trial", day, daysLeft: Math.max(1, TRIAL_DAYS + 1 - day), lastDay, endsAt: org.trialEndsAt };
  }

  return sub
    ? { state: "locked", reason: "subscription_ended", endedAt: org.currentPeriodEnd ?? org.trialEndsAt }
    : { state: "locked", reason: "trial_ended", endedAt: org.trialEndsAt };
}
