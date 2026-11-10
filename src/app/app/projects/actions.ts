"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";

const ProjectSchema = z.object({
  name: z.string().min(2, "Enter a project name."),
  client: z.string().max(120).optional(),
  budget: z.coerce.number().int().min(0, "Must be 0 or more."),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").optional(),
  status: z.enum(["planning", "active", "on_hold", "done"]),
});

export async function createProject(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "projects" });
  const parsed = ProjectSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };
  await db.insert(schema.projects).values({ ...parsed.data, orgId: ws.org.id });
  refresh();
  return { ok: true, message: `${parsed.data.name} created.` };
}

export async function setProjectStatus(fd: FormData) {
  const ws = await requireWorkspace({ module: "projects" });
  const status = z.enum(["planning", "active", "on_hold", "done"]).parse(fd.get("status"));
  await db
    .update(schema.projects)
    .set({ status })
    .where(and(eq(schema.projects.id, Number(fd.get("id"))), eq(schema.projects.orgId, ws.org.id)));
  refresh();
}

const TaskSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  title: z.string().min(2, "Enter a task title.").max(200),
  assignee: z.string().max(80).optional(),
});

export async function createTask(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "projects" });
  const parsed = TaskSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };

  const [project] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, parsed.data.projectId), eq(schema.projects.orgId, ws.org.id)))
    .limit(1);
  if (!project) return { errors: { title: ["Project not found."] } };

  await db.insert(schema.tasks).values({ ...parsed.data, orgId: ws.org.id });
  refresh();
  return { ok: true, message: "Task added." };
}

export async function setTaskStatus(fd: FormData) {
  const ws = await requireWorkspace({ module: "projects" });
  const status = z.enum(["todo", "doing", "done"]).parse(fd.get("status"));
  await db
    .update(schema.tasks)
    .set({ status })
    .where(and(eq(schema.tasks.id, Number(fd.get("id"))), eq(schema.tasks.orgId, ws.org.id)));
  refresh();
}

export async function deleteTask(fd: FormData) {
  const ws = await requireWorkspace({ module: "projects" });
  await db.delete(schema.tasks).where(and(eq(schema.tasks.id, Number(fd.get("id"))), eq(schema.tasks.orgId, ws.org.id)));
  refresh();
}
