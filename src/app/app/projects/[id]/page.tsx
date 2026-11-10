import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { PageHeader, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, todayYmd } from "@/lib/format";
import { profitability, progressPct } from "@/lib/projects";
import { canManage } from "@/lib/roles";
import { requireWorkspace } from "@/lib/tenancy";
import { costPerHourMap, linkedEmployee, loadEmployees, loadMembers } from "../data";
import { BackLink } from "../parts";
import { BoardView, ListView, MilestonesView, SettingsView, TimelineView, TimeView, type EntryRow } from "./views";

export const metadata: Metadata = { title: "Project" };

const VIEWS = [
  ["board", "Board"],
  ["list", "List"],
  ["timeline", "Timeline"],
  ["milestones", "Milestones"],
  ["time", "Time & profit"],
  ["settings", "Settings"],
] as const;

export default async function ProjectPage({ params, searchParams }: PageProps<"/app/projects/[id]">) {
  const ws = await requireWorkspace({ module: "projects" });
  const orgId = ws.org.id;
  const { id: rawId } = await params;
  const sp = await searchParams;
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  const [row] = await db
    .select({ p: schema.projects, client: schema.companies.name })
    .from(schema.projects)
    .leftJoin(schema.companies, eq(schema.projects.companyId, schema.companies.id))
    .where(and(eq(schema.projects.id, id), eq(schema.projects.orgId, orgId)))
    .limit(1);
  if (!row) notFound();
  const project = row.p;

  const view = VIEWS.find(([k]) => k === sp.view)?.[0] ?? "board";
  const sort = typeof sp.sort === "string" ? sp.sort : "due";
  const today = todayYmd();

  const [tasks, milestones, entryRows, employees, members, companies, allProjects, me] = await Promise.all([
    db.select().from(schema.tasks).where(and(eq(schema.tasks.projectId, id), eq(schema.tasks.orgId, orgId))),
    db.select().from(schema.milestones).where(and(eq(schema.milestones.projectId, id), eq(schema.milestones.orgId, orgId))).orderBy(asc(schema.milestones.dueDate)),
    db
      .select({ e: schema.timeEntries, employee: schema.employees.name, task: schema.tasks.title })
      .from(schema.timeEntries)
      .innerJoin(schema.employees, eq(schema.timeEntries.employeeId, schema.employees.id))
      .leftJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
      .where(and(eq(schema.timeEntries.projectId, id), eq(schema.timeEntries.orgId, orgId)))
      .orderBy(desc(schema.timeEntries.date), desc(schema.timeEntries.id)),
    loadEmployees(orgId),
    loadMembers(orgId),
    db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.orgId, orgId)),
    db.select({ id: schema.projects.id, code: schema.projects.code, name: schema.projects.name, billingType: schema.projects.billingType }).from(schema.projects).where(eq(schema.projects.orgId, orgId)),
    linkedEmployee(ws),
  ]);

  const entries: EntryRow[] = entryRows;
  const logged = new Map<number, number>();
  for (const { e } of entries) if (e.taskId) logged.set(e.taskId, (logged.get(e.taskId) ?? 0) + e.hours);
  const cost = costPerHourMap(employees);
  const profit = profitability(
    project,
    entries.map(({ e }) => ({ hours: e.hours, billable: e.billable, costPerHour: cost.get(e.employeeId) ?? 0 })),
  );
  const unbilledHours = entries.filter(({ e }) => e.billable && !e.invoiceId).reduce((s, { e }) => s + e.hours, 0);
  const manage = canManage(ws.role);
  const done = tasks.filter((t) => t.status === "done").length;
  const owner = members.find((m) => m.id === project.ownerId)?.name;

  const props = {
    project,
    tasks,
    milestones,
    entries,
    logged,
    empName: new Map(employees.map((e) => [e.id, e.name])),
    employees: employees.filter((e) => e.status !== "exited").map((e) => ({ value: e.id, label: e.name })),
    milestoneOpts: milestones.map((m) => ({ value: m.id, label: m.title })),
    today,
    currency: ws.org.currency,
  };

  return (
    <>
      <BackLink href="/app/projects">All projects</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {project.name} <StatusBadge value={project.status} />
          </span>
        }
        description={`${project.code} · ${row.client ?? "Internal"} · ${progressPct(done, tasks.length)}% done · Due ${formatDate(project.dueDate)}${owner ? ` · Owner ${owner}` : ""}`}
        tabs={VIEWS.map(([k, label]) => ({ href: `/app/projects/${id}?view=${k}`, label, active: view === k }))}
      />
      {view === "board" && <BoardView {...props} />}
      {view === "list" && <ListView {...props} sort={sort} />}
      {view === "timeline" && <TimelineView {...props} />}
      {view === "milestones" && <MilestonesView {...props} />}
      {view === "time" && (
        <TimeView
          {...props}
          profit={profit}
          unbilledHours={unbilledHours}
          billableHours={profit.billableHours}
          projectOpts={allProjects.map((p) => ({ id: p.id, label: `${p.code} · ${p.name}`, billingType: p.billingType }))}
          employeeOpts={manage ? props.employees : undefined}
          manage={manage}
          myEmployeeId={me?.id ?? null}
        />
      )}
      {view === "settings" && (
        <SettingsView
          project={project}
          companyOpts={companies.map((c) => ({ value: c.id, label: c.name }))}
          memberOpts={members.map((m) => ({ value: m.id, label: m.name }))}
          canDelete={manage || project.ownerId === ws.user.id}
        />
      )}
    </>
  );
}
