import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { Select } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { addDaysYmd, formatDate, todayYmd } from "@/lib/format";
import { fmtHours, isYmd, weekDays, weekStartOf } from "@/lib/projects";
import { canManage } from "@/lib/roles";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { logTimeAction } from "../actions";
import { linkedEmployee, loadEmployees, projectTabs } from "../data";
import { TimeForm } from "../time-form";

export const metadata: Metadata = { title: "Timesheets" };

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function TimesheetsPage({ searchParams }: PageProps<"/app/projects/timesheets">) {
  const ws = await requireWorkspace({ module: "projects" });
  const orgId = ws.org.id;
  const sp = await searchParams;
  const manage = canManage(ws.role);
  const today = todayYmd();
  const monday = weekStartOf(isYmd(typeof sp.week === "string" ? sp.week : undefined) ? (sp.week as string) : today);
  const days = weekDays(monday);

  const [me, employees] = await Promise.all([linkedEmployee(ws), loadEmployees(orgId)]);
  const wanted = Number(typeof sp.employee === "string" ? sp.employee : NaN);
  const person = manage ? (employees.find((e) => e.id === wanted) ?? employees.find((e) => e.id === me?.id) ?? employees[0]) : me ? employees.find((e) => e.id === me.id) : undefined;

  const header = <PageHeader title="Timesheets" description="Log hours by project and task, one week at a time." tabs={projectTabs("timesheets")} />;

  if (!person) {
    return (
      <>
        {header}
        <EmptyState title={manage ? "No employees yet" : "Your account isn't linked to an employee record"}>
          {manage ? "Add employees in HRM to start logging time." : "Ask an admin to link your login to your employee profile in HRM, then come back to log time."}
        </EmptyState>
      </>
    );
  }

  const [entries, projects, tasks] = await Promise.all([
    db
      .select({ e: schema.timeEntries, project: schema.projects.code, projectName: schema.projects.name, task: schema.tasks.title })
      .from(schema.timeEntries)
      .innerJoin(schema.projects, eq(schema.timeEntries.projectId, schema.projects.id))
      .leftJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
      .where(
        and(
          eq(schema.timeEntries.orgId, orgId),
          eq(schema.timeEntries.employeeId, person.id),
          gte(schema.timeEntries.date, monday),
          lte(schema.timeEntries.date, addDaysYmd(monday, 6)),
        ),
      ),
    db
      .select({ id: schema.projects.id, code: schema.projects.code, name: schema.projects.name, billingType: schema.projects.billingType })
      .from(schema.projects)
      .where(and(eq(schema.projects.orgId, orgId), ne(schema.projects.status, "cancelled")))
      .orderBy(asc(schema.projects.code)),
    db
      .select({ id: schema.tasks.id, projectId: schema.tasks.projectId, title: schema.tasks.title })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.orgId, orgId), ne(schema.tasks.status, "done")))
      .orderBy(asc(schema.tasks.title)),
  ]);

  const rows = new Map<string, { label: string; sub: string; cells: number[] }>();
  for (const { e, project, projectName, task } of entries) {
    const key = `${e.projectId}:${e.taskId ?? 0}`;
    const r = rows.get(key) ?? { label: `${project} · ${projectName}`, sub: task ?? "General work", cells: Array(7).fill(0) };
    r.cells[days.indexOf(e.date)] += e.hours;
    rows.set(key, r);
  }
  const list = [...rows.values()].sort((a, b) => a.label.localeCompare(b.label) || a.sub.localeCompare(b.sub));
  const colTotals = days.map((_, i) => list.reduce((s, r) => s + r.cells[i], 0));
  const grand = colTotals.reduce((s, x) => s + x, 0);
  const link = (w: string) => `/app/projects/timesheets?week=${w}&employee=${person.id}`;
  const defaultDate = today >= monday && today <= days[6] ? today : monday;

  return (
    <>
      {header}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div className="flex items-center gap-2">
          <Link href={link(addDaysYmd(monday, -7))} className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm hover:border-ink">
            ← Prev
          </Link>
          <span className="px-2 text-sm font-medium">
            {formatDate(monday)} – {formatDate(days[6])}
          </span>
          <Link href={link(addDaysYmd(monday, 7))} className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm hover:border-ink">
            Next →
          </Link>
          <Link href={link(weekStartOf(today))} className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm hover:border-ink">
            This week
          </Link>
        </div>
        {manage ? (
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="week" value={monday} />
            <Select label="Person" name="employee" options={employees.map((e) => ({ value: e.id, label: e.name }))} defaultValue={person.id} />
            <button className="h-10 rounded-full border border-ink/20 px-4 text-sm font-medium hover:border-ink">View</button>
          </form>
        ) : (
          <p className="text-sm text-ink-soft">{person.name}</p>
        )}
      </div>

      <Card title={`${person.name} · ${fmtHours(grand)} this week`}>
        {list.length === 0 ? (
          <EmptyState title="No time logged this week">Use the form below to add hours.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Project / task</Th>
                {days.map((d, i) => (
                  <Th key={d} className={cn("text-right", d === today && "text-ink")}>
                    {DAY[i]} <span className="block text-[10px] opacity-70">{d.slice(8)}</span>
                  </Th>
                ))}
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.label + r.sub}>
                  <Td>
                    <span className="block font-medium">{r.label}</span>
                    <span className="text-xs text-ink-soft">{r.sub}</span>
                  </Td>
                  {r.cells.map((h, i) => (
                    <Td key={i} className="text-right font-mono text-xs">
                      {h ? fmtHours(h) : <span className="text-ink-mute">·</span>}
                    </Td>
                  ))}
                  <Td className="text-right font-mono font-medium">{fmtHours(r.cells.reduce((s, x) => s + x, 0))}</Td>
                </tr>
              ))}
              <tr className="bg-paper-2/50">
                <Td className="font-medium">Total</Td>
                {colTotals.map((h, i) => (
                  <Td key={i} className="text-right font-mono text-xs font-medium">
                    {h ? fmtHours(h) : "·"}
                  </Td>
                ))}
                <Td className="text-right font-mono font-semibold">{fmtHours(grand)}</Td>
              </tr>
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6 print:hidden">
        <Card title="Log time">
          <TimeForm
            action={logTimeAction}
            projects={projects.map((p) => ({ id: p.id, label: `${p.code} · ${p.name}`, billingType: p.billingType }))}
            tasks={tasks}
            employees={manage ? employees.map((e) => ({ value: e.id, label: e.name })) : undefined}
            defaultEmployeeId={person.id}
            defaultDate={defaultDate}
          />
        </Card>
      </div>
    </>
  );
}
