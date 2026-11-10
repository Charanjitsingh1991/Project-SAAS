import Link from "next/link";
import { ActionButton, ActionForm, Input, StatusSelect, SubmitButton } from "@/components/app/forms";
import { Kanban } from "@/components/app/kanban";
import { Badge, Card, EmptyState, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import type { schema } from "@/db";
import { PRIORITIES, TASK_STATUSES } from "@/db/schema";
import { addDaysYmd, daysBetween, formatDate, formatMoney, fromMinor } from "@/lib/format";
import { fmtHours, ganttBar, ganttPos, ganttRange, isOverdue, progressPct, type Profitability } from "@/lib/projects";
import { cn } from "@/lib/utils";
import {
  billTimeAction,
  createMilestoneAction,
  createTaskAction,
  deleteMilestoneAction,
  deleteProjectAction,
  deleteTimeAction,
  logTimeAction,
  moveTaskAction,
  setTaskPriorityAction,
  toggleMilestoneAction,
  updateMilestoneAction,
  updateProjectAction,
} from "../actions";
import { Avatar, Bar, ProjectForm, TaskForm, type Opt } from "../parts";
import { TimeForm } from "../time-form";

type Task = typeof schema.tasks.$inferSelect;
type Milestone = typeof schema.milestones.$inferSelect;
type Project = typeof schema.projects.$inferSelect;
export type EntryRow = { e: typeof schema.timeEntries.$inferSelect; employee: string; task: string | null };

const STATUS_DOT: Record<string, string> = {
  backlog: "bg-ink/30",
  todo: "bg-butter",
  in_progress: "bg-sky",
  review: "bg-lilac",
  done: "bg-mint",
};

export type ViewProps = {
  project: Project;
  tasks: Task[];
  milestones: Milestone[];
  entries: EntryRow[];
  logged: Map<number, number>;
  empName: Map<number, string>;
  employees: Opt[];
  milestoneOpts: Opt[];
  today: string;
  currency: string;
};

/* ───────────── Board ───────────── */

export function BoardView({ project, tasks, logged, empName, employees, milestoneOpts, today }: ViewProps) {
  return (
    <div className="space-y-6">
      <Card title="Add task">
        <TaskForm action={createTaskAction} projectId={project.id} employees={employees} milestones={milestoneOpts} submit="Add task" />
      </Card>
      <Kanban
        field="status"
        onMove={moveTaskAction}
        columns={TASK_STATUSES.map((s) => ({ key: s, label: s.replace("_", " "), tone: STATUS_DOT[s] }))}
        items={tasks
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((t) => {
            const late = isOverdue(t.dueDate, t.status, today);
            const hrs = logged.get(t.id) ?? 0;
            return {
              id: t.id,
              column: t.status,
              node: (
                <div className="space-y-2 rounded-2xl border border-line bg-card p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
                  <Link href={`/app/projects/tasks/${t.id}`} className="block text-sm leading-snug font-medium hover:underline">
                    {t.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge value={t.priority} />
                    <Avatar name={t.assigneeId ? empName.get(t.assigneeId) : null} />
                    {t.dueDate && <span className={cn("text-xs", late ? "font-medium text-signal" : "text-ink-soft")}>{formatDate(t.dueDate)}</span>}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-ink-mute">
                      {fmtHours(hrs)} / {t.estimateHours ? fmtHours(t.estimateHours) : "—"}
                    </span>
                    <StatusSelect action={moveTaskAction} id={t.id} value={t.status} options={TASK_STATUSES} label={`Status of ${t.title}`} />
                  </div>
                </div>
              ),
            };
          })}
      />
    </div>
  );
}

/* ───────────── List ───────────── */

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function ListView({ project, tasks, empName, logged, today, sort }: ViewProps & { sort: string }) {
  const sorted = tasks.slice().sort((a, b) => {
    if (sort === "priority") return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id - b.id;
    if (sort === "status") return TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status) || a.id - b.id;
    return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id - b.id;
  });
  const th = (key: string, label: string) => (
    <Th>
      <Link href={`/app/projects/${project.id}?view=list&sort=${key}`} className={cn("hover:text-ink", sort === key && "text-ink")}>
        {label}
        {sort === key ? " ↓" : ""}
      </Link>
    </Th>
  );
  if (!tasks.length) return <EmptyState title="No tasks yet">Add the first task from the Board tab.</EmptyState>;
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>Task</Th>
            <Th>Assignee</Th>
            {th("status", "Status")}
            {th("priority", "Priority")}
            {th("due", "Due")}
            <Th className="text-right">Logged / est.</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id}>
              <Td>
                <Link href={`/app/projects/tasks/${t.id}`} className="font-medium hover:underline">
                  {t.title}
                </Link>
              </Td>
              <Td>{t.assigneeId ? (empName.get(t.assigneeId) ?? "—") : <span className="text-ink-mute">Unassigned</span>}</Td>
              <Td>
                <StatusSelect action={moveTaskAction} id={t.id} value={t.status} options={TASK_STATUSES} label={`Status of ${t.title}`} />
              </Td>
              <Td>
                <StatusSelect action={setTaskPriorityAction} id={t.id} value={t.priority} options={PRIORITIES} name="priority" label={`Priority of ${t.title}`} />
              </Td>
              <Td className={cn(isOverdue(t.dueDate, t.status, today) && "font-medium text-signal")}>{formatDate(t.dueDate)}</Td>
              <Td className="text-right font-mono text-xs">
                {fmtHours(logged.get(t.id) ?? 0)} / {t.estimateHours ? fmtHours(t.estimateHours) : "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/* ───────────── Timeline (Gantt) ───────────── */

export function TimelineView({ project, tasks, milestones, empName, today }: ViewProps) {
  const taskSpan = (t: Task) => {
    const a = t.startDate ?? t.createdAt.toISOString().slice(0, 10);
    const b = t.dueDate ?? a;
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  };
  const dates = [project.startDate, project.dueDate, ...milestones.map((m) => m.dueDate), ...tasks.flatMap((t) => [taskSpan(t).from, taskSpan(t).to])];
  if (!tasks.length && !milestones.length && !project.startDate && !project.dueDate) {
    return <EmptyState title="Nothing to plot yet">Add tasks with dates or milestones to see the timeline.</EmptyState>;
  }
  const range = ganttRange(dates, today);
  const end = addDaysYmd(range.start, range.days - 1);
  const ticks: { ymd: string; left: number }[] = [];
  const step = range.days > 120 ? 28 : range.days > 45 ? 14 : 7;
  for (let i = 0; i < range.days; i += step) {
    const ymd = addDaysYmd(range.start, i);
    ticks.push({ ymd, left: (i / range.days) * 100 });
  }
  const showToday = today >= range.start && today <= end;
  const rows = [
    ...milestones.map((m) => ({ kind: "milestone" as const, id: m.id, label: m.title, sub: m.done ? "Milestone · done" : "Milestone", m })),
    ...tasks
      .slice()
      .sort((a, b) => taskSpan(a).from.localeCompare(taskSpan(b).from) || a.id - b.id)
      .map((t) => ({ kind: "task" as const, id: t.id, label: t.title, sub: t.assigneeId ? (empName.get(t.assigneeId) ?? "") : "Unassigned", t })),
  ];

  return (
    <Card>
      <div className="-m-5 overflow-x-auto p-5">
        <div className="grid min-w-[760px] grid-cols-[13rem_1fr]">
          <div className="h-8 border-b border-line" />
          <div className="relative h-8 border-b border-line">
            {ticks.map((t) => (
              <span key={t.ymd} className="absolute top-1.5 font-mono text-[10px] whitespace-nowrap text-ink-mute" style={{ left: `${t.left}%` }}>
                {formatDate(t.ymd).replace(/ \d{4}$/, "")}
              </span>
            ))}
          </div>
          <div>
            {rows.map((r) => (
              <div key={`${r.kind}-${r.id}`} className="flex h-10 flex-col justify-center border-b border-line/60 pr-3">
                <span className="truncate text-sm leading-tight font-medium">{r.label}</span>
                <span className="truncate text-[11px] leading-tight text-ink-mute">{r.sub}</span>
              </div>
            ))}
          </div>
          <div className="relative">
            {ticks.map((t) => (
              <span key={t.ymd} className="absolute inset-y-0 w-px bg-line/70" style={{ left: `${t.left}%` }} />
            ))}
            {showToday && (
              <span className="absolute inset-y-0 z-10 w-0.5 bg-signal" style={{ left: `${ganttPos(today, range)}%` }} title={`Today · ${formatDate(today)}`} />
            )}
            {rows.map((r) => (
              <div key={`${r.kind}-${r.id}`} className="relative h-10 border-b border-line/60">
                {r.kind === "milestone" && r.m.dueDate && (
                  <span
                    title={`${r.m.title} · ${formatDate(r.m.dueDate)}`}
                    className={cn("absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-ink", r.m.done ? "bg-mint" : "bg-butter")}
                    style={{ left: `${ganttPos(r.m.dueDate, range)}%` }}
                  />
                )}
                {r.kind === "task" &&
                  (() => {
                    const s = taskSpan(r.t);
                    const bar = ganttBar(s.from, s.to, range);
                    const late = isOverdue(r.t.dueDate, r.t.status, today);
                    return (
                      <Link
                        href={`/app/projects/tasks/${r.t.id}`}
                        title={`${r.t.title} · ${formatDate(s.from)} → ${formatDate(s.to)} · ${r.t.status.replace("_", " ")}`}
                        className={cn(
                          "absolute top-1/2 h-5 min-w-1.5 -translate-y-1/2 rounded-full border border-ink/25",
                          STATUS_DOT[r.t.status],
                          late && "ring-2 ring-signal",
                        )}
                        style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                      />
                    );
                  })()}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-4 text-xs text-ink-soft">
        {TASK_STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 capitalize">
            <span className={cn("size-3 rounded-full border border-ink/25", STATUS_DOT[s])} />
            {s.replace("_", " ")}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rotate-45 border border-ink bg-butter" /> Milestone
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-signal" /> Today · {daysBetween(range.start, end) + 1} day range
        </span>
      </div>
    </Card>
  );
}

/* ───────────── Milestones ───────────── */

export function MilestonesView({ project, tasks, milestones }: ViewProps) {
  return (
    <div className="space-y-6">
      <Card title="Add milestone">
        <ActionForm action={createMilestoneAction} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
          <input type="hidden" name="projectId" value={project.id} />
          <Input label="Title" name="title" required />
          <Input label="Due date" name="dueDate" type="date" />
          <div className="flex items-end">
            <SubmitButton>Add</SubmitButton>
          </div>
        </ActionForm>
      </Card>
      {milestones.length === 0 ? (
        <EmptyState title="No milestones">Break the project into checkpoints to track delivery.</EmptyState>
      ) : (
        <div className="space-y-3">
          {milestones
            .slice()
            .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
            .map((m) => {
              const mt = tasks.filter((t) => t.milestoneId === m.id);
              const done = mt.filter((t) => t.status === "done").length;
              const pct = m.done ? 100 : progressPct(done, mt.length);
              return (
                <div key={m.id} className="rounded-[20px] border border-line bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={m.done ? "mint" : "butter"}>{m.done ? "done" : "open"}</Badge>
                      <span className="font-display font-semibold">{m.title}</span>
                      <span className="text-sm text-ink-soft">{formatDate(m.dueDate)}</span>
                    </div>
                    <div className="flex gap-2">
                      <ActionButton action={toggleMilestoneAction} fields={{ id: m.id }}>
                        {m.done ? "Reopen" : "Mark done"}
                      </ActionButton>
                      <ActionButton action={deleteMilestoneAction} fields={{ id: m.id }} confirm="Delete this milestone? Tasks stay in the project.">
                        Delete
                      </ActionButton>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Bar pct={pct} className="bg-mint" />
                    <span className="shrink-0 text-xs text-ink-soft">
                      {done}/{mt.length} tasks
                    </span>
                  </div>
                  <ActionForm action={updateMilestoneAction} resetOnSuccess={false} className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
                    <input type="hidden" name="id" value={m.id} />
                    <Input label="Title" name="title" defaultValue={m.title} required />
                    <Input label="Due date" name="dueDate" type="date" defaultValue={m.dueDate ?? ""} />
                    <div className="flex items-end">
                      <SubmitButton variant="outline">Save</SubmitButton>
                    </div>
                  </ActionForm>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

/* ───────────── Time & profitability ───────────── */

export function TimeView({
  project,
  tasks,
  entries,
  currency,
  profit,
  unbilledHours,
  billableHours,
  projectOpts,
  employeeOpts,
  manage,
  myEmployeeId,
  canBill,
  today,
}: ViewProps & {
  profit: Profitability;
  unbilledHours: number;
  billableHours: number;
  projectOpts: { id: number; label: string; billingType: string }[];
  employeeOpts?: { value: number; label: string }[];
  manage: boolean;
  myEmployeeId: number | null;
  canBill: boolean;
}) {
  const totalHours = entries.reduce((s, r) => s + r.e.hours, 0);
  const unbilledValue = Math.round(unbilledHours * project.hourlyRate);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Hours logged" value={fmtHours(totalHours)} tone="sky" />
        <Stat label="Billable" value={fmtHours(billableHours)} tone="mint" />
        <Stat label="Unbilled" value={fmtHours(unbilledHours)} hint={project.hourlyRate > 0 ? formatMoney(unbilledValue, currency) : "No hourly rate set"} tone="peach" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card
          title="Time entries"
          actions={
            canBill ? (
              <ActionForm action={billTimeAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <SubmitButton variant="signal">Bill unbilled hours</SubmitButton>
              </ActionForm>
            ) : (
              <span className="text-xs text-ink-mute">Turn on Finance to invoice time</span>
            )
          }
        >
          {entries.length === 0 ? (
            <EmptyState title="No time logged">Use the form below to log the first hours.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Person</Th>
                  <Th>Task</Th>
                  <Th className="text-right">Hours</Th>
                  <Th>Billable</Th>
                  <Th>Invoice</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {entries.map(({ e, employee, task }) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap">{formatDate(e.date)}</Td>
                    <Td>{employee}</Td>
                    <Td className="text-ink-soft">{task ?? "General"}</Td>
                    <Td className="text-right font-mono">{fmtHours(e.hours)}</Td>
                    <Td>{e.billable ? <Badge tone="mint">billable</Badge> : <Badge>no</Badge>}</Td>
                    <Td>
                      {e.invoiceId ? (
                        <Link href={`/app/finance/invoices/${e.invoiceId}`} className="underline underline-offset-2">
                          Invoiced
                        </Link>
                      ) : (
                        <span className="text-ink-mute">—</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {!e.invoiceId && (manage || e.employeeId === myEmployeeId) && (
                        <ActionButton action={deleteTimeAction} fields={{ id: e.id }} confirm="Delete this time entry?">
                          Delete
                        </ActionButton>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Profitability">
          <dl className="space-y-3 text-sm">
            <Row label="Revenue" value={formatMoney(profit.revenue, currency)} />
            <Row label="Cost" value={formatMoney(profit.cost, currency)} />
            <Row label="Margin" value={formatMoney(profit.margin, currency)} danger={profit.margin < 0} />
            <Row label="Margin %" value={profit.marginPct === null ? "—" : `${Math.round(profit.marginPct)}%`} danger={profit.margin < 0} />
          </dl>
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-xs text-ink-soft">
              <span>Budget burn</span>
              <span>{profit.burnPct === null ? "n/a" : `${Math.round(profit.burnPct)}%`}</span>
            </div>
            <Bar pct={profit.burnPct ?? 0} className="bg-sky" danger={(profit.burnPct ?? 0) > 100} />
            <p className="mt-2 text-xs text-ink-mute">
              Cost = hours × (annual CTC ÷ 2,080). {project.billingType === "fixed" ? "Revenue is the fixed budget." : project.billingType === "hourly" ? "Revenue is billable hours × rate." : "Non-billable work earns no revenue."}
            </p>
          </div>
        </Card>
      </div>

      <Card title="Log time">
        <TimeForm
          action={logTimeAction}
          projects={projectOpts}
          tasks={tasks.map((t) => ({ id: t.id, projectId: t.projectId, title: t.title }))}
          employees={employeeOpts}
          defaultEmployeeId={myEmployeeId ?? undefined}
          defaultDate={today}
          defaultProjectId={project.id}
          lockProject
        />
      </Card>
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line/60 pb-2">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={cn("font-mono font-medium", danger && "text-signal")}>{value}</dd>
    </div>
  );
}

/* ───────────── Settings ───────────── */

export function SettingsView({ project, companyOpts, memberOpts, canDelete }: { project: Project; companyOpts: Opt[]; memberOpts: Opt[]; canDelete: boolean }) {
  return (
    <div className="space-y-6">
      <Card title="Project settings">
        <ProjectForm
          action={updateProjectAction}
          resetOnSuccess={false}
          companies={companyOpts}
          members={memberOpts}
          submit="Save changes"
          defaults={{
            id: project.id,
            name: project.name,
            companyId: project.companyId,
            description: project.description,
            ownerId: project.ownerId,
            color: project.color,
            billingType: project.billingType,
            budget: project.budget ? String(fromMinor(project.budget)) : "",
            hourlyRate: project.hourlyRate ? String(fromMinor(project.hourlyRate)) : "",
            startDate: project.startDate,
            dueDate: project.dueDate,
            status: project.status,
          }}
        />
      </Card>
      {canDelete && (
        <Card title="Danger zone">
          <p className="mb-3 text-sm text-ink-soft">Deleting a project removes its tasks, milestones and time entries. Invoices already created are kept.</p>
          <ActionButton action={deleteProjectAction} fields={{ id: project.id }} confirm={`Delete ${project.code} and all its tasks and time entries?`} className="border-signal text-signal">
            Delete project
          </ActionButton>
        </Card>
      )}
    </div>
  );
}
