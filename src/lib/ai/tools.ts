import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, like, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysYmd, daysBetween, formatDate, formatMoney, formatPeriod, todayYmd } from "@/lib/format";
import { daysOfCover, fmtQty, isLowStock, suggestedQty } from "@/lib/inventory";
import { getProductsWithStock } from "@/lib/inventory-data";
import { canUseModule, type ActiveWorkspace } from "@/lib/tenancy";
import { MAX_ROWS, TOOL_DEFS, toolDef, type Cell, type ToolName, type ToolResult } from "./catalog";

/**
 * Registry of read-only, org-scoped tools. The model (or the rule planner) only picks a tool and
 * validated parameters; every query below is fixed and filtered by the current workspace id.
 */

type Params = Record<string, unknown>;
type Exec = (ws: ActiveWorkspace, p: Params) => Promise<ToolResult>;

const s = (p: Params, k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
const n = (p: Params, k: string) => (typeof p[k] === "number" ? (p[k] as number) : undefined);
const esc = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
const money = (ws: ActiveWorkspace, v: number) => formatMoney(Number(v) || 0, ws.org.currency);
const plural = (c: number, w: string) => `${c} ${w}${c === 1 ? "" : "s"}`;
const startOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const endOf = (ymd: string) => new Date(`${ymd}T23:59:59Z`);
const rangeLabel = (from: string, to: string) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);
const mk = (tool: string, r: Omit<ToolResult, "tool">): ToolResult => ({ tool, ...r, rows: r.rows.slice(0, MAX_ROWS), links: r.links?.slice(0, MAX_ROWS) });

const NOT_VOID = ["draft", "void"] as const;
const OPEN_STAGES = ["lead", "qualified", "proposal", "negotiation"] as const;
const balanceSql = sql<number>`${schema.invoices.total} - ${schema.invoices.amountPaid} - ${schema.invoices.amountCredited}`;

function openInvoiceWhere(orgId: number, today: string, minDays = 0) {
  return and(
    eq(schema.invoices.orgId, orgId),
    inArray(schema.invoices.status, ["sent", "partial"]),
    lt(schema.invoices.dueDate, addDaysYmd(today, 1 - Math.max(minDays, 1))),
    sql`${balanceSql} > 0`,
  );
}

const overdue_invoices: Exec = async (ws, p) => {
  const orgId = ws.org.id;
  const today = todayYmd();
  const min = n(p, "minDaysOverdue") ?? 0;
  const where = openInvoiceWhere(orgId, today, min);
  const wantDeals = p.withOpenDeals === true && canUseModule(ws, "crm");
  const [rows, [tot]] = await Promise.all([
    db
      .select({ id: schema.invoices.id, number: schema.invoices.number, customer: schema.invoices.customerName, companyId: schema.invoices.companyId, due: schema.invoices.dueDate, bal: balanceSql })
      .from(schema.invoices)
      .where(where)
      .orderBy(desc(balanceSql))
      .limit(200),
    db.select({ c: sql<number>`count(*)`, b: sql<number>`coalesce(sum(${balanceSql}), 0)` }).from(schema.invoices).where(where),
  ]);

  const dealByCompany = new Map<number, { title: string; stage: string }>();
  const dealByName = new Map<string, { title: string; stage: string }>();
  if (wantDeals) {
    const deals = await db
      .select({ title: schema.deals.title, stage: schema.deals.stage, companyId: schema.deals.companyId, company: schema.companies.name, value: schema.deals.value })
      .from(schema.deals)
      .leftJoin(schema.companies, eq(schema.deals.companyId, schema.companies.id))
      .where(and(eq(schema.deals.orgId, orgId), inArray(schema.deals.stage, [...OPEN_STAGES])))
      .orderBy(desc(schema.deals.value));
    for (const d of deals) {
      const v = { title: d.title, stage: d.stage };
      if (d.companyId && !dealByCompany.has(d.companyId)) dealByCompany.set(d.companyId, v);
      if (d.company && !dealByName.has(d.company.toLowerCase())) dealByName.set(d.company.toLowerCase(), v);
    }
  }
  const dealOf = (r: (typeof rows)[number]) => (r.companyId ? dealByCompany.get(r.companyId) : undefined) ?? dealByName.get(r.customer.toLowerCase());

  const shown = wantDeals ? rows.filter((r) => dealOf(r)) : rows;
  const columns = ["Invoice", "Customer", "Due", "Days overdue", "Balance", ...(wantDeals ? ["Open deal", "Stage"] : [])];
  const facts = [`${plural(Number(tot?.c ?? 0), "overdue invoice")} totalling ${money(ws, Number(tot?.b ?? 0))}.`];
  if (wantDeals) facts.push(`${plural(new Set(shown.map((r) => r.customer)).size, "customer")} with an overdue invoice also ${shown.length === 1 ? "has" : "have"} an open deal.`);
  return mk("overdue_invoices", {
    title: wantDeals ? "Overdue invoices with an open deal" : "Overdue invoices",
    columns,
    rows: shown.map((r) => {
      const d = wantDeals ? dealOf(r) : undefined;
      return [r.number, r.customer, formatDate(r.due), daysBetween(r.due, today), money(ws, r.bal), ...(wantDeals ? [d?.title ?? "—", d?.stage ?? "—"] : [])] as Cell[];
    }),
    links: shown.map((r) => `/app/finance/invoices/${r.id}`),
    facts,
    href: "/app/finance/invoices",
  });
};

