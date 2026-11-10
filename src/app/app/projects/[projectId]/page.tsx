import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, Input, StatusSelect, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { createTask, deleteTask, setTaskStatus } from "../actions";

export const metadata: Metadata = { title: "Project board" };

const COLUMNS = [
  { status: "todo", label: "To do" },
  { status: "doing", label: "Doing" },
  { status: "done", label: "Done" },
] as const;

export default async function ProjectBoardPage(props: PageProps<"/app/projects/[projectId]">) {
  const ws = await requireWorkspace({ module: "projects" });
  const { projectId } = await props.params;
  const id = Number(projectId);
  if (!Number.isInteger(id)) notFound();

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.orgId, ws.org.id)))
    .limit(1);
  if (!project) notFound();

  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, id), eq(schema.tasks.orgId, ws.org.id)))
    .orderBy(asc(schema.tasks.createdAt));

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {project.name} <StatusBadge value={project.status} />
          </span>
        }
        description={
          <>
            <Link href="/app/projects" className="underline-offset-4 hover:underline">
              ← All projects
            </Link>
            {" · "}
            {project.client || "No client"} · Budget {formatMoney(project.budget, ws.org.currency)} · Due{" "}
            {project.dueDate ? formatDate(project.dueDate) : "—"}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = tasks.filter((t) => t.status === col.status);
            return (
              <Card key={col.status} title={`${col.label} (${items.length})`} className="self-start">
                {items.length === 0 ? (
                  <EmptyState title="Nothing here" />
                ) : (
                  <ul className="space-y-3">
                    {items.map((t) => (
                      <li key={t.id} className="rounded-2xl border border-line bg-paper/60 p-3">
                        <p className="font-medium">{t.title}</p>
                        <p className="text-xs text-ink-mute">{t.assignee || "Unassigned"}</p>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <StatusSelect action={setTaskStatus} id={t.id} value={t.status} options={["todo", "doing", "done"]} label="Move task" />
                          <ActionButton action={deleteTask} fields={{ id: t.id }} confirm="Delete this task?" className="text-signal">
                            Delete
                          </ActionButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>

        <Card title="Add task" className="self-start">
          <ActionForm action={createTask} className="space-y-3">
            <input type="hidden" name="projectId" value={project.id} />
            <Input label="Title" name="title" placeholder="Draft wireframes" />
            <Input label="Assignee" name="assignee" placeholder="Priya" />
            <SubmitButton className="w-full">Add task</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
