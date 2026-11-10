import "server-only";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatMoneyCompact } from "./money";
import { canUseModule, type ActiveWorkspace } from "./tenancy";

export type Insight = {
  severity: "high" | "medium" | "low";
  module: "crm" | "finance" | "inventory" | "helpdesk" | "projects" | "hrm";
  title: string;
  detail: string;
  href: string;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Rule-based signals computed from live data. Each links to the record or list to act on. */
export async function computeInsights(ws: ActiveWorkspace, limit = 20): Promise<Insight[]> {
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const now = new Date();
  const today = ymd(now);
  const out: Insight[] = [];
  const can = (m: Parameters<typeof canUseModule>[1]) => canUseModule(ws, m);

  if (can("crm")) {
    const stuck = await db
      .select({ id: schema.deals.id, title: schema.deals.title, stage: schema.deals.stage, since: schema.deals.stageChangedAt, value: schema.deals.value })
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.orgId, orgId),
          inArray(schema.deals.stage, ["lead", "qualified", "proposal", "negotiation"]),
          lt(schema.deals.stageChangedAt, new Date(now.getTime() - 21 * 86_400_000)),
        ),
      )
      .limit(5);
    for (const d of stuck) {
      const days = Math.floor((now.getTime() - d.since.getTime()) / 86_400_000);
      out.push({
        severity: d.value >= 50_000_000 ? "high" : "medium",
        module: "crm",
        title: `“${d.title}” stuck in ${d.stage} for ${days} days`,
        detail: `${formatMoneyCompact(d.value, cur)} at stake. Log a follow-up or move it forward.`,
        href: `/app/crm/deals/${d.id}`,
      });
    }
  }

  if (can("finance")) {
    const overdue = await db
      .select({ id: schema.invoices.id, number: schema.invoices.number, customer: schema.invoices.customerName, due: schema.invoices.dueDate, bal: sql<number>`${schema.invoices.total} - ${schema.invoices.amountPaid}` })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orgId, orgId), inArray(schema.invoices.status, ["sent", "partial"]), lt(schema.invoices.dueDate, ymd(new Date(now.getTime() - 30 * 86_400_000)))))
      .limit(5);
    for (const i of overdue) {
      const days = Math.floor((now.getTime() - Date.parse(`${i.due}T00:00:00Z`)) / 86_400_000);
      out.push({
        severity: "high",
        module: "finance",
        title: `${i.number} from ${i.customer} is ${days} days overdue`,
        detail: `${formatMoneyCompact(Number(i.bal), cur)} outstanding.`,
        href: `/app/finance/invoices/${i.id}`,
      });
    }

    // Expense spike: this month vs average of previous 3 months.
    const monthStart = `${today.slice(0, 7)}-01`;
    const threeAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
    const [spend] = await db
      .select({
        thisMonth: sql<number>`coalesce(sum(case when ${schema.expenses.date} >= ${monthStart} then ${schema.expenses.amount} else 0 end), 0)`,
        prior: sql<number>`coalesce(sum(case when ${schema.expenses.date} < ${monthStart} then ${schema.expenses.amount} else 0 end), 0)`,
      })
      .from(schema.expenses)
      .where(and(eq(schema.expenses.orgId, orgId), sql`${schema.expenses.date} >= ${ymd(threeAgo)}`, ne(schema.expenses.sourceType, "payroll")));
    const avg = Number(spend?.prior ?? 0) / 3;
    const thisMonth = Number(spend?.thisMonth ?? 0);
    if (avg > 0 && thisMonth > avg * 1.25) {
      out.push({
        severity: "medium",
        module: "finance",
        title: `Spending is ${Math.round((thisMonth / avg - 1) * 100)}% above your 3-month average`,
        detail: `${formatMoneyCompact(thisMonth, cur)} this month vs ${formatMoneyCompact(Math.round(avg), cur)} average (excl. payroll).`,
        href: "/app/finance/expenses",
      });
    }
  }

  if (can("inventory")) {
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const rows = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        onHand: sql<number>`(select coalesce(sum("stock_levels"."quantity"), 0) from "stock_levels" where "stock_levels"."product_id" = "products"."id")`,
        out30: sql<number>`(select coalesce(-sum("stock_movements"."quantity"), 0) from "stock_movements" where "stock_movements"."product_id" = "products"."id" and "stock_movements"."type" in ('sale','issue') and "stock_movements"."created_at" >= ${Math.floor(since.getTime() / 1000)})`,
      })
      .from(schema.products)
      .where(and(eq(schema.products.orgId, orgId), eq(schema.products.active, true), eq(schema.products.trackStock, true)));
    for (const p of rows) {
      const daily = Number(p.out30) / 30;
      const onHand = Number(p.onHand);
      if (onHand <= 0 && daily > 0) {
        out.push({
          severity: "high",
          module: "inventory",
          title: `${p.name} is out of stock`,
          detail: `${onHand} on hand while selling ~${daily.toFixed(1)}/day. Raise a purchase order.`,
          href: `/app/inventory/products/${p.id}`,
        });
      } else if (daily > 0 && onHand / daily < 14) {
        const days = Math.max(0, Math.floor(onHand / daily));
        out.push({
          severity: days < 5 ? "high" : "medium",
          module: "inventory",
          title: `${p.name} runs out in ~${days} day${days === 1 ? "" : "s"}`,
          detail: `${onHand} on hand, selling ~${daily.toFixed(1)}/day. Raise a purchase order.`,
          href: `/app/inventory/products/${p.id}`,
        });
      }
    }
  }

  if (can("helpdesk")) {
    const breached = await db
      .select({ id: schema.tickets.id, number: schema.tickets.number, subject: schema.tickets.subject })
      .from(schema.tickets)
      .where(and(eq(schema.tickets.orgId, orgId), inArray(schema.tickets.status, ["open", "pending", "on_hold"]), lt(schema.tickets.resolutionDueAt, now)))
      .limit(5);
    for (const t of breached) {
      out.push({ severity: "high", module: "helpdesk", title: `${t.number} breached its resolution SLA`, detail: t.subject, href: `/app/helpdesk/tickets/${t.id}` });
    }
  }

  if (can("projects")) {
    const projects = await db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        budget: schema.projects.budget,
        cost: sql<number>`(select coalesce(sum("time_entries"."hours" * "employees"."annual_ctc" / 2080.0), 0) from "time_entries" join "employees" on "employees"."id" = "time_entries"."employee_id" where "time_entries"."project_id" = "projects"."id")`,
      })
      .from(schema.projects)
      .where(and(eq(schema.projects.orgId, orgId), eq(schema.projects.status, "active"), eq(schema.projects.billingType, "fixed")));
    for (const p of projects) {
      const burn = p.budget > 0 ? Number(p.cost) / p.budget : 0;
      if (burn >= 0.9) {
        out.push({
          severity: burn >= 1 ? "high" : "medium",
          module: "projects",
          title: `${p.name} has used ${Math.round(burn * 100)}% of its budget`,
          detail: `${formatMoneyCompact(Math.round(Number(p.cost)), cur)} cost against ${formatMoneyCompact(p.budget, cur)} budget.`,
          href: `/app/projects/${p.id}`,
        });
      }
    }
  }

  if (can("hrm")) {
    const in14 = ymd(new Date(now.getTime() + 14 * 86_400_000));
    const probation = await db
      .select({ id: schema.employees.id, name: schema.employees.name, end: schema.employees.probationEndDate })
      .from(schema.employees)
      .where(
        and(
          eq(schema.employees.orgId, orgId),
          eq(schema.employees.status, "active"),
          sql`${schema.employees.probationEndDate} >= ${today} and ${schema.employees.probationEndDate} <= ${in14}`,
        ),
      );
    for (const e of probation) {
      out.push({ severity: "low", module: "hrm", title: `${e.name}'s probation ends ${e.end}`, detail: "Schedule the confirmation review.", href: `/app/hrm/${e.id}` });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, limit);
}