const receivables: Exec = async (ws) => {
  const orgId = ws.org.id;
  const today = todayYmd();
  const open = and(eq(schema.invoices.orgId, orgId), inArray(schema.invoices.status, ["sent", "partial"]), sql`${balanceSql} > 0`);
  const late = sql`julianday(${today}) - julianday(${schema.invoices.dueDate})`;
  const bucket = (lo: number, hi: number) => sql<number>`coalesce(sum(case when ${late} >= ${lo} and ${late} <= ${hi} then ${balanceSql} else 0 end), 0)`;
  const [[tot], debtors] = await Promise.all([
    db
      .select({
        total: sql<number>`coalesce(sum(${balanceSql}), 0)`,
        count: sql<number>`count(*)`,
        current: sql<number>`coalesce(sum(case when ${late} < 1 then ${balanceSql} else 0 end), 0)`,
        b1: bucket(1, 30),
        b2: bucket(31, 60),
        b3: bucket(61, 90),
        b4: sql<number>`coalesce(sum(case when ${late} > 90 then ${balanceSql} else 0 end), 0)`,
      })
      .from(schema.invoices)
      .where(open),
    db
      .select({ customer: schema.invoices.customerName, c: sql<number>`count(*)`, bal: sql<number>`sum(${balanceSql})`, oldest: sql<string>`min(${schema.invoices.dueDate})` })
      .from(schema.invoices)
      .where(open)
      .groupBy(schema.invoices.customerName)
      .orderBy(desc(sql`sum(${balanceSql})`))
      .limit(10),
  ]);
  return mk("receivables", {
    title: "Top debtors",
    columns: ["Customer", "Open invoices", "Outstanding", "Oldest due"],
    rows: debtors.map((d) => [d.customer, Number(d.c), money(ws, Number(d.bal)), formatDate(d.oldest)]),
    facts: [
      `Total outstanding ${money(ws, Number(tot?.total ?? 0))} across ${plural(Number(tot?.count ?? 0), "invoice")}.`,
      `Not yet due ${money(ws, Number(tot?.current ?? 0))}; 1–30 days late ${money(ws, Number(tot?.b1 ?? 0))}; 31–60 ${money(ws, Number(tot?.b2 ?? 0))}; 61–90 ${money(ws, Number(tot?.b3 ?? 0))}; 90+ ${money(ws, Number(tot?.b4 ?? 0))}.`,
    ],
    href: "/app/finance/reports?report=aging",
  });
};

function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ey, em] = to.split("-").map(Number);
  while ((y < ey || (y === ey && m <= em)) && out.length < 24) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

