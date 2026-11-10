import { AGING_BUCKETS, agingBucket, type AgingBucket } from "./finance-utils";
import { daysBetween } from "./format";

export type StmtInvoice = { id: number; number: string; issueDate: string; dueDate: string; status: string; total: number };
export type StmtPayment = { id: number; invoiceId: number; date: string; amount: number; reference?: string | null };
export type StmtCreditNote = { id: number; invoiceId: number; number: string; date: string; total: number };

export type StmtKind = "invoice" | "payment" | "refund" | "credit_note";
export type StmtRow = {
  date: string;
  kind: StmtKind;
  ref: string;
  description: string;
  /** Increases the customer's balance (invoices, refunds paid out). */
  debit: number;
  /** Decreases the balance (payments received, credit notes). */
  credit: number;
  balance: number;
};

export type Statement = {
  openingBalance: number;
  rows: StmtRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  aging: Record<AgingBucket, number>;
  agingTotal: number;
};

const KIND_ORDER: Record<StmtKind, number> = { invoice: 0, refund: 1, payment: 2, credit_note: 3 };
const isLive = (status: string) => status !== "draft" && status !== "void";

/**
 * Statement of account for one customer. Drafts and voided invoices (and their
 * payments/credit notes) are excluded. Refunds are negative payments.
 */
export function buildStatement(
  input: { invoices: StmtInvoice[]; payments: StmtPayment[]; creditNotes: StmtCreditNote[] },
  from: string,
  to: string,
): Statement {
  const live = new Map(input.invoices.filter((i) => isLive(i.status)).map((i) => [i.id, i]));
  type Ev = Omit<StmtRow, "balance"> & { id: number };
  const events: Ev[] = [];
  for (const i of live.values()) {
    events.push({ id: i.id, date: i.issueDate, kind: "invoice", ref: i.number, description: `Invoice, due ${i.dueDate}`, debit: i.total, credit: 0 });
  }
  for (const p of input.payments) {
    const inv = live.get(p.invoiceId);
    if (!inv || p.amount === 0) continue;
    const refund = p.amount < 0;
    events.push({
      id: p.id,
      date: p.date,
      kind: refund ? "refund" : "payment",
      ref: p.reference || inv.number,
      description: `${refund ? "Refund" : "Payment"} for ${inv.number}`,
      debit: refund ? -p.amount : 0,
      credit: refund ? 0 : p.amount,
    });
  }
  for (const c of input.creditNotes) {
    const inv = live.get(c.invoiceId);
    if (!inv) continue;
    events.push({ id: c.id, date: c.date, kind: "credit_note", ref: c.number, description: `Credit note for ${inv.number}`, debit: 0, credit: c.total });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id);

  let openingBalance = 0;
  for (const e of events) if (e.date < from) openingBalance += e.debit - e.credit;

  let balance = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: StmtRow[] = [];
  for (const e of events) {
    if (e.date < from || e.date > to) continue;
    balance += e.debit - e.credit;
    totalDebit += e.debit;
    totalCredit += e.credit;
    rows.push({ date: e.date, kind: e.kind, ref: e.ref, description: e.description, debit: e.debit, credit: e.credit, balance });
  }

  const aging: Record<AgingBucket, number> = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const i of live.values()) {
    if (i.issueDate > to) continue;
    const settled =
      input.payments.filter((p) => p.invoiceId === i.id && p.date <= to).reduce((s, p) => s + p.amount, 0) +
      input.creditNotes.filter((c) => c.invoiceId === i.id && c.date <= to).reduce((s, c) => s + c.total, 0);
    const due = i.total - settled;
    if (due > 0) aging[agingBucket(daysBetween(i.dueDate, to))] += due;
  }
  const agingTotal = AGING_BUCKETS.reduce((s, b) => s + aging[b], 0);

  return { openingBalance, rows, totalDebit, totalCredit, closingBalance: balance, aging, agingTotal };
}
