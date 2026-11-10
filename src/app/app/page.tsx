import type { Metadata } from "next";
import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import Link from "next/link";
import { ArrowUpRight, Lock, Sparkles } from "lucide-react";
import { loadSampleData } from "@/app/app/actions";
import { SubmitButton } from "@/components/app/forms";
import { Card, PageHeader, Stat } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoney } from "@/lib/format";
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

  const [employees, openDeals, outstanding, lowStock, openTickets, activeProjects, members] = await Promise.all([
    db.$count(schema.employees, and(eq(schema.employees.orgId, orgId), eq(schema.employees.status, "active"))),
    db
      .select({ n: sql<number>`count(*)`, v: sql<number>`coalesce(sum(${schema.deals.value}), 0)` })
      .from(schema.deals)
      .where(and(eq(schema.deals.orgId, orgId), inArray(schema.deals.stage, ["lead", "qualified", "proposal"]))),
    db
      .select({ v: sql<number>`coalesce(sum(${schema.invoices.amount}), 0)` })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orgId, orgId), eq(schema.invoices.status, "sent"))),
    db.$count(schema.products, and(eq(schema.products.orgId, orgId), lte(schema.products.quantity, schema.products.reorderLevel))),
    db.$count(schema.tickets, and(eq(schema.tickets.orgId, orgId), ne(schema.tickets.status, "resolved"))),
    db.$count(schema.projects, and(eq(schema.projects.orgId, orgId), eq(schema.projects.status, "active"))),
    db.$count(schema.memberships, eq(schema.memberships.orgId, orgId)),
  ]);

  const cur = ws.org.currency;
  const empty = employees === 0 && openDeals[0].n === 0;
  const tiles: { mod: ModuleKey; label: string; value: string | number; tone: "mint" | "butter" | "sky" | "peach" | "rose" | "lilac" }[] = [
    { mod: "hrm", label: "Active employees", value: employees, tone: "mint" },
    { mod: "crm", label: "Open pipeline", value: formatMoney(openDeals[0].v, cur), tone: "butter" },
    { mod: "finance", label: "Outstanding invoices", value: formatMoney(outstanding[0].v, cur), tone: "sky" },
    { mod: "inventory", label: "Low-stock items", value: lowStock, tone: "peach" },
    { mod: "helpdesk", label: "Open tickets", value: openTickets, tone: "rose" },
    { mod: "projects", label: "Active projects", value: activeProjects, tone: "lilac" },
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
            <p className="text-sm text-ink-soft">Load sample employees, deals, invoices, stock, projects and tickets to explore every module — you can delete them later.</p>
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

      <Card title="Your modules" className="mt-6">
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
    </>
  );
}
