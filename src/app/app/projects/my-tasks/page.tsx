import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { StatusSelect } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { TASK_STATUSES } from "@/db/schema";
import { addDaysYmd, formatDate, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { moveTaskAction } from "../actions";
import { linkedEmployee, projectTabs } from "../data";

export const metadata: Metadata = { title: "My tasks" };

const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export default async function MyTasksPage() {
  const ws = await requireWorkspace({ module: "projects" });
  const me = await linkedEmployee(ws);
  const header = <PageHeader title="My tasks" description="Everything assigned to you, grouped by when it's due." tabs={projectTabs("my-tasks")} />;

  if (!me) {
    return (
      <>
        {header}
        <EmptyState title="Your account isn't linked to an employee record">Ask an admin to link your login to your employee profile in HRM to see your tasks here.</EmptyState>
      </>
    );
  }

  const rows = await db
    .select({ t: schema.tasks, code: schema.projects.code, project: schema.projects.name })
    .from(schema.tasks)
    .innerJoin(schema.projects, eq(schema.tasks.projectId, schema.projects.id))
    .where(and(eq(schema.tasks.orgId, ws.org.id), eq(schema.tasks.assigneeId, me.id)));

  const today = todayYmd();
  const weekEnd = addDaysYmd(today, 7);
  const open = rows.filter((r) => r.t.status !== "done");
  const groups: { key: string; title: string; tone: string; items: typeof rows }[] = [
    { key: "overdue", title: "Overdue", tone: "bg-rose", items: open.filter((r) => r.t.dueDate && r.t.dueDate < today) },
    { key: "today", title: "Today", tone: "bg-butter", items: open.filter((r) => r.t.dueDate === today) },
    { key: "week", title: "This week", tone: "bg-sky", items: open.filter((r) => r.t.dueDate && r.t.dueDate > today && r.t.dueDate <= weekEnd) },
    { key: "later", title: "Later", tone: "bg-paper-2", items: open.filter((r) => !r.t.dueDate || r.t.dueDate > weekEnd) },
  ];
  const doneCount = rows.length - open.length;

  return (
    <>
      {header}
      {open.length === 0 ? (
        <EmptyState title="Nothing on your plate">No open tasks are assigned to you{doneCount ? ` — ${doneCount} completed.` : "."}</EmptyState>
      ) : (
        <div className="space-y-6">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <Card
                key={g.key}
                title={
                  <span className="flex items-center gap-2">
                    <span className={cn("size-2.5 rounded-full border border-ink/20", g.tone)} /> {g.title} <span className="font-mono text-xs text-ink-mute">{g.items.length}</span>
                  </span>
                }
              >
                <ul className="-my-2 divide-y divide-line/70">
                  {g.items
                    .slice()
                    .sort((a, b) => (a.t.dueDate ?? "9999").localeCompare(b.t.dueDate ?? "9999") || RANK[a.t.priority] - RANK[b.t.priority])
                    .map(({ t, code, project }) => (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <Link href={`/app/projects/tasks/${t.id}`} className="font-medium hover:underline">
                            {t.title}
                          </Link>
                          <p className="text-xs text-ink-soft">
                            {code} · {project} · due {formatDate(t.dueDate)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge value={t.priority} />
                          <StatusSelect action={moveTaskAction} id={t.id} value={t.status} options={TASK_STATUSES} label={`Status of ${t.title}`} />
                        </div>
                      </li>
                    ))}
                </ul>
              </Card>
            ))}
        </div>
      )}
    </>
  );
}
