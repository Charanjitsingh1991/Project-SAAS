import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, SubmitButton, Textarea } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { TASK_STATUSES } from "@/db/schema";
import { formatDate, timeAgo, todayYmd } from "@/lib/format";
import { fmtHours, isOverdue } from "@/lib/projects";
import { canManage } from "@/lib/roles";
import { requireWorkspace } from "@/lib/tenancy";
import { addCommentAction, deleteTaskAction, deleteTimeAction, logTimeAction, updateTaskAction } from "../../actions";
import { linkedEmployee, loadEmployees } from "../../data";
import { BackLink, TaskForm } from "../../parts";
import { TimeForm } from "../../time-form";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: PageProps<"/app/projects/tasks/[taskId]">) {
  const ws = await requireWorkspace({ module: "projects" });
  const orgId = ws.org.id;
  const id = Number((await params).taskId);
  if (!Number.isInteger(id)) notFound();

  const [row] = await db
    .select({ t: schema.tasks, project: schema.projects })
    .from(schema.tasks)
    .innerJoin(schema.projects, eq(schema.tasks.projectId, schema.projects.id))
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.orgId, orgId)))
    .limit(1);
  if (!row) notFound();
  const { t, project } = row;

  const [employees, milestones, comments, entries, me] = await Promise.all([
    loadEmployees(orgId),
    db.select().from(schema.milestones).where(and(eq(schema.milestones.projectId, project.id), eq(schema.milestones.orgId, orgId))).orderBy(asc(schema.milestones.dueDate)),
    db
      .select({ c: schema.taskComments, author: schema.users.name })
      .from(schema.taskComments)
      .leftJoin(schema.users, eq(schema.taskComments.authorId, schema.users.id))
      .where(and(eq(schema.taskComments.taskId, id), eq(schema.taskComments.orgId, orgId)))
      .orderBy(asc(schema.taskComments.createdAt), asc(schema.taskComments.id)),
    db
      .select({ e: schema.timeEntries, employee: schema.employees.name })
      .from(schema.timeEntries)
      .innerJoin(schema.employees, eq(schema.timeEntries.employeeId, schema.employees.id))
      .where(and(eq(schema.timeEntries.taskId, id), eq(schema.timeEntries.orgId, orgId)))
      .orderBy(desc(schema.timeEntries.date), desc(schema.timeEntries.id)),
    linkedEmployee(ws),
  ]);

  const manage = canManage(ws.role);
  const today = todayYmd();
  const logged = entries.reduce((s, x) => s + x.e.hours, 0);
  const empOpts = employees.filter((e) => e.status !== "exited" || e.id === t.assigneeId).map((e) => ({ value: e.id, label: e.name }));
  const late = isOverdue(t.dueDate, t.status, today);

  return (
    <>
      <BackLink href={`/app/projects/${project.id}`}>{project.code} · {project.name}</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t.title} <StatusBadge value={t.status} /> <StatusBadge value={t.priority} />
          </span>
        }
        description={
          <span className={late ? "text-signal" : undefined}>
            Due {formatDate(t.dueDate)} · {fmtHours(logged)} logged{t.estimateHours ? ` of ${fmtHours(t.estimateHours)} estimated` : ""}
          </span>
        }
        actions={
          <ActionButton action={deleteTaskAction} fields={{ id: t.id }} confirm="Delete this task? Logged time stays on the project.">
            Delete task
          </ActionButton>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card title="Details">
            <TaskForm
              action={updateTaskAction}
              resetOnSuccess={false}
              full
              statuses={TASK_STATUSES}
              employees={empOpts}
              milestones={milestones.map((m) => ({ value: m.id, label: m.title }))}
              submit="Save task"
              defaults={{
                id: t.id,
                title: t.title,
                description: t.description,
                assigneeId: t.assigneeId,
                status: t.status,
                priority: t.priority,
                startDate: t.startDate,
                dueDate: t.dueDate,
                estimateHours: t.estimateHours,
                milestoneId: t.milestoneId,
              }}
            />
          </Card>

          <Card title={`Comments (${comments.length})`}>
            <div className="space-y-4">
              {comments.length === 0 && <p className="text-sm text-ink-soft">No comments yet.</p>}
              {comments.map(({ c, author }) => (
                <div key={c.id} className="rounded-2xl bg-paper-2/60 p-3.5">
                  <p className="mb-1 text-xs text-ink-soft">
                    <span className="font-medium text-ink">{author ?? "Former member"}</span> · {timeAgo(c.createdAt)}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
              <ActionForm action={addCommentAction} className="space-y-3">
                <input type="hidden" name="taskId" value={t.id} />
                <Textarea label="Add a comment" name="body" rows={3} required />
                <SubmitButton>Post comment</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Logged time">
            {entries.length === 0 ? (
              <EmptyState title="No time yet">Log hours against this task below.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Person</Th>
                    <Th className="text-right">Hours</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {entries.map(({ e, employee }) => (
                    <tr key={e.id}>
                      <Td className="whitespace-nowrap">{formatDate(e.date)}</Td>
                      <Td>
                        {employee} {!e.billable && <Badge>non-billable</Badge>}
                      </Td>
                      <Td className="text-right font-mono">{fmtHours(e.hours)}</Td>
                      <Td className="text-right">
                        {e.invoiceId ? (
                          <Link href={`/app/finance/invoices/${e.invoiceId}`} className="text-xs underline">
                            Invoiced
                          </Link>
                        ) : (
                          (manage || e.employeeId === me?.id) && (
                            <ActionButton action={deleteTimeAction} fields={{ id: e.id }} confirm="Delete this time entry?">
                              ×
                            </ActionButton>
                          )
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card title="Log time">
            <TimeForm
              action={logTimeAction}
              projects={[{ id: project.id, label: `${project.code} · ${project.name}`, billingType: project.billingType }]}
              tasks={[{ id: t.id, projectId: project.id, title: t.title }]}
              employees={manage ? empOpts : undefined}
              defaultEmployeeId={me?.id}
              defaultDate={today}
              defaultProjectId={project.id}
              defaultTaskId={t.id}
              lockProject
              compact
            />
          </Card>
        </div>
      </div>
    </>
  );
}
