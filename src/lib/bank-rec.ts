/** Pure bank-reconciliation helpers (client-safe, no DB): statement CSV parsing and auto-matching. */
import { parseCsv } from "./csv";

export type ParsedBankLine = { date: string; description: string; reference: string | null; amount: number; balance: number | null };

const key = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

// Normalised (letters-only) header aliases; a header matches if it equals or starts with an alias.
const ALIASES = {
  date: ["date", "txndate", "transactiondate", "valuedate", "postingdate", "bookingdate", "trandate", "postdate"],
  description: ["description", "narration", "details", "particulars", "transactiondetails", "memo", "remarks", "transactiondescription", "payee"],
  reference: ["reference", "ref", "refno", "chqrefno", "chequerefno", "chequeno", "chqno", "utr", "referenceno", "transactionid"],
  amount: ["amount", "transactionamount", "amt"],
  debit: ["debit", "withdrawal", "withdrawals", "withdrawalamt", "withdrawalamount", "debitamount", "dr", "moneyout", "paidout", "out"],
  credit: ["credit", "deposit", "deposits", "depositamt", "depositamount", "creditamount", "cr", "moneyin", "paidin", "in"],
  type: ["type", "drcr", "crdr", "debitcredit", "transactiontype"],
  balance: ["balance", "closingbalance", "runningbalance", "availablebalance"],
} as const;
type Field = keyof typeof ALIASES;

function findColumns(headers: string[]) {
  const cols: Partial<Record<Field, string>> = {};
  const taken = new Set<string>();
  // Exact matches first, then prefix matches (e.g. "Amount (AED)" → amountaed).
  for (const exact of [true, false]) {
    for (const field of Object.keys(ALIASES) as Field[]) {
      if (cols[field]) continue;
      const h = headers.find((x) => {
        if (taken.has(x)) return false;
        const k = key(x);
        return ALIASES[field].some((a) => (exact ? k === a : a.length >= 3 && k.startsWith(a)));
      });
      if (h) {
        cols[field] = h;
        taken.add(h);
      }
    }
  }
  return cols;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function ymd(y: number, m: number, d: number) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** Bank dates: YYYY-MM-DD, DD/MM/YYYY (day-first, as in India/UAE; MM/DD only when unambiguous), DD-Mon-YYYY, "5 Nov 2026". */
export function parseBankDate(raw: string): string | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    return b > 12 && a <= 12 ? ymd(+m[3], a, b) : ymd(+m[3], b, a);
  }
  m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s,]*(\d{2,4})$/);
  if (m && MONTHS[m[2].toLowerCase().slice(0, 3)]) return ymd(+m[3], MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1]);
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase().slice(0, 3)]) return ymd(+m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2]);
  return null;
}

/** "1,234.50" | "(1,234.50)" | "-1234.5" | "1,234.50 DR" | "AED 1,234.50 CR" → signed minor units; blank → null. */
export function parseBankAmount(raw: string | undefined | null): number | null {
  let s = String(raw ?? "").trim();
  if (!s || s === "-") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  const suffix = s.match(/\b(dr|cr)\.?$/i);
  if (suffix) {
    if (suffix[1].toLowerCase() === "dr") sign *= -1;
    s = s.slice(0, suffix.index).trim();
  }
  if (s.endsWith("-")) {
    sign *= -1;
    s = s.slice(0, -1);
  }
  s = s.replace(/[A-Za-z₹$€£,\s]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return sign * Math.round(Number(s) * 100);
}

/**
 * Parse a bank statement CSV. Needs a date column plus either a signed amount (+ in / − out) or debit and credit
 * columns (debit = money out). An optional Dr/Cr type column flips unsigned amounts. Returns parsed lines,
 * per-row errors and the closing balance from a balance column (latest row), if present.
 */
export function parseBankStatement(text: string): { lines: ParsedBankLine[]; errors: string[]; closingBalance: number | null } {
  const { headers, rows } = parseCsv(text);
  const cols = findColumns(headers);
  const errors: string[] = [];
  if (!cols.date) return { lines: [], errors: ["No date column found (expected a header like “Date” or “Value date”)."], closingBalance: null };
  if (!cols.amount && !cols.debit && !cols.credit) {
    return { lines: [], errors: ["No amount column found (expected “Amount”, or “Debit” and “Credit”)."], closingBalance: null };
  }
  const lines: ParsedBankLine[] = [];
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const date = parseBankDate(r[cols.date!] ?? "");
    if (!date) {
      // Footer rows ("Closing balance", totals) usually have no date; skip quietly when the date cell is blank.
      if ((r[cols.date!] ?? "").trim()) errors.push(`Row ${rowNo}: unrecognised date “${r[cols.date!]}”.`);
      return;
    }
    let amount: number | null = null;
    if (cols.amount && (r[cols.amount] ?? "").trim()) {
      amount = parseBankAmount(r[cols.amount]);
      const t = cols.type ? key(r[cols.type] ?? "") : "";
      if (amount !== null && amount > 0 && /^(dr|d|debit|withdrawal)$/.test(t)) amount = -amount;
    } else {
      const dr = parseBankAmount(cols.debit ? r[cols.debit] : "");
      const cr = parseBankAmount(cols.credit ? r[cols.credit] : "");
      if (dr !== null || cr !== null) amount = Math.abs(cr ?? 0) - Math.abs(dr ?? 0);
    }
    if (amount === null || Number.isNaN(amount)) {
      errors.push(`Row ${rowNo}: missing or invalid amount.`);
      return;
    }
    if (amount === 0) return;
    const description = (cols.description ? r[cols.description] : "")?.trim() || "(no description)";
    const reference = cols.reference ? r[cols.reference]?.trim() || null : null;
    const balance = cols.balance ? parseBankAmount(r[cols.balance]) : null;
    lines.push({ date, description: description.slice(0, 300), reference: reference?.slice(0, 120) ?? null, amount, balance });
  });
  let closingBalance: number | null = null;
  const withBal = lines.filter((l) => l.balance !== null);
  if (withBal.length) {
    // Statements are exported oldest-first or newest-first; the closing balance belongs to the latest row.
    const descending = withBal[0].date > withBal[withBal.length - 1].date;
    closingBalance = (descending ? withBal[0] : withBal[withBal.length - 1]).balance;
  }
  return { lines, errors, closingBalance };
}

export function daysApart(a: string, b: string) {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));
}

export type RecStatementLine = { id: number; date: string; amount: number };
/** A ledger entry's net movement on the bank account (+ in / − out). */
export type RecLedgerItem = { entryId: number; date: string; amount: number };

/**
 * Pair statement lines with ledger bank movements of exactly the same signed amount within ±windowDays.
 * Each side is used at most once; the closest date wins, ties go to the earliest entry.
 */
export function autoMatch(lines: RecStatementLine[], items: RecLedgerItem[], windowDays = 3): { lineId: number; entryId: number }[] {
  const used = new Set<number>();
  const out: { lineId: number; entryId: number }[] = [];
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const l of sorted) {
    let best: RecLedgerItem | null = null;
    let bestGap = Infinity;
    for (const it of items) {
      if (used.has(it.entryId) || it.amount !== l.amount) continue;
      const gap = daysApart(l.date, it.date);
      if (gap > windowDays) continue;
      if (gap < bestGap || (gap === bestGap && best && it.entryId < best.entryId)) {
        best = it;
        bestGap = gap;
      }
    }
    if (best) {
      used.add(best.entryId);
      out.push({ lineId: l.id, entryId: best.entryId });
    }
  }
  return out;
}
