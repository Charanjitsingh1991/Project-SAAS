import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/app/ui";
import { StatusSelect } from "@/components/app/forms";
import { db, schema } from "@/db";
import { PROJECT_STATUSES } from "@/db/schema";
import { addDaysYmd, formatDate, formatMoney, todayYmd } from "@/lib/format";
import { fmtHours, profitability, progressPct, weekStartOf } from "@/lib/projects";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { setProjectStatusAction, createProjectAction } from "./actions";
import { costPerHourMap, loadEmployees, loadMembers, projectTabs } from "./data";
import { Bar, ProjectForm } from "./parts";
import { TONE_CLASS } from "./tones";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: PageProps<"/app/projects">) {
  const ws = await requireWorkspace({ module: "projects" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const sp = await searchParams;
  const filter = typeof sp.status === "string" && (PROJECT_STATUSES as readonly string[]).includes(sp.status) ? sp.status : "all";
  const today = todayYmd();
  const weekStart = weekStartOf(today);
  const weekEnd = addDaysYmd(weekStart, 6);
  const month = today.slice(0, 7);

  const [projects, tasks, entries, employees, members, companies] = await Promise.all([
    db
      .select({ p: schema.projects, client: schema.companies.name })
      .from(schema.projects)
      .leftJoin(schema.companies, eq(schema.projects.companyId, schema.companies.id))
      .where(eq(schema.projects.orgId, orgId)),
    db
      .select({ projectId: schema.tasks.projectId, status: schema.tasks.status, dueDate: schema.tasks.dueDate })
      .from(schema.tasks)
      .where(eq(schema.tasks.orgId, orgId)),
    db.select().from(schema.timeEntries).where(eq(schema.timeEntries.orgId, orgId)),
    loadEmployees(orgId),
    loadMembers(orgId),
    db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.orgId, orgId)),
  ]);

  const cost = costPerHourMap(employees);
  const ownerName = new Map(members.map((m) => [m.id, m.name]));
  const activeIds = new Set(projects.filter((x) => x.p.status !== "cancelled").map((x) => x.p.id));
  const overdue = tasks.filter((t) => activeIds.has(t.projectId) && t.status !== "done" && t.dueDate && t.dueDate < today).length;
  const weekHours = entries.filter((e) => e.date >= weekStart && e.date <= weekEnd).reduce((s, e) => s + e.hours, 0);
  const monthEntries = entries.filter((e) => e.date.startsWith(month));
  const monthTotal = monthEntries.reduce((s, e) => s + e.hours, 0);
  const monthBillable = monthEntries.filter((e) => e.billable).reduce((s, e) => s + e.hours, 0);
  const util = monthTotal > 0 ? Math.round((monthBillable / monthTotal) * 100) : 0;
  const rateOf = new Map(projects.map((x) => [x.p.id, x.p]));
  const unbilled = entries
    .filter((e) => e.billable && !e.invoiceId && rateOf.get(e.projectId)?.billingType === "hourly")
    .reduce((s, e) => s + e.hours * (rateOf.get(e.projectId)?.hourlyRate ?? 0), 0);

  const shown = projects.filter((x) => filter === "all" || x.p.status === filter).sort((a, b) => b.p.id - a.p.id);
  const counts = new Map<string, number>();
  for (const x of projects) counts.set(x.p.status, (counts.get(x.p.status) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Plan work, track time and see profitability as you go."
        tabs={projectTabs("portfolio")}
        actions={
          <>
            <a href="/api/export/projects" className="inline-flex h-10 items-center rounded-full border border-ink/20 px-4 text-sm font-medium hover:border-ink print:hidden">
              Export projects
            </a>
            <a href="/api/export/time_entries" className="inline-flex h-10 items-center rounded-full border border-ink/20 px-4 text-sm font-medium hover:border-ink print:hidden">
              Export time
            </a>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Active projects" value={projects.filter((x) => x.p.status === "active").length} tone="mint" />
        <Stat label="Overdue tasks" value={overdue} tone={overdue ? "rose" : "card"} />
        <Stat label="Hours this week" value={fmtHours(weekHours)} tone="sky" />
        <Stat label="Billable utilisation" value={`${util}%`} hint="This month" tone="butter" />
        <Stat label="Unbilled" value={formatMoney(Math.round(unbilled), cur)} hint="Hourly projects" tone="peach" />
      </div>

      <nav className="mt-8 flex flex-wrap gap-2" aria-label="Filter by status">
        {(["all", ...PROJECT_STATUSES] as const).map((s) => (
          <Link
            key={s}
            href={s === "all" ? "/app/projects" : `/app/projects?status=${s}`}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm capitalize transition",
              filter === s ? "border-ink bg-ink text-paper" : "border-line hover:border-ink",
            )}
          >
            {s.replace("_", " ")} <span className="font-mono text-xs opacity-60">{s === "all" ? projects.length : (counts.get(s) ?? 0)}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.length === 0 && (
          <div className="md:col-span-2 xl:col-span-3">
            <EmptyState title="No projects here yet">Create one below — won CRM deals also open projects automatically.</EmptyState>
          </div>
        )}
        {shown.map(({ p, client }) => {
          const pt = tasks.filter((t) => t.projectId === p.id);
          const done = pt.filter((t) => t.status === "done").length;
          const progress = progressPct(done, pt.length);
          const pr = profitability(
            p,
            entries.filter((e) => e.projectId === p.id).map((e) => ({ hours: e.hours, billable: e.billable, costPerHour: cost.get(e.employeeId) ?? 0 })),
          );
          const late = p.dueDate && p.dueDate < today && p.status !== "done" && p.status !== "cancelled";
          return (
            <article key={p.id} className="flex flex-col rounded-[20px] border border-line bg-card">
              <div className={cn("h-2 rounded-t-[20px]", TONE_CLASS[p.color] ?? "bg-lilac")} />
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">{p.code}</p>
                    <Link href={`/app/projects/${p.id}`} className="block truncate font-display text-lg font-semibold hover:underline">
                      {p.name}
                    </Link>
                    <p className="truncate text-sm text-ink-soft">{client ?? "Internal"}</p>
                  </div>
                  <StatusBadge value={p.status} />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-ink-soft">
                    <span>
                      {done}/{pt.length} tasks
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <Bar pct={progress} className="bg-mint" />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-ink-mute">Due</dt>
                    <dd className={cn("font-medium", late && "text-signal")}>{formatDate(p.dueDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-mute">Budget burn</dt>
                    <dd className={cn("font-medium", pr.burnPct !== null && pr.burnPct > 100 && "text-signal")}>{pr.burnPct === null ? "—" : `${Math.round(pr.burnPct)}%`}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-mute">Margin</dt>
                    <dd className={cn("font-medium", pr.margin < 0 && "text-signal")}>{pr.marginPct === null ? "—" : `${Math.round(pr.marginPct)}%`}</dd>
                  </div>
                </dl>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
                  <span className="truncate text-xs text-ink-soft">Owner: {p.ownerId ? (ownerName.get(p.ownerId) ?? "—") : "—"}</span>
                  <StatusSelect action={setProjectStatusAction} id={p.id} value={p.status} options={PROJECT_STATUSES} label={`Status of ${p.code}`} />
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-10">
        <Card title="New project">
          <ProjectForm action={createProjectAction} companies={companies.map((c) => ({ value: c.id, label: c.name }))} members={members.map((m) => ({ value: m.id, label: m.name }))} submit="Create project" />
        </Card>
      </div>
    </>
  );
}
