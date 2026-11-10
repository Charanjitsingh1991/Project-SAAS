/** Pure natural-language date-range parsing for the rule-based Copilot. Calendar dates are YYYY-MM-DD. */

export type DateRange = { from: string; to: string; label: string };

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const monthStart = (y: number, m0: number) => new Date(Date.UTC(y, m0, 1)).toISOString().slice(0, 10);
const monthEnd = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).toISOString().slice(0, 10);
const parts = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m0: m - 1, d };
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_ABBR = MONTHS.map((m) => m.slice(0, 3));

/** Monday of the week containing `ymd`. */
function weekStart(ymd: string) {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

function monthRange(y: number, m0: number, label: string): DateRange {
  const norm = new Date(Date.UTC(y, m0, 1));
  return { from: monthStart(norm.getUTCFullYear(), norm.getUTCMonth()), to: monthEnd(norm.getUTCFullYear(), norm.getUTCMonth()), label };
}

function quarterRange(y: number, q: number, label: string): DateRange {
  const norm = new Date(Date.UTC(y, q * 3, 1));
  const ny = norm.getUTCFullYear();
  const nq = norm.getUTCMonth();
  return { from: monthStart(ny, nq), to: monthEnd(ny, nq + 2), label };
}

/** Finds the first date phrase in `text` (English). Returns null when none is present. */
export function parseDateRange(text: string, today: string): DateRange | null {
  const t = text.toLowerCase();
  const { y, m0 } = parts(today);

  let m: RegExpMatchArray | null;
  if ((m = t.match(/\b(?:next|coming|upcoming)\s+(\d{1,3})\s+days?\b/))) return { from: today, to: addDays(today, Number(m[1])), label: `next ${m[1]} days` };
  if ((m = t.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/))) return { from: addDays(today, -Number(m[1])), to: today, label: `last ${m[1]} days` };
  if ((m = t.match(/\b(?:next|last|past)\s+(\d{1,2})\s+months?\b/))) {
    const n = Number(m[1]);
    return m[0].startsWith("next")
      ? { from: today, to: addDays(today, n * 30), label: `next ${n} months` }
      : { from: addDays(today, -n * 30), to: today, label: `last ${n} months` };
  }

  if (/\bday after tomorrow\b/.test(t)) return { from: addDays(today, 2), to: addDays(today, 2), label: "day after tomorrow" };
  if (/\btomorrow\b/.test(t)) return { from: addDays(today, 1), to: addDays(today, 1), label: "tomorrow" };
  if (/\byesterday\b/.test(t)) return { from: addDays(today, -1), to: addDays(today, -1), label: "yesterday" };

  const ws = weekStart(today);
  if (/\bnext week\b/.test(t)) return { from: addDays(ws, 7), to: addDays(ws, 13), label: "next week" };
  if (/\blast week\b/.test(t)) return { from: addDays(ws, -7), to: addDays(ws, -1), label: "last week" };
  if (/\bthis week\b/.test(t)) return { from: ws, to: addDays(ws, 6), label: "this week" };

  if (/\bnext month\b/.test(t)) return monthRange(y, m0 + 1, "next month");
  if (/\b(last|previous) month\b/.test(t)) return monthRange(y, m0 - 1, "last month");
  if (/\bthis month\b|\bmonth to date\b|\bmtd\b/.test(t)) return monthRange(y, m0, "this month");

  const q = Math.floor(m0 / 3);
  if (/\bnext quarter\b/.test(t)) return quarterRange(y, q + 1, "next quarter");
  if (/\b(last|previous) quarter\b/.test(t)) return quarterRange(y, q - 1, "last quarter");
  if (/\bthis quarter\b|\bquarter to date\b/.test(t)) return quarterRange(y, q, "this quarter");

  if (/\bnext year\b/.test(t)) return { from: `${y + 1}-01-01`, to: `${y + 1}-12-31`, label: "next year" };
  if (/\b(last|previous) year\b/.test(t)) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: "last year" };
  if (/\bthis year\b|\bytd\b|\byear to date\b/.test(t)) return { from: `${y}-01-01`, to: today, label: "this year" };

  if ((m = t.match(/\bq([1-4])\s*(?:fy\s*)?(20\d{2})?\b/))) {
    const yy = m[2] ? Number(m[2]) : y;
    return quarterRange(yy, Number(m[1]) - 1, `Q${m[1]} ${yy}`);
  }

  const names = `(${MONTHS.join("|")}|${MONTH_ABBR.join("|")})`;
  if ((m = t.match(new RegExp(`\\b${names}\\.?\\s*,?\\s*(20\\d{2})?\\b`)))) {
    const idx = MONTHS.indexOf(m[1]) >= 0 ? MONTHS.indexOf(m[1]) : MONTH_ABBR.indexOf(m[1]);
    // "may" is also a verb — only accept it when a year or "in/of/for" precedes it.
    if (m[1] !== "may" || m[2] || /\b(in|of|for|during)\s+may\b/.test(t)) {
      const yy = m[2] ? Number(m[2]) : idx > m0 + 6 ? y - 1 : y;
      return monthRange(yy, idx, `${MONTHS[idx][0].toUpperCase()}${MONTHS[idx].slice(1)} ${yy}`);
    }
  }

  if (/\btoday\b|\bright now\b|\bcurrently\b/.test(t)) return { from: today, to: today, label: "today" };
  return null;
}