const revenue_expenses: Exec = async (ws, p) => {
  const orgId = ws.org.id;
  const from = s(p, "from") ?? `${todayYmd().slice(0, 7)}-01`;
  const to = s(p, "to") ?? todayYmd();
  const inv = schema.invoices;
  const [rev, col, exp, cats] = await Promise.all([
    db
      .select({ m: sql<string>`substr(${inv.issueDate}, 1, 7)`, v: sql<number>`coalesce(sum(${inv.subtotal}), 0)` })
      .from(inv)
      .where(and(eq(inv.orgId, orgId), notInArray(inv.status, [...NOT_VOID]), gte(inv.issueDate, from), lte(inv.issueDate, to)))
      .groupBy(sql`substr(${inv.issueDate}, 1, 7)`),
    db
      .select({ m: sql<string>`substr(${schema.payments.date}, 1, 7)`, v: sql<number>`coalesce(sum(${schema.payments.amount}), 0)` })
      .from(schema.payments)
      .where(and(eq(schema.payments.orgId, orgId), gte(schema.payments.date, from), lte(schema.payments.date, to)))
      .groupBy(sql`substr(${schema.payments.date}, 1, 7)`),
    db
      .select({ m: sql<string>`substr(${schema.expenses.date}, 1, 7)`, v: sql<number>`coalesce(sum(${schema.expenses.amount}), 0)` })
      .from(schema.expenses)
      .where(and(eq(schema.expenses.orgId, orgId), gte(schema.expenses.date, from), lte(schema.expenses.date, to)))
      .groupBy(sql`substr(${schema.expenses.date}, 1, 7)`),
    db
      .select({ c: schema.expenses.category, v: sql<number>`sum(${schema.expenses.amount})` })
      .from(schema.expenses)
      .where(and(eq(schema.expenses.orgId, orgId), gte(schema.expenses.date, from), lte(schema.expenses.date, to)))
      .groupBy(schema.expenses.category)
      .orderBy(desc(sql`sum(${schema.expenses.amount})`))
      .limit(3),
  ]);
  const by = (rows: { m: string; v: number }[]) => new Map(rows.map((r) => [r.m, Number(r.v)]));
  const R = by(rev), C = by(col), E = by(exp);
  const months = monthsBetween(from.slice(0, 7), to.slice(0, 7));
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const [tr, tc, te] = [sum(R), sum(C), sum(E)];
  return mk("revenue_expenses", {
    title: `Revenue & expenses, ${rangeLabel(from, to)}`,
    columns: ["Month", "Revenue", "Collected", "Expenses", "Profit"],
    rows: months.map((m) => [formatPeriod(m), money(ws, R.get(m) ?? 0), money(ws, C.get(m) ?? 0), money(ws, E.get(m) ?? 0), money(ws, (R.get(m) ?? 0) - (E.get(m) ?? 0))]),
    facts: [
      `Invoiced revenue ${money(ws, tr)} (excl. tax), collected ${money(ws, tc)}, expenses ${money(ws, te)} (incl. payroll), profit ${money(ws, tr - te)}.`,
      ...(cats.length ? [`Biggest expense categories: ${cats.map((c) => `${c.c} ${money(ws, Number(c.v))}`).join(", ")}.`] : []),
    ],
    href: "/app/finance/reports",
  });
};

const cash_balance: Exec = async (ws) => {
  const orgId = ws.org.id;
  const a = schema.accounts;
  const rows = await db
    .select({ id: a.id, code: a.code, name: a.name, bal: sql<number>`coalesce(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)` })
    .from(a)
    .leftJoin(schema.journalLines, and(eq(schema.journalLines.accountId, a.id), eq(schema.journalLines.orgId, orgId)))
    .where(and(eq(a.orgId, orgId), eq(a.type, "asset"), or(eq(a.systemKey, "bank"), like(a.name, "%bank%"), like(a.name, "%cash%"))))
    .groupBy(a.id)
    .orderBy(asc(a.code));
  const total = rows.reduce((t, r) => t + Number(r.bal), 0);
  return mk("cash_balance", {
    title: "Bank & cash balances",
    columns: ["Account", "Balance"],
    rows: rows.map((r) => [`${r.code} · ${r.name}`, money(ws, Number(r.bal))]),
    facts: [rows.length ? `Total bank & cash ${money(ws, total)}.` : "No bank or cash accounts found."],
    href: "/app/finance/accounts",
  });
};

const top_customers: Exec = async (ws, p) => {
  const inv = schema.invoices;
  const from = s(p, "from");
  const to = s(p, "to");
  const rows = await db
    .select({ c: inv.customerName, count: sql<number>`count(*)`, v: sql<number>`sum(${inv.subtotal})`, owed: sql<number>`sum(case when ${inv.status} in ('sent','partial') then ${balanceSql} else 0 end)` })
    .from(inv)
    .where(and(eq(inv.orgId, ws.org.id), notInArray(inv.status, [...NOT_VOID]), from ? gte(inv.issueDate, from) : undefined, to ? lte(inv.issueDate, to) : undefined))
    .groupBy(inv.customerName)
    .orderBy(desc(sql`sum(${inv.subtotal})`))
    .limit(n(p, "limit") ?? 10);
  return mk("top_customers", {
    title: from && to ? `Top customers, ${rangeLabel(from, to)}` : "Top customers",
    columns: ["Customer", "Invoices", "Revenue (excl. tax)", "Outstanding"],
    rows: rows.map((r) => [r.c, Number(r.count), money(ws, Number(r.v)), money(ws, Number(r.owed))]),
    facts: rows.length ? [`Top customer: ${rows[0].c} with ${money(ws, Number(rows[0].v))}.`] : ["No invoices in this period."],
    href: "/app/finance/invoices",
  });
};

