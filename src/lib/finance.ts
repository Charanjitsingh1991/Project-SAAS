import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fiscalYear, type AccountType } from "./accounting";
import { addDaysYmd, daysBetween } from "./format";
import { accountIds } from "./ledger";
import { agingBucket, AGING_BUCKETS, monthsBetween, naturalBalance, type AgingBucket } from "./finance-utils";

const jl = schema.journalLines;
const je = schema.journalEntries;

export type AccountBalance = {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  systemKey: string | null;
  debit: number;
  credit: number;
  balance: number; // natural sign
};

/** Per-account debit/credit totals for entries dated within [from, to] (either bound optional). */
export async function accountBalances(orgId: number, range: { from?: string; to?: string } = {}): Promise<AccountBalance[]> {
  await accountIds(orgId);
  const conds = [eq(jl.orgId, orgId)];
  if (range.from) conds.push(gte(je.date, range.from));
  if (range.to) conds.push(lte(je.date, range.to));
  const [accts, sums] = await Promise.all([
    db.select().from(schema.accounts).where(eq(schema.accounts.orgId, orgId)).orderBy(asc(schema.accounts.code)),
    db
      .select({
        accountId: jl.accountId,
        debit: sql<number>`coalesce(sum(${jl.debit}), 0)`,
        credit: sql<number>`coalesce(sum(${jl.credit}), 0)`,
      })
      .from(jl)
      .innerJoin(je, eq(jl.entryId, je.id))
      .where(and(...conds))
      .groupBy(jl.accountId),
  ]);
  const by = new Map(sums.map((s) => [s.accountId, s]));
  return accts.map((a) => {
    const s = by.get(a.id);
    const debit = Number(s?.debit ?? 0);
    const credit = Number(s?.credit ?? 0);
    return { id: a.id, code: a.code, name: a.name, type: a.type, systemKey: a.systemKey, debit, credit, balance: naturalBalance(a.type, debit, credit) };
  });
}

/** Monthly natural-sign movement per account within [from, to]. */
async function monthlyMovement(orgId: number, from: string, to: string, accountFilter?: number[]) {
  const conds = [eq(jl.orgId, orgId), gte(je.date, from), lte(je.date, to)];
  if (accountFilter) conds.push(inArray(jl.accountId, accountFilter));
  const rows = await db
    .select({
      accountId: jl.accountId,
      month: sql<string>`substr(${je.date}, 1, 7)`,
      debit: sql<number>`coalesce(sum(${jl.debit}), 0)`,
      credit: sql<number>`coalesce(sum(${jl.credit}), 0)`,
    })
    .from(jl)
    .innerJoin(je, eq(jl.entryId, je.id))
    .where(and(...conds))
    .groupBy(jl.accountId, sql`substr(${je.date}, 1, 7)`);
  return rows.map((r) => ({ accountId: r.accountId, month: r.month, debit: Number(r.debit), credit: Number(r.credit) }));
}

/* ───────────── Profit & loss ───────────── */

export type PlRow = { id: number; code: string; name: string; byMonth: Record<string, number>; total: number };

export async function profitAndLoss(orgId: number, from: string, to: string) {
  const [accts, moves] = await Promise.all([
    db.select().from(schema.accounts).where(eq(schema.accounts.orgId, orgId)).orderBy(asc(schema.accounts.code)),
    monthlyMovement(orgId, from, to),
  ]);
  const months = monthsBetween(from, to);
  const rows = new Map<number, PlRow>();
  for (const a of accts) {
    if (a.type !== "income" && a.type !== "expense") continue;
    rows.set(a.id, { id: a.id, code: a.code, name: a.name, byMonth: {}, total: 0 });
  }
  for (const m of moves) {
    const a = accts.find((x) => x.id === m.accountId);
    const row = rows.get(m.accountId);
    if (!a || !row) continue;
    const v = naturalBalance(a.type, m.debit, m.credit);
    row.byMonth[m.month] = (row.byMonth[m.month] ?? 0) + v;
    row.total += v;
  }
  const used = (type: AccountType, pred: (key: string | null) => boolean) =>
    accts
      .filter((a) => a.type === type && pred(a.systemKey))
      .map((a) => rows.get(a.id)!)
      .filter((r) => r.total !== 0 || Object.values(r.byMonth).some((v) => v !== 0));
  const income = used("income", () => true);
  const cogs = used("expense", (k) => k === "cogs");
  const expenses = used("expense", (k) => k !== "cogs");
  const sumBy = (list: PlRow[]) => {
    const byMonth: Record<string, number> = {};
    let total = 0;
    for (const r of list) {
      total += r.total;
      for (const [m, v] of Object.entries(r.byMonth)) byMonth[m] = (byMonth[m] ?? 0) + v;
    }
    return { byMonth, total };
  };
  const inc = sumBy(income);
  const cg = sumBy(cogs);
  const ex = sumBy(expenses);
  const gross = { byMonth: {} as Record<string, number>, total: inc.total - cg.total };
  const net = { byMonth: {} as Record<string, number>, total: inc.total - cg.total - ex.total };
  for (const m of months) {
    gross.byMonth[m] = (inc.byMonth[m] ?? 0) - (cg.byMonth[m] ?? 0);
    net.byMonth[m] = gross.byMonth[m] - (ex.byMonth[m] ?? 0);
  }
  return { months, income, cogs, expenses, totals: { income: inc, cogs: cg, expenses: ex, gross, net } };
}

