import type { Metadata } from "next";
import { and, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import Link from "next/link";
import { ArrowUpRight, Lock, Sparkles, Zap } from "lucide-react";
import { loadSampleData } from "@/app/app/actions";
import { SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoneyCompact, timeAgo, todayYmd } from "@/lib/format";
import { MODULES } from "@/lib/modules";
import { canManage, roleCanUse, type ModuleKey } from "@/lib/roles";
import { planModules, requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage(props: PageProps<"/app">) {
  const ws = await requireWorkspace();
  const { denied } = await props.searchParams;
  const orgId = ws.org.id;
  const included = planModules(ws);
  const can = (m: ModuleKey) => roleCanUse(ws.role, m) && included.includes(m);
  const today = todayYmd();
  const cur = ws.org.currency;

  const [employees, pipeline, receivable, lowStock, openTickets, overdueTasks, members, feed] = await Promise.all([
    db.$count(schema.employees, and(eq(schema.employees.orgId, orgId), ne(schema.employees.status, "exited"))),
    db
      .select({ v: sql<number>`coalesce(sum(${schema.deals.value}), 0)` })
      .from(schema.deals)
      .where(and(eq(schema.deals.orgId, orgId), inArray(schema.deals.stage, ["lead", "qualified", "proposal", "negotiation"]))),
    db
      .select({ v: sql<number>`coalesce(sum(${schema.invoices.total} - ${schema.invoices.amountPaid}), 0)` })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orgId, orgId), inArray(schema.invoices.status, ["sent", "partial"]))),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.orgId, orgId),
          eq(schema.products.trackStock, true),
          eq(schema.products.active, true),
          sql`(select coalesce(sum(${schema.stockLevels.quantity}), 0) from ${schema.stockLevels} where ${schema.stockLevels.productId} = ${schema.products.id}) <= ${schema.products.reorderLevel}`,
        ),
      ),
    db.$count(schema.tickets, and(eq(schema.tickets.orgId, orgId), inArray(schema.tickets.status, ["open", "pending", "on_hold"]))),
    db.$count(schema.tasks, and(eq(schema.tasks.orgId, orgId), ne(schema.tasks.status, "done"), lt(schema.tasks.dueDate, today))),
    db.$count(schema.memberships, eq(schema.memberships.orgId, orgId)),
    db
      .select({ a: schema.activityLog, actor: schema.users.name })
      .from(schema.activityLog)
      .leftJoin(schema.users, eq(schema.activityLog.actorId, schema.users.id))
      .where(and(eq(schema.activityLog.orgId, orgId), gt(schema.activityLog.id, 0)))
      .orderBy(desc(schema.activityLog.id))
      .limit(12),
  ]);

  const empty = employees === 0 && pipeline[0].v === 0;
  const tiles: { mod: ModuleKey; label: string; value: string | number; tone: "mint" | "butter" | "sky" | "peach" | "rose" | "lilac" }[] = [
    { mod: "hrm", label: "People", value: employees, tone: "mint" },
    { mod: "crm", label: "Open pipeline", value: formatMoneyCompact(pipeline[0].v, cur), tone: "butter" },
    { mod: "finance", label: "Receivables", value: formatMoneyCompact(receivable[0].v, cur), tone: "sky" },
    { mod: "inventory", label: "Low-stock items", value: Number(lowStock[0]?.n ?? 0), tone: "peach" },
    { mod: "helpdesk", label: "Open tickets", value: openTickets, tone: "rose" },
    { mod: "projects", label: "Overdue tasks", value: overdueTasks, tone: "lilac" },
  ];

  return (
    <>
      <PageHeader
        title={
          <>
            Hey {ws.user.name.split(" ")[0]}, <span className="font-serif font-normal italic">welcome in.</span>
          </>
        }
        description={`${ws.org.name} · ${members} member${members === 1 ? "" : "s"}`}
        actions={
          <span className="hidden items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-ink-soft md:flex">
            Press <kbd className="rounded border border-line bg-paper px-1.5 font-mono">⌘K</kbd> to search everything
          </span>
        }
      />

      {typeof denied === "string" && (
        <p className="mb-6 rounded-xl bg-butter px-4 py-3 text-sm">
          {denied === "manage"
            ? "Only owners and admins can open that page."
            : roleCanUse(ws.role, denied as ModuleKey)
              ? "That module isn't included in your current plan. Upgrade to Growth on the Billing page."
              : "Your role doesn't include that module. Ask an admin to change your role."}
        </p>
      )}

      {empty && canManage(ws.role) && (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-[20px] border border-dashed border-ink/25 bg-lime/40 p-5">
          <Sparkles className="size-6" />
          <div className="flex-1">
            <p className="font-medium">Your workspace is empty.</p>
            <p className="text-sm text-ink-soft">
              Load a connected demo company — employees, attendance, payroll, customers, deals, invoices, stock, projects and tickets — to explore every module.
            </p>
          </div>
          <form action={loadSampleData}>
            <SubmitButton>Load sample data</SubmitButton>
          </form>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles
          .filter((t) => can(t.mod))
          .map((t) => (
            <Link key={t.mod} href={`/app/${t.mod}`} className="group relative">
              <Stat label={t.label} value={t.value} tone={t.tone} />
              <ArrowUpRight className="absolute top-4 right-4 size-4 opacity-40 transition group-hover:opacity-100" />
            </Link>
          ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card title="Your modules">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.filter((m) => roleCanUse(ws.role, m.key as ModuleKey)).map((m) => {
              const locked = !included.includes(m.key as ModuleKey);
              return (
                <Link
                  key={m.key}
                  href={locked ? "/app/billing" : `/app/${m.key}`}
                  className={cn("rounded-2xl border border-ink/10 p-4 transition hover:-translate-y-0.5", m.color, locked && "opacity-60")}
                >
                  <div className="flex items-center justify-between">
                    <span className="grid size-9 place-items-center rounded-xl bg-ink text-paper">
                      <m.icon className="size-4" />
                    </span>
                    {locked && <Lock className="size-4" />}
                  </div>
                  <p className="mt-3 font-display font-semibold">{m.name}</p>
                  <p className="text-sm text-ink/65">{locked ? "Upgrade to Growth" : m.tagline}</p>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card title="Activity">
          {feed.length === 0 ? (
            <EmptyState title="Nothing yet">Actions across every module show up here.</EmptyState>
          ) : (
            <ol className="space-y-3">
              {feed.map(({ a, actor }) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span
                    className={cn(
                      "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-ink/10",
                      a.actorId ? "bg-paper-2" : "bg-lime",
                    )}
                  >
                    {a.actorId ? <span className="size-1.5 rounded-full bg-ink" /> : <Zap className="size-3" />}
                  </span>
                  <div className="min-w-0">
                    <p className="leading-snug">{a.summary}</p>
                    <p className="text-xs text-ink-mute">
                      {actor ?? "Automation"} · {timeAgo(a.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