const pipeline: Exec = async (ws) => {
  const d = schema.deals;
  const rows = await db
    .select({ stage: d.stage, c: sql<number>`count(*)`, v: sql<number>`coalesce(sum(${d.value}), 0)`, w: sql<number>`coalesce(sum(${d.value} * ${d.probability} / 100.0), 0)` })
    .from(d)
    .where(and(eq(d.orgId, ws.org.id), inArray(d.stage, [...OPEN_STAGES])))
    .groupBy(d.stage);
  const order = new Map<string, number>(OPEN_STAGES.map((st, i) => [st, i]));
  rows.sort((a, b) => (order.get(a.stage) ?? 9) - (order.get(b.stage) ?? 9));
  const [cnt, val, wt] = [rows.reduce((t, r) => t + Number(r.c), 0), rows.reduce((t, r) => t + Number(r.v), 0), rows.reduce((t, r) => t + Number(r.w), 0)];
  return mk("pipeline", {
    title: "Open pipeline by stage",
    columns: ["Stage", "Deals", "Value", "Weighted value"],
    rows: rows.map((r) => [r.stage, Number(r.c), money(ws, Number(r.v)), money(ws, Number(r.w))]),
    facts: [`${plural(cnt, "open deal")} worth ${money(ws, val)}; probability-weighted ${money(ws, Math.round(wt))}.`],
    href: "/app/crm",
  });
};

const deals_closing: Exec = async (ws, p) => {
  const from = s(p, "from") ?? todayYmd();
  const to = s(p, "to") ?? addDaysYmd(from, 30);
  const d = schema.deals;
  const rows = await db
    .select({ id: d.id, title: d.title, stage: d.stage, value: d.value, close: d.expectedClose, company: schema.companies.name })
    .from(d)
    .leftJoin(schema.companies, eq(d.companyId, schema.companies.id))
    .where(and(eq(d.orgId, ws.org.id), inArray(d.stage, [...OPEN_STAGES]), isNotNull(d.expectedClose), gte(d.expectedClose, from), lte(d.expectedClose, to)))
    .orderBy(asc(d.expectedClose))
    .limit(MAX_ROWS);
  return mk("deals_closing", {
    title: `Deals closing ${rangeLabel(from, to)}`,
    columns: ["Deal", "Company", "Stage", "Value", "Expected close"],
    rows: rows.map((r) => [r.title, r.company ?? "—", r.stage, money(ws, r.value), formatDate(r.close)]),
    links: rows.map((r) => `/app/crm/deals/${r.id}`),
    facts: [`${plural(rows.length, "deal")} expected to close, worth ${money(ws, rows.reduce((t, r) => t + r.value, 0))}.`],
    href: "/app/crm",
  });
};

const won_lost: Exec = async (ws, p) => {
  const from = s(p, "from") ?? `${todayYmd().slice(0, 7)}-01`;
  const to = s(p, "to") ?? todayYmd();
  const d = schema.deals;
  const rows = await db
    .select({ id: d.id, title: d.title, stage: d.stage, value: d.value, closed: d.closedAt, reason: d.lostReason, company: schema.companies.name })
    .from(d)
    .leftJoin(schema.companies, eq(d.companyId, schema.companies.id))
    .where(and(eq(d.orgId, ws.org.id), inArray(d.stage, ["won", "lost"]), isNotNull(d.closedAt), gte(d.closedAt, startOf(from)), lte(d.closedAt, endOf(to))))
    .orderBy(desc(d.closedAt))
    .limit(200);
  const won = rows.filter((r) => r.stage === "won");
  const lost = rows.filter((r) => r.stage === "lost");
  const sumV = (x: typeof rows) => x.reduce((t, r) => t + r.value, 0);
  const rate = rows.length ? Math.round((won.length / rows.length) * 100) : 0;
  return mk("won_lost", {
    title: `Deals won & lost, ${rangeLabel(from, to)}`,
    columns: ["Deal", "Company", "Outcome", "Value", "Closed"],
    rows: rows.map((r) => [r.title, r.company ?? "—", r.stage, money(ws, r.value), r.closed ? formatDate(r.closed) : "—"]),
    links: rows.map((r) => `/app/crm/deals/${r.id}`),
    facts: [`Won ${won.length} (${money(ws, sumV(won))}), lost ${lost.length} (${money(ws, sumV(lost))}); win rate ${rate}%.`],
    href: "/app/crm",
  });
};

