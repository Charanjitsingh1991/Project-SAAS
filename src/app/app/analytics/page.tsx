import type { Metadata } from "next";
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Info } from "lucide-react";
import { Card, EmptyState, PageHeader, Stat } from "@/components/app/ui";
import { db, schema } from "@/db";
import { DEAL_STAGES, STAGE_PROBABILITY } from "@/db/schema";
import { fiscalYear } from "@/lib/accounting";
import { formatMoneyCompact, formatPeriod, todayYmd } from "@/lib/format";
import { computeInsights } from "@/lib/insights";
import { canUseModule, requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

const RANGES = { month: "This month", quarter: "Last 3 months", fy: "This fiscal year" } as const;
type Range = keyof typeof RANGES;

function rangeDates(range: Range, today: string): [string, string] {
  if (range === "month") return [`${today.slice(0, 7)}-01`, today];
  if (range === "quarter") {
    const d = new Date(`${today}T00:00:00Z`);
    return [new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1)).toISOString().slice(0, 10), today];
  }
  return [fiscalYear(today)[0], today];
}

function monthsBack(n: number, today: string) {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (n - 1 - i), 1)).toISOString().slice(0, 7));
}

const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

function Bars({ rows, format, tone = "bg-ink" }: { rows: { label: string; value: number; href?: string }[]; format: (n: number) => string; tone?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (rows.every((r) => r.value === 0)) return <EmptyState title="No data yet" />;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(80px,130px)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-ink-soft capitalize">{r.label.replaceAll("_", " ")}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-paper-2">
            <span className={cn("block h-full rounded-full", tone)} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
          </span>
          <span className="tabular-nums">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function Spark({ points, tone = "bg-ink" }: { points: { label: string; value: number }[]; tone?: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div>
      <div className="flex h-28 items-end gap-1.5">
        {points.map((p) => (
          <span key={p.label} title={`${p.label}: ${p.value}`} className={cn("flex-1 rounded-t-sm", tone)} style={{ height: `${Math.max(2, (p.value / max) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-mute">
        <span>{points[0]?.label}</span>
        <span>{points.at(-1)?.label}</span>
      </div>
    </div>
  );
}

export default async function AnalyticsPage(props: PageProps<"/app/analytics">) {
  const ws = await requireWorkspace({ module: "analytics" });
  const sp = await props.searchParams;
  const range: Range = sp.range === "quarter" || sp.range === "fy" ? sp.range : "month";
  const today = todayYmd();
  const [from, to] = rangeDates(range, today);
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const fmt = (n: number) => formatMoneyCompact(n, cur);
  const months12 = monthsBack(12, today);
  const showMonths = range === "fy" ? monthsBack(Math.max(1, months12.length), today).filter((m) => m >= from.slice(0, 7)) : monthsBack(range === "quarter" ? 3 : 6, today);

  /* ── Ledger-based finance ── */
  const ledgerByType = db
    .select({
      type: schema.accounts.type,
      key: schema.accounts.systemKey,
      m: sql<string>`substr(${schema.journalEntries.date}, 1, 7)`,
      dr: sql<number>`sum(${schema.journalLines.debit})`,
      cr: sql<number>`sum(${schema.journalLines.credit})`,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.entryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(eq(schema.journalLines.orgId, orgId))
    .groupBy(schema.accounts.type, schema.accounts.systemKey, sql`3`);

  const [ledger, openDeals, closedDeals, emps, payrollRuns, leaveUsed, leaveQuota, inventoryValue, time, tickets, projects] = await Promise.all([
    ledgerByType,
    db
      .select({ stage: schema.deals.stage, v: sql<number>`sum(${schema.deals.value})`, w: sql<number>`sum(${schema.deals.value} * ${schema.deals.probability} / 100.0)`, n: sql<number>`count(*)` })
      .from(schema.deals)
      .where(eq(schema.deals.orgId, orgId))
      .groupBy(schema.deals.stage),
    db
      .select({ stage: schema.deals.stage, created: schema.deals.createdAt, closed: schema.deals.closedAt })
      .from(schema.deals)
      .where(and(eq(schema.deals.orgId, orgId), inArray(schema.deals.stage, ["won", "lost"]), gte(schema.deals.closedAt, new Date(`${from}T00:00:00Z`)))),
    db.select({ join: schema.employees.joinDate, exit: schema.employees.exitDate, dept: schema.employees.departmentId }).from(schema.employees).where(eq(schema.employees.orgId, orgId)),
    db
      .select({ period: schema.payrollRuns.period, gross: schema.payrollRuns.totalGross, employer: schema.payrollRuns.totalEmployerCost })
      .from(schema.payrollRuns)
      .where(and(eq(schema.payrollRuns.orgId, orgId), ne(schema.payrollRuns.status, "draft"))),
    db
      .select({ d: sql<number>`coalesce(sum(${schema.leaveRequests.days}), 0)` })
      .from(schema.leaveRequests)
      .where(and(eq(schema.leaveRequests.orgId, orgId), eq(schema.leaveRequests.status, "approved"), gte(schema.leaveRequests.startDate, `${today.slice(0, 4)}-01-01`))),
    db
      .select({ q: sql<number>`coalesce(sum(${schema.leaveTypes.annualQuota}), 0)` })
      .from(schema.leaveTypes)
      .where(and(eq(schema.leaveTypes.orgId, orgId), eq(schema.leaveTypes.paid, true), eq(schema.leaveTypes.active, true))),
    db
      .select({ v: sql<number>`coalesce(sum(${schema.stockLevels.quantity} * ${schema.products.costPrice}), 0)` })
      .from(schema.stockLevels)
      .innerJoin(schema.products, eq(schema.stockLevels.productId, schema.products.id))
      .where(eq(schema.stockLevels.orgId, orgId)),
    db
      .select({ total: sql<number>`coalesce(sum(${schema.timeEntries.hours}), 0)`, billable: sql<number>`coalesce(sum(case when ${schema.timeEntries.billable} then ${schema.timeEntries.hours} else 0 end), 0)` })
      .from(schema.timeEntries)
      .where(and(eq(schema.timeEntries.orgId, orgId), gte(schema.timeEntries.date, from), lte(schema.timeEntries.date, to))),
    db
      .select({ status: schema.tickets.status, resolvedAt: schema.tickets.resolvedAt, due: schema.tickets.resolutionDueAt, csat: schema.tickets.csatRating, created: schema.tickets.createdAt })
      .from(schema.tickets)
      .where(eq(schema.tickets.orgId, orgId)),
    db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        billing: schema.projects.billingType,
        budget: schema.projects.budget,
        rate: schema.projects.hourlyRate,
        cost: sql<number>`(select coalesce(sum("time_entries"."hours" * "employees"."annual_ctc" / 2080.0), 0) from "time_entries" join "employees" on "employees"."id" = "time_entries"."employee_id" where "time_entries"."project_id" = "projects"."id")`,
        billable: sql<number>`(select coalesce(sum("time_entries"."hours"), 0) from "time_entries" where "time_entries"."project_id" = "projects"."id" and "time_entries"."billable" = 1)`,
      })
      .from(schema.projects)
      .where(and(eq(schema.projects.orgId, orgId), inArray(schema.projects.status, ["active", "done", "planning"]))),
  ]);
  const insights = await computeInsights(ws, 12);

  // Finance aggregates
  const inRange = (m: string) => m >= from.slice(0, 7) && m <= to.slice(0, 7);
  let revenue = 0;
  let expense = 0;
  let cash = 0;
  let gstOut = 0;
  let gstIn = 0;
  let receivable = 0;
  const revByMonth = new Map<string, number>();
  const expByMonth = new Map<string, number>();
  for (const r of ledger) {
    const dr = Number(r.dr);
    const cr = Number(r.cr);
    if (r.key === "bank") cash += dr - cr;
    if (r.key === "gst_out") gstOut += cr - dr;
    if (r.key === "gst_in") gstIn += dr - cr;
    if (r.key === "ar") receivable += dr - cr;
    if (r.type === "income") {
      revByMonth.set(r.m, (revByMonth.get(r.m) ?? 0) + cr - dr);
      if (inRange(r.m)) revenue += cr - dr;
    }
    if (r.type === "expense") {
      expByMonth.set(r.m, (expByMonth.get(r.m) ?? 0) + dr - cr);
      if (inRange(r.m)) expense += dr - cr;
    }
  }
  const chartMonths = showMonths.length ? showMonths : months12.slice(-6);
  const maxMonth = Math.max(1, ...chartMonths.map((m) => Math.max(revByMonth.get(m) ?? 0, expByMonth.get(m) ?? 0)));

  // Sales
  const open = openDeals.filter((d) => !["won", "lost"].includes(d.stage));
  const weighted = open.reduce((s, d) => s + Number(d.w), 0);
  const won = closedDeals.filter((d) => d.stage === "won");
  const winRate = closedDeals.length ? Math.round((won.length / closedDeals.length) * 100) : 0;
  const cycle = won.length ? Math.round(won.reduce((s, d) => s + ((d.closed?.getTime() ?? 0) - d.created.getTime()) / 86_400_000, 0) / won.length) : 0;

  // People
  const headcount = months12.map((m) => {
    const end = monthEnd(m);
    return { label: formatPeriod(m), value: emps.filter((e) => e.join <= end && (!e.exit || e.exit > end)).length };
  });
  const joiners = emps.filter((e) => e.join >= from && e.join <= to).length;
  const exits = emps.filter((e) => e.exit && e.exit >= from && e.exit <= to).length;
  const yearAgo = new Date(`${today}T00:00:00Z`);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const exits12 = emps.filter((e) => e.exit && e.exit > yearAgo.toISOString().slice(0, 10) && e.exit <= today).length;
  const avgHead = headcount.reduce((s, h) => s + h.value, 0) / Math.max(1, headcount.length);
  const attrition = avgHead ? Math.round((exits12 / avgHead) * 1000) / 10 : 0;
  const activeNow = headcount.at(-1)?.value ?? 0;
  const leaveUtil = Number(leaveQuota[0]?.q) && activeNow ? Math.round((Number(leaveUsed[0]?.d) / (Number(leaveQuota[0]?.q) * activeNow)) * 100) : 0;
  const payrollTrend = months12.map((m) => {
    const r = payrollRuns.find((p) => p.period === m);
    return { label: formatPeriod(m), value: r ? r.gross + r.employer : 0 };
  });

  // Projects
  const utilisation = Number(time[0]?.total) ? Math.round((Number(time[0]?.billable) / Number(time[0]?.total)) * 100) : 0;
  const margins = projects
    .map((p) => {
      const revenueP = p.billing === "fixed" ? p.budget : p.billing === "hourly" ? Math.round(Number(p.billable) * p.rate) : 0;
      return { label: p.name, value: revenueP - Math.round(Number(p.cost)), revenue: revenueP };
    })
    .filter((p) => p.revenue > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Support
  const openTickets = tickets.filter((t) => ["open", "pending", "on_hold"].includes(t.status)).length;
  const resolvedInRange = tickets.filter((t) => t.resolvedAt && t.resolvedAt >= new Date(`${from}T00:00:00Z`));
  const slaOk = resolvedInRange.filter((t) => !t.due || (t.resolvedAt && t.resolvedAt <= t.due)).length;
  const slaPct = resolvedInRange.length ? Math.round((slaOk / resolvedInRange.length) * 100) : 100;
  const rated = tickets.filter((t) => t.csat);
  const csat = rated.length ? (rated.reduce((s, t) => s + (t.csat ?? 0), 0) / rated.length).toFixed(1) : "—";

  const can = (m: Parameters<typeof canUseModule>[1]) => canUseModule(ws, m);

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Live numbers from every module · ${RANGES[range]} (${from} → ${to})`}
        tabs={(Object.keys(RANGES) as Range[]).map((r) => ({ href: `/app/analytics?range=${r}`, label: RANGES[r], active: r === range }))}
      />

      <Card
        title={
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" /> Insights
          </span>
        }
        className="mb-6"
      >
        {insights.length === 0 ? (
          <p className="text-sm text-ink-soft">All clear — no stuck deals, overdue invoices, stock-outs or SLA breaches right now.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {insights.map((i, n) => (
              <li key={n}>
                <Link href={i.href} className="group flex items-start gap-3 rounded-2xl border border-line p-3 hover:border-ink">
                  <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", i.severity === "high" ? "bg-signal" : i.severity === "medium" ? "bg-butter border border-ink/20" : "bg-sky border border-ink/20")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{i.title}</span>
                    <span className="block text-xs text-ink-soft">{i.detail}</span>
                  </span>
                  <span className="font-mono text-[10px] tracking-widest text-ink-mute uppercase">{i.module}</span>
                  <ArrowUpRight className="size-4 shrink-0 opacity-30 group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="mb-3 font-display text-lg font-semibold">Finance</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Revenue" value={fmt(revenue)} tone="mint" />
        <Stat label="Expenses" value={fmt(expense)} tone="peach" />
        <Stat label="Net profit" value={fmt(revenue - expense)} tone={revenue - expense >= 0 ? "lime" : "rose"} hint={revenue > 0 ? `${Math.round(((revenue - expense) / revenue) * 100)}% margin` : undefined} />
        <Stat label="Cash balance" value={fmt(cash)} tone="sky" />
        <Stat label="Receivables" value={fmt(receivable)} hint={`GST payable ${fmt(gstOut - gstIn)}`} />
      </div>
      <Card title="Revenue vs expenses (from the ledger)" className="mt-4">
        <div className="flex h-52 items-end gap-2 border-b border-line pb-1 sm:gap-4">
          {chartMonths.map((m) => {
            const i = revByMonth.get(m) ?? 0;
            const o = expByMonth.get(m) ?? 0;
            return (
              <div key={m} className="flex h-full flex-1 items-end justify-center gap-1">
                <span title={`Revenue ${fmt(i)}`} className="w-1/3 max-w-7 rounded-t-md bg-ink" style={{ height: `${(Math.max(0, i) / maxMonth) * 100}%` }} />
                <span title={`Expenses ${fmt(o)}`} className="w-1/3 max-w-7 rounded-t-md bg-signal/80" style={{ height: `${(Math.max(0, o) / maxMonth) * 100}%` }} />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2 sm:gap-4">
          {chartMonths.map((m) => (
            <span key={m} className="flex-1 text-center font-mono text-[10px] text-ink-mute">
              {formatPeriod(m).split(" ")[0]}
            </span>
          ))}
        </div>
        <p className="mt-3 flex gap-4 text-xs text-ink-soft">
          <span className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-ink" /> Revenue
          </span>
          <span className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-signal/80" /> Expenses incl. COGS & payroll
          </span>
        </p>
      </Card>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-display text-lg font-semibold">Sales</h2>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Weighted forecast" value={fmt(Math.round(weighted))} tone="butter" />
            <Stat label="Win rate" value={`${winRate}%`} hint={`${closedDeals.length} closed`} />
            <Stat label="Avg cycle" value={`${cycle}d`} />
          </div>
          <Card title="Pipeline by stage" className="mt-3">
            <Bars
              rows={DEAL_STAGES.map((s) => ({ label: `${s} · ${STAGE_PROBABILITY[s]}%`, value: Number(openDeals.find((d) => d.stage === s)?.v ?? 0) }))}
              format={fmt}
              tone="bg-butter border border-ink/10"
            />
          </Card>
        </div>
        <div>
          <h2 className="mb-3 font-display text-lg font-semibold">People</h2>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Headcount" value={activeNow} tone="mint" hint={`+${joiners} / −${exits} in range`} />
            <Stat label="Attrition (12 mo)" value={`${attrition}%`} />
            <Stat label="Leave used" value={`${leaveUtil}%`} hint="of paid quota, YTD" />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Card title="Headcount · 12 months">
              <Spark points={headcount} tone="bg-mint border border-ink/10" />
            </Card>
            <Card title="Payroll cost · 12 months">
              <Spark points={payrollTrend} tone="bg-lilac border border-ink/10" />
            </Card>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {can("inventory") && (
          <div>
            <h2 className="mb-3 font-display text-lg font-semibold">Operations</h2>
            <Stat label="Inventory value" value={fmt(Math.round(Number(inventoryValue[0]?.v ?? 0)))} tone="peach" hint={`${insights.filter((i) => i.module === "inventory").length} stock-out risks`} />
          </div>
        )}
        <div>
          <h2 className="mb-3 font-display text-lg font-semibold">Projects</h2>
          <Stat label="Billable utilisation" value={`${utilisation}%`} tone="lilac" hint={`${Number(time[0]?.total ?? 0).toFixed(1)} hrs logged in range`} />
        </div>
        <div>
          <h2 className="mb-3 font-display text-lg font-semibold">Support</h2>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Open" value={openTickets} tone="rose" />
            <Stat label="SLA met" value={`${slaPct}%`} />
            <Stat label="CSAT" value={csat} />
          </div>
        </div>
      </div>

      <Card title="Project margin (revenue − people cost)" className="mt-6">
        {margins.length === 0 ? (
          <EmptyState title="No billable projects yet" />
        ) : (
          <Bars rows={margins} format={fmt} tone="bg-lilac border border-ink/10" />
        )}
        <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-mute">
          <Info className="size-3.5" /> People cost = logged hours × annual CTC ÷ 2,080 working hours.
        </p>
      </Card>
    </>
  );
}