/* ───────────── Balance sheet & trial balance ───────────── */

export async function balanceSheet(orgId: number, from: string, to: string) {
  const [upTo, before] = await Promise.all([accountBalances(orgId, { to }), accountBalances(orgId, { to: addDaysYmd(from, -1) })]);
  const pick = (t: AccountType) => upTo.filter((a) => a.type === t && (a.balance !== 0 || a.debit !== 0 || a.credit !== 0));
  const earn = (list: AccountBalance[]) =>
    list.filter((a) => a.type === "income").reduce((s, a) => s + a.balance, 0) - list.filter((a) => a.type === "expense").reduce((s, a) => s + a.balance, 0);
  const totalEarnings = earn(upTo);
  const priorEarnings = earn(before);
  const assets = pick("asset");
  const liabilities = pick("liability");
  const equity = pick("equity");
  const sum = (l: AccountBalance[]) => l.reduce((s, a) => s + a.balance, 0);
  const totals = {
    assets: sum(assets),
    liabilities: sum(liabilities),
    equity: sum(equity) + totalEarnings,
  };
  return {
    assets,
    liabilities,
    equity,
    priorEarnings,
    currentEarnings: totalEarnings - priorEarnings,
    totals,
    balanced: totals.assets === totals.liabilities + totals.equity,
  };
}

export async function trialBalance(orgId: number, to: string) {
  const all = await accountBalances(orgId, { to });
  const rows = all
    .filter((a) => a.debit !== 0 || a.credit !== 0)
    .map((a) => {
      const net = a.debit - a.credit;
      return { ...a, debitBal: net > 0 ? net : 0, creditBal: net < 0 ? -net : 0 };
    });
  const debit = rows.reduce((s, r) => s + r.debitBal, 0);
  const credit = rows.reduce((s, r) => s + r.creditBal, 0);
  return { rows, debit, credit, balanced: debit === credit };
}

/* ───────────── Receivables aging ───────────── */

export type AgingInvoice = {
  id: number;
  number: string;
  customerName: string;
  dueDate: string;
  balance: number;
  daysOverdue: number;
  bucket: AgingBucket;
};

export async function receivables(orgId: number, today: string) {
  const rows = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.orgId, orgId), inArray(schema.invoices.status, ["sent", "partial"])))
    .orderBy(asc(schema.invoices.dueDate));
  const invoices: AgingInvoice[] = rows
    .map((i) => {
      const daysOverdue = daysBetween(i.dueDate, today);
      return { id: i.id, number: i.number, customerName: i.customerName, dueDate: i.dueDate, balance: i.total - i.amountPaid, daysOverdue, bucket: agingBucket(daysOverdue) };
    })
    .filter((i) => i.balance > 0);
  const empty = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
  const totals = empty();
  const byCustomer = new Map<string, { customer: string; buckets: Record<AgingBucket, number>; total: number }>();
  for (const i of invoices) {
    totals[i.bucket] += i.balance;
    const c = byCustomer.get(i.customerName) ?? { customer: i.customerName, buckets: empty(), total: 0 };
    c.buckets[i.bucket] += i.balance;
    c.total += i.balance;
    byCustomer.set(i.customerName, c);
  }
  const overdue = invoices.filter((i) => i.daysOverdue > 0);
  return {
    invoices,
    totals,
    total: invoices.reduce((s, i) => s + i.balance, 0),
    overdueAmount: overdue.reduce((s, i) => s + i.balance, 0),
    overdueCount: overdue.length,
    customers: [...byCustomer.values()].sort((a, b) => b.total - a.total),
  };
}

/* ───────────── GST summary ───────────── */