const on_leave: Exec = async (ws, p) => {
  const from = s(p, "from") ?? todayYmd();
  const to = s(p, "to") ?? from;
  const dept = s(p, "department")?.trim();
  const loc = s(p, "location")?.trim();
  const lr = schema.leaveRequests;
  const e = schema.employees;
  const rows = await db
    .select({ id: e.id, name: e.name, designation: e.designation, location: e.workLocation, dept: schema.departments.name, type: schema.leaveTypes.name, start: lr.startDate, end: lr.endDate, days: lr.days })
    .from(lr)
    .innerJoin(e, and(eq(lr.employeeId, e.id), eq(e.orgId, ws.org.id)))
    .innerJoin(schema.leaveTypes, eq(lr.leaveTypeId, schema.leaveTypes.id))
    .leftJoin(schema.departments, eq(e.departmentId, schema.departments.id))
    .where(
      and(
        eq(lr.orgId, ws.org.id),
        eq(lr.status, "approved"),
        lte(lr.startDate, to),
        gte(lr.endDate, from),
        ne(e.status, "exited"),
        dept ? like(schema.departments.name, `%${esc(dept)}%`) : undefined,
        loc ? like(e.workLocation, `%${esc(loc)}%`) : undefined,
      ),
    )
    .orderBy(asc(lr.startDate), asc(e.name))
    .limit(MAX_ROWS);
  const scope = [dept && `department “${dept}”`, loc && `location “${loc}”`].filter(Boolean).join(", ");
  return mk("on_leave", {
    title: `On leave ${rangeLabel(from, to)}${scope ? ` · ${scope}` : ""}`,
    columns: ["Employee", "Role", "Department", "Location", "Leave type", "From", "To", "Days"],
    rows: rows.map((r) => [r.name, r.designation, r.dept ?? "—", r.location ?? "—", r.type, formatDate(r.start), formatDate(r.end), r.days]),
    links: rows.map((r) => `/app/hrm/${r.id}`),
    facts: [rows.length ? `${plural(new Set(rows.map((r) => r.id)).size, "employee")} on approved leave.` : "Nobody is on approved leave in that range."],
    href: "/app/hrm/leave",
  });
};

const headcount: Exec = async (ws) => {
  const e = schema.employees;
  const rows = await db
    .select({ dept: schema.departments.name, c: sql<number>`count(*)` })
    .from(e)
    .leftJoin(schema.departments, eq(e.departmentId, schema.departments.id))
    .where(and(eq(e.orgId, ws.org.id), ne(e.status, "exited")))
    .groupBy(schema.departments.name)
    .orderBy(desc(sql`count(*)`));
  const total = rows.reduce((t, r) => t + Number(r.c), 0);
  return mk("headcount", {
    title: "Headcount by department",
    columns: ["Department", "Employees"],
    rows: rows.map((r) => [r.dept ?? "No department", Number(r.c)]),
    facts: [`${plural(total, "active employee")} across ${plural(rows.length, "department")}.`],
    href: "/app/hrm",
  });
};

