export { formatMoney, formatMoneyCompact, toMinor, fromMinor } from "./money";

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value: Date) {
  return value.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata",
  });
}

/** "2026-11" → "Nov 2026" */
export function formatPeriod(period: string) {
  return new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Relative time: "5m ago", "3h ago", "2d ago", or a date. */
export function timeAgo(value: Date) {
  const s = Math.round((Date.now() - value.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(value);
}

/** FormData → plain object; empty strings become undefined so zod optional() works. */
export function formObject(fd: FormData) {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const s = String(v).trim();
    out[k] = s === "" ? undefined : s;
  }
  return out;
}

/** Today's calendar date in the app timezone, as YYYY-MM-DD. */
export function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(new Date());
}

/** YYYY-MM-DD ± n days (pure calendar arithmetic). */
export function addDaysYmd(ymd: string, n: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
