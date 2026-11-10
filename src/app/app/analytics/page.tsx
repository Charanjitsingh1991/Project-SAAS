import type { Metadata } from "next";
import { and, eq, gte, sql } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Stat } from "@/components/app/ui";
import { db, schema } from "@/db";
import { DEAL_STAGES } from "@/db/schema";
import { formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

function lastMonths(n: number) {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

function Bars({ rows, format, tone = "bg-ink" }: { rows: { label: string; value: number }[]; format: (n: number) => string; tone?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.every((r) => r.value === 0)) return <EmptyState title="No data yet" />;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-ink-soft capitalize">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-paper-2">
            <span className={cn("block h-full rounded-full", tone)} style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="tabular-nums">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function AnalyticsPage() {
  const ws = await requireWorkspace({ module: "analytics" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const months = lastMonths(6);
  const since = `${months[0]}-01`;

  const [income, spend, pipeline, headcount, tickets, stock] = await Promise.all([
    db
      .select({ m: sql<string>`substr(${schema.invoices.issueDate}, 1, 7)`, v: sql<number>`sum(${schema.invoices.amount})` })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orgId, orgId), eq(schema.invoices.status, "paid"), gte(schema.invoices.issueDate, since)))
      .groupBy(sql`1`),
    db
      .select({ m: sql<string>`substr(${schema.expenses.date}, 1, 7)`, v: sql<number>`sum(${schema.expenses.amount})` })
      .from(schema.expenses)
      .where(and(eq(schema.expenses.orgId, orgId), gte(schema.expenses.date, since)))
      .groupBy(sql`1`),
    db
      .select({ stage: schema.deals.stage, v: sql<number>`sum(${schema.deals.value})`, n: sql<number>`count(*)` })
      .from(schema.deals)
      .where(eq(schema.deals.orgId, orgId))
      .groupBy(schema.deals.stage),
    db
      .select({ dept: schema.employees.department, n: sql<number>`count(*)` })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.status, "active")))
      .groupBy(schema.employees.department),
    db
      .select({ status: schema.tickets.status, n: sql<number>`count(*)` })
      .from(schema.tickets)
      .where(eq(schema.tickets.orgId, orgId))
      .groupBy(schema.tickets.status),
    db
      .select({ v: sql<number>`coalesce(sum(${schema.products.quantity} * ${schema.products.unitCost}), 0)` })
      .from(schema.products)
      .where(eq(schema.products.orgId, orgId)),
  ]);

  const inc = new Map(income.map((r) => [r.m, r.v]));
  const exp = new Map(spend.map((r) => [r.m, r.v]));
  const totalIn = income.reduce((s, r) => s + r.v, 0);
  const totalOut = spend.reduce((s, r) => s + r.v, 0);
  const maxMonth = Math.max(1, ...months.map((m) => Math.max(inc.get(m) ?? 0, exp.get(m) ?? 0)));
  const won = pipeline.find((p) => p.stage === "won");
  const lost = pipeline.find((p) => p.stage === "lost");
  const winRate = won || lost ? Math.round(((won?.n ?? 0) / ((won?.n ?? 0) + (lost?.n ?? 0))) * 100) : 0;
  const fmt = (n: number) => formatMoney(n, cur);

  return (
    <>
      <PageHeader title="Analytics" description="Live numbers pulled from every module — no exports, no spreadsheets." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Collected · 6 mo" value={fmt(totalIn)} tone="mint" />
        <Stat label="Spent · 6 mo" value={fmt(totalOut)} tone="peach" />
        <Stat label="Net · 6 mo" value={fmt(totalIn - totalOut)} tone={totalIn - totalOut >= 0 ? "lime" : "rose"} />
        <Stat label="Win rate" value={`${winRate}%`} hint={`Stock value ${fmt(stock[0]?.v ?? 0)}`} tone="sky" />
      </div>

      <Card title="Cash in vs. cash out" className="mt-6">
        <div className="flex h-56 items-end gap-3 border-b border-line pb-1 sm:gap-6">
          {months.map((m) => {
            const i = inc.get(m) ?? 0;
            const o = exp.get(m) ?? 0;
            return (
              <div key={m} className="flex h-full flex-1 flex-col justify-end">
                <div className="flex h-full items-end justify-center gap-1">
                  <span title={`In ${fmt(i)}`} className="w-1/3 max-w-6 rounded-t-md bg-ink" style={{ height: `${(i / maxMonth) * 100}%` }} />
                  <span title={`Out ${fmt(o)}`} className="w-1/3 max-w-6 rounded-t-md bg-signal/80" style={{ height: `${(o / maxMonth) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-3 sm:gap-6">
          {months.map((m) => (
            <span key={m} className="flex-1 text-center font-mono text-[11px] text-ink-mute">
              {new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}
            </span>
          ))}
        </div>
        <p className="mt-3 flex gap-4 text-xs text-ink-soft">
          <span className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-ink" /> Paid invoices
          </span>
          <span className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-signal/80" /> Expenses
          </span>
        </p>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Pipeline by stage">
          <Bars rows={DEAL_STAGES.map((s) => ({ label: s, value: pipeline.find((p) => p.stage === s)?.v ?? 0 }))} format={fmt} tone="bg-butter border border-ink/10" />
        </Card>
        <Card title="Headcount by department">
          <Bars rows={headcount.map((h) => ({ label: h.dept, value: h.n }))} format={(n) => String(n)} tone="bg-mint border border-ink/10" />
        </Card>
        <Card title="Tickets by status">
          <Bars
            rows={(["open", "pending", "resolved"] as const).map((s) => ({ label: s, value: tickets.find((t) => t.status === s)?.n ?? 0 }))}
            format={(n) => String(n)}
            tone="bg-rose border border-ink/10"
          />
        </Card>
      </div>
    </>
  );
}