const attendance_today: Exec = async (ws, p) => {
  const date = s(p, "date") ?? todayYmd();
  const e = schema.employees;
  const [[active], marks] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(e).where(and(eq(e.orgId, ws.org.id), eq(e.status, "active"))),
    db
      .select({ name: e.name, status: schema.attendance.status })
      .from(schema.attendance)
      .innerJoin(e, and(eq(schema.attendance.employeeId, e.id), eq(e.orgId, ws.org.id)))
      .where(and(eq(schema.attendance.orgId, ws.org.id), eq(schema.attendance.date, date), eq(e.status, "active"))),
  ]);
  const counts = new Map<string, number>();
  for (const m of marks) counts.set(m.status, (counts.get(m.status) ?? 0) + 1);
  const unmarked = Math.max(0, Number(active?.c ?? 0) - marks.length);
  const absent = marks.filter((m) => m.status === "absent").map((m) => m.name);
  return mk("attendance_today", {
    title: `Attendance on ${formatDate(date)}`,
    columns: ["Status", "Employees"],
    rows: [...[...counts.entries()].map(([k, v]) => [k.replace("_", " "), v] as Cell[]), ["not marked", unmarked]],
    facts: [
      `${plural(Number(active?.c ?? 0), "active employee")}; ${counts.get("present") ?? 0} present, ${counts.get("wfh") ?? 0} working from home, ${counts.get("leave") ?? 0} on leave, ${unmarked} not marked.`,
      ...(absent.length ? [`Absent: ${absent.slice(0, 10).join(", ")}${absent.length > 10 ? "…" : ""}.`] : []),
    ],
    href: "/app/hrm/attendance",
  });
};