export async function gstSummary(orgId: number, from: string, to: string) {
  const ids = await accountIds(orgId);
  const out = ids.get("gst_out")!;
  const inp = ids.get("gst_in")!;
  const moves = await monthlyMovement(orgId, from, to, [out, inp]);
  const months = monthsBetween(from, to);
  const rows = months.map((month) => {
    const o = moves.filter((m) => m.accountId === out && m.month === month).reduce((s, m) => s + m.credit - m.debit, 0);
    const i = moves.filter((m) => m.accountId === inp && m.month === month).reduce((s, m) => s + m.debit - m.credit, 0);
    return { month, output: o, input: i, net: o - i };
  });
  return {
    rows,
    totals: rows.reduce((t, r) => ({ output: t.output + r.output, input: t.input + r.input, net: t.net + r.net }), { output: 0, input: 0, net: 0 }),
  };
}

/* ───────────── Cash & account ledgers ───────────── */

export type LedgerLine = {
  lineId: number;
  entryId: number;
  date: string;
  memo: string;
  sourceType: string;
  debit: number;
  credit: number;
  balance: number; // running, natural sign
};

/** Ledger lines of one account in date order with a running balance, optionally limited to [from, to]. */
export async function accountLedger(orgId: number, account: { id: number; type: AccountType }, range: { from?: string; to?: string } = {}) {
  let opening = 0;
  if (range.from) {
    const [o] = await db
      .select({ debit: sql<number>`coalesce(sum(${jl.debit}), 0)`, credit: sql<number>`coalesce(sum(${jl.credit}), 0)` })
      .from(jl)
      .innerJoin(je, eq(jl.entryId, je.id))
      .where(and(eq(jl.orgId, orgId), eq(jl.accountId, account.id), sql`${je.date} < ${range.from}`));
    opening = naturalBalance(account.type, Number(o?.debit ?? 0), Number(o?.credit ?? 0));
  }
  const conds = [eq(jl.orgId, orgId), eq(jl.accountId, account.id)];
  if (range.from) conds.push(gte(je.date, range.from));
  if (range.to) conds.push(lte(je.date, range.to));
  const rows = await db
    .select({ lineId: jl.id, entryId: je.id, date: je.date, memo: je.memo, sourceType: je.sourceType, debit: jl.debit, credit: jl.credit })
    .from(jl)
    .innerJoin(je, eq(jl.entryId, je.id))
    .where(and(...conds))
    .orderBy(asc(je.date), asc(je.id), asc(jl.id));
  let running = opening;
  const lines: LedgerLine[] = rows.map((r) => {
    running += naturalBalance(account.type, r.debit, r.credit);
    return { ...r, balance: running };
  });
  return { opening, lines, closing: running };
}

export async function cashMovement(orgId: number, from: string, to: string) {
  const ids = await accountIds(orgId);
  const bankId = ids.get("bank")!;
  const ledger = await accountLedger(orgId, { id: bankId, type: "asset" }, { from, to });
  return {
    ...ledger,
    inflow: ledger.lines.reduce((s, l) => s + l.debit, 0),
    outflow: ledger.lines.reduce((s, l) => s + l.credit, 0),
  };
}

/* ───────────── Dashboard ───────────── */

export async function dashboard(orgId: number, today: string) {
  const [fyStart, fyEnd] = fiscalYear(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [ar, fyBalances, allBalances, [collected], recent, bills] = await Promise.all([
    receivables(orgId, today),
    accountBalances(orgId, { from: fyStart, to: fyEnd }),
    accountBalances(orgId),
    db
      .select({ s: sql<number>`coalesce(sum(${schema.payments.amount}), 0)` })
      .from(schema.payments)
      .where(and(eq(schema.payments.orgId, orgId), gte(schema.payments.date, monthStart))),
    db.select().from(schema.invoices).where(eq(schema.invoices.orgId, orgId)).orderBy(desc(schema.invoices.issueDate), desc(schema.invoices.id)).limit(8),
    db
      .select({ e: schema.expenses, vendor: schema.vendors.name })
      .from(schema.expenses)
      .leftJoin(schema.vendors, eq(schema.expenses.vendorId, schema.vendors.id))
      .where(and(eq(schema.expenses.orgId, orgId), eq(schema.expenses.status, "unpaid")))
      .orderBy(asc(schema.expenses.dueDate), asc(schema.expenses.id))
      .limit(8),
  ]);
  const key = (k: string) => allBalances.find((a) => a.systemKey === k)?.balance ?? 0;
  const income = fyBalances.filter((a) => a.type === "income").reduce((s, a) => s + a.balance, 0);
  const expense = fyBalances.filter((a) => a.type === "expense").reduce((s, a) => s + a.balance, 0);
  return {
    ar,
    collectedThisMonth: Number(collected?.s ?? 0),
    netProfit: income - expense,
    fiscal: [fyStart, fyEnd] as const,
    gstNet: key("gst_out") - key("gst_in"),
    cash: key("bank"),
    recent,
    bills,
  };
}