const upcoming_events: Exec = async (ws, p) => {
  const days = n(p, "days") ?? 30;
  const kind = s(p, "kind") ?? "both";
  const today = todayYmd();
  const end = addDaysYmd(today, days);
  const e = schema.employees;
  const emps = await db
    .select({ id: e.id, name: e.name, dob: e.dob, join: e.joinDate })
    .from(e)
    .where(and(eq(e.orgId, ws.org.id), ne(e.status, "exited")));
  const nextOccurrence = (ymd: string) => {
    const [y0, m, d] = [Number(today.slice(0, 4)), ymd.slice(5, 7), ymd.slice(8, 10)];
    let c = new Date(Date.UTC(y0, Number(m) - 1, Number(d))).toISOString().slice(0, 10);
    if (c < today) c = new Date(Date.UTC(y0 + 1, Number(m) - 1, Number(d))).toISOString().slice(0, 10);
    return c;
  };
  const out: { id: number; name: string; event: string; date: string; detail: string }[] = [];
  for (const emp of emps) {
    if (kind !== "anniversaries" && emp.dob) {
      const d = nextOccurrence(emp.dob);
      if (d <= end) out.push({ id: emp.id, name: emp.name, event: "Birthday", date: d, detail: "" });
    }
    if (kind !== "birthdays" && emp.join) {
      const d = nextOccurrence(emp.join);
      const years = Number(d.slice(0, 4)) - Number(emp.join.slice(0, 4));
      if (d <= end && years > 0) out.push({ id: emp.id, name: emp.name, event: "Work anniversary", date: d, detail: plural(years, "year") });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const shown = out.slice(0, MAX_ROWS);
  return mk("upcoming_events", {
    title: `Birthdays & anniversaries, next ${days} days`,
    columns: ["Employee", "Event", "Date", "Detail"],
    rows: shown.map((r) => [r.name, r.event, formatDate(r.date), r.detail || "—"]),
    links: shown.map((r) => `/app/hrm/${r.id}`),
    facts: [`${plural(out.length, "event")} between ${formatDate(today)} and ${formatDate(end)}.`],
    href: "/app/hrm",
  });
};

const low_stock: Exec = async (ws, p) => {
  const maxDays = n(p, "maxDaysCover") ?? 14;
  const products = await getProductsWithStock(ws.org.id);
  const flagged = products
    .filter((x) => x.active && x.trackStock)
    .map((x) => ({ ...x, cover: daysOfCover(x.onHand, x.outflow30) }))
    .filter((x) => isLowStock(x.onHand, x.reorderLevel) || (x.cover !== null && x.cover < maxDays))
    .sort((a, b) => (a.cover ?? 1e9) - (b.cover ?? 1e9));
  return mk("low_stock", {
    title: `Products below reorder level or under ${maxDays} days of cover`,
    columns: ["SKU", "Product", "On hand", "Reorder level", "Days of cover", "Suggested order"],
    rows: flagged.map((x) => [x.sku, x.name, `${fmtQty(x.onHand)} ${x.unit}`, fmtQty(x.reorderLevel), x.cover === null ? "no recent usage" : Math.round(x.cover), fmtQty(suggestedQty(x.onHand, x.reorderLevel, x.reorderQty))]),
    links: flagged.map((x) => `/app/inventory/products/${x.id}`),
    facts: [`${plural(flagged.length, "product")} need attention. Open the reorder planner to draft purchase orders.`],
    href: "/app/inventory/reorder",
  });
};

const stock_value: Exec = async (ws) => {
  const sl = schema.stockLevels;
  const rows = await db
    .select({ id: schema.warehouses.id, name: schema.warehouses.name, units: sql<number>`coalesce(sum(${sl.quantity}), 0)`, v: sql<number>`coalesce(sum(${sl.quantity} * ${schema.products.costPrice}), 0)` })
    .from(sl)
    .innerJoin(schema.products, and(eq(sl.productId, schema.products.id), eq(schema.products.orgId, ws.org.id)))
    .innerJoin(schema.warehouses, and(eq(sl.warehouseId, schema.warehouses.id), eq(schema.warehouses.orgId, ws.org.id)))
    .where(eq(sl.orgId, ws.org.id))
    .groupBy(schema.warehouses.id)
    .orderBy(desc(sql`sum(${sl.quantity} * ${schema.products.costPrice})`));
  const total = rows.reduce((t, r) => t + Number(r.v), 0);
  return mk("stock_value", {
    title: "Stock value by warehouse",
    columns: ["Warehouse", "Units", "Value at cost"],
    rows: rows.map((r) => [r.name, fmtQty(Number(r.units)), money(ws, Math.round(Number(r.v)))]),
    facts: [`Total stock value ${money(ws, Math.round(total))} across ${plural(rows.length, "warehouse")}.`],
    href: "/app/inventory/warehouses",
  });
};

const open_tickets: Exec = async (ws) => {
  const t = schema.tickets;
  const now = new Date();
  const rows = await db
    .select({ id: t.id, number: t.number, subject: t.subject, priority: t.priority, status: t.status, requester: t.requesterName, frDue: t.firstResponseDueAt, frAt: t.firstRespondedAt, resDue: t.resolutionDueAt })
    .from(t)
    .where(and(eq(t.orgId, ws.org.id), inArray(t.status, ["open", "pending", "on_hold"])))
    .orderBy(sql`case ${t.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, asc(t.createdAt))
    .limit(200);
  const breach = (r: (typeof rows)[number]) => (r.resDue && r.resDue < now ? "Resolution SLA breached" : !r.frAt && r.frDue && r.frDue < now ? "First response SLA breached" : null);
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.priority, (by.get(r.priority) ?? 0) + 1);
  const breached = rows.filter((r) => breach(r)).length;
  return mk("open_tickets", {
    title: "Open tickets",
    columns: ["Ticket", "Subject", "Priority", "Status", "Requester", "SLA"],
    rows: rows.map((r) => [r.number, r.subject, r.priority, r.status.replace("_", " "), r.requester, breach(r) ?? "On track"]),
    links: rows.map((r) => `/app/helpdesk/tickets/${r.id}`),
    facts: [
      `${plural(rows.length, "open ticket")}: ${["urgent", "high", "medium", "low"].map((k) => `${by.get(k) ?? 0} ${k}`).join(", ")}.`,
      `${plural(breached, "ticket")} breached an SLA.`,
    ],
    href: "/app/helpdesk",
  });
};

const overdue_tasks: Exec = async (ws) => {
  const today = todayYmd();
  const t = schema.tasks;
  const rows = await db
    .select({ projectId: t.projectId, title: t.title, due: t.dueDate, priority: t.priority, status: t.status, project: schema.projects.name, who: schema.employees.name })
    .from(t)
    .innerJoin(schema.projects, and(eq(t.projectId, schema.projects.id), eq(schema.projects.orgId, ws.org.id)))
    .leftJoin(schema.employees, eq(t.assigneeId, schema.employees.id))
    .where(and(eq(t.orgId, ws.org.id), ne(t.status, "done"), isNotNull(t.dueDate), lt(t.dueDate, today), ne(schema.projects.status, "cancelled")))
    .orderBy(asc(t.dueDate))
    .limit(MAX_ROWS);
  return mk("overdue_tasks", {
    title: "Overdue tasks",
    columns: ["Task", "Project", "Assignee", "Priority", "Due", "Days late"],
    rows: rows.map((r) => [r.title, r.project, r.who ?? "Unassigned", r.priority, formatDate(r.due), daysBetween(r.due ?? today, today)]),
    links: rows.map((r) => `/app/projects/${r.projectId}`),
    facts: [`${plural(rows.length, "task")} past due${rows.length === MAX_ROWS ? " (showing the first 50)" : ""}.`],
    href: "/app/projects/my-tasks",
  });
};

const project_status: Exec = async (ws) => {
  const today = todayYmd();
  const pr = schema.projects;
  const [projects, stats] = await Promise.all([
    db
      .select({ id: pr.id, code: pr.code, name: pr.name, status: pr.status, due: pr.dueDate })
      .from(pr)
      .where(and(eq(pr.orgId, ws.org.id), inArray(pr.status, ["planning", "active", "on_hold"])))
      .orderBy(asc(pr.dueDate))
      .limit(MAX_ROWS),
    db
      .select({
        projectId: schema.tasks.projectId,
        total: sql<number>`count(*)`,
        done: sql<number>`coalesce(sum(case when ${schema.tasks.status} = 'done' then 1 else 0 end), 0)`,
        late: sql<number>`coalesce(sum(case when ${schema.tasks.status} != 'done' and ${schema.tasks.dueDate} < ${today} then 1 else 0 end), 0)`,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.orgId, ws.org.id))
      .groupBy(schema.tasks.projectId),
  ]);
  const st = new Map(stats.map((x) => [x.projectId, x]));
  return mk("project_status", {
    title: "Projects in flight",
    columns: ["Project", "Status", "Due", "Tasks done", "Overdue tasks"],
    rows: projects.map((x) => [`${x.code} · ${x.name}`, x.status.replace("_", " "), x.due ? formatDate(x.due) : "—", `${st.get(x.id)?.done ?? 0}/${st.get(x.id)?.total ?? 0}`, Number(st.get(x.id)?.late ?? 0)]),
    links: projects.map((x) => `/app/projects/${x.id}`),
    facts: [`${plural(projects.length, "project")} not yet finished; ${plural(projects.filter((x) => (st.get(x.id)?.late ?? 0) > 0).length, "project")} with overdue tasks.`],
    href: "/app/projects",
  });
};

const payroll_cost: Exec = async (ws, p) => {
  const month = s(p, "month");
  const r = schema.payrollRuns;
  const rows = await db
    .select()
    .from(r)
    .where(and(eq(r.orgId, ws.org.id), month ? eq(r.period, month) : undefined))
    .orderBy(desc(r.period))
    .limit(month ? 1 : 6);
  return mk("payroll_cost", {
    title: month ? `Payroll for ${formatPeriod(month)}` : "Latest payroll runs",
    columns: ["Period", "Status", "Employees", "Gross", "Deductions", "Net pay", "Employer cost"],
    rows: rows.map((x) => [formatPeriod(x.period), x.status, x.employeeCount, money(ws, x.totalGross), money(ws, x.totalDeductions), money(ws, x.totalNet), money(ws, x.totalEmployerCost)]),
    links: rows.map((x) => `/app/payroll/${x.id}`),
    facts: rows.length
      ? [`${formatPeriod(rows[0].period)}: gross ${money(ws, rows[0].totalGross)}, net ${money(ws, rows[0].totalNet)}, employer cost ${money(ws, rows[0].totalEmployerCost)} for ${plural(rows[0].employeeCount, "employee")} (${rows[0].status}).`]
      : [month ? `No payroll run found for ${formatPeriod(month)}.` : "No payroll runs yet."],
    href: "/app/payroll",
  });
};

const EXECUTORS: Record<ToolName, Exec> = {
  overdue_invoices,
  receivables,
  revenue_expenses,
  cash_balance,
  top_customers,
  pipeline,
  deals_closing,
  won_lost,
  on_leave,
  headcount,
  attendance_today,
  upcoming_events,
  low_stock,
  stock_value,
  open_tickets,
  overdue_tasks,
  project_status,
  payroll_cost,
};

/** Names of tools this user may run (module access by role + plan). */
export function allowedToolNames(ws: ActiveWorkspace): ToolName[] {
  return TOOL_DEFS.filter((t) => canUseModule(ws, t.module)).map((t) => t.name);
}

/** Validates params, re-checks access, and runs one tool. Throws on unknown/forbidden tools or bad params. */
export async function runTool(ws: ActiveWorkspace, name: string, params: unknown): Promise<ToolResult> {
  const def = toolDef(name);
  if (!def || !(name in EXECUTORS)) throw new Error(`Unknown tool ${name}`);
  if (!canUseModule(ws, def.module)) throw new Error(`No access to ${def.module}`);
  const parsed = def.params.safeParse(params ?? {});
  if (!parsed.success) throw new Error("Invalid tool parameters");
  return EXECUTORS[name as ToolName](ws, parsed.data as Params);
}
