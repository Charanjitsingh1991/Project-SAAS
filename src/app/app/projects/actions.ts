"use server";

import { and, eq, isNull, max } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { BILLING_TYPES, PRIORITIES, PROJECT_STATUSES, TASK_STATUSES } from "@/db/schema";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { formObject, toMinor } from "@/lib/format";
import { invoiceProjectTime } from "@/lib/posting";
import { nextNumber } from "@/lib/sequence";
import { requireWorkspace, type ActiveWorkspace } from "@/lib/tenancy";
import { canManage } from "@/lib/roles";
import { PROJECT_TONES } from "./tones";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.").optional();
const optId = z.coerce.number().int().positive().optional();
const reqId = z.coerce.number().int().positive();
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount.").optional();

const ws_ = () => requireWorkspace({ module: "projects" });

function fail(e: z.ZodError): FormState {
  return { ok: false, message: "Please fix the highlighted fields.", errors: z.flattenError(e).fieldErrors };
}

async function ownProject(ws: ActiveWorkspace, projectId: number) {
  const [p] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, ws.org.id)))
    .limit(1);
  return p;
}

async function ownTask(ws: ActiveWorkspace, taskId: number) {
  const [t] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.orgId, ws.org.id)))
    .limit(1);
  return t;
}

async function validRefs(
  ws: ActiveWorkspace,
  refs: { companyId?: number; ownerId?: number; assigneeId?: number; milestoneId?: number; projectId?: number },
): Promise<Record<string, string[]> | null> {
  const orgId = ws.org.id;
  const errs: Record<string, string[]> = {};
  if (refs.companyId && !(await db.$count(schema.companies, and(eq(schema.companies.id, refs.companyId), eq(schema.companies.orgId, orgId)))))
    errs.companyId = ["Unknown client."];
  if (refs.ownerId && !(await db.$count(schema.memberships, and(eq(schema.memberships.userId, refs.ownerId), eq(schema.memberships.orgId, orgId)))))
    errs.ownerId = ["Unknown owner."];
  if (refs.assigneeId && !(await db.$count(schema.employees, and(eq(schema.employees.id, refs.assigneeId), eq(schema.employees.orgId, orgId)))))
    errs.assigneeId = ["Unknown employee."];
  if (
    refs.milestoneId &&
    !(await db.$count(
      schema.milestones,
      and(eq(schema.milestones.id, refs.milestoneId), eq(schema.milestones.orgId, orgId), refs.projectId ? eq(schema.milestones.projectId, refs.projectId) : undefined),
    ))
  )
    errs.milestoneId = ["Unknown milestone."];
  return Object.keys(errs).length ? errs : null;
}

/* ───────────── Projects ───────────── */

const ProjectSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a project name.").max(120),
    companyId: optId,
    description: z.string().max(4000).optional(),
    billingType: z.enum(BILLING_TYPES),
    budget: money,
    hourlyRate: money,
    startDate: ymd,
    dueDate: ymd,
    color: z.enum(PROJECT_TONES),
    status: z.enum(PROJECT_STATUSES),
    ownerId: optId,
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, { path: ["dueDate"], message: "Due date is before the start date." });

export async function createProjectAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await ws_();
  const parsed = ProjectSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error);
  const v = parsed.data;
  const bad = await validRefs(ws, v);
  if (bad) return { ok: false, message: "Please fix the highlighted fields.", errors: bad };
  const code = await nextNumber(ws.org.id, "project");
  const [p] = await db
    .insert(schema.projects)
    .values({
      orgId: ws.org.id,
      code,
      name: v.name,
      companyId: v.companyId ?? null,
      description: v.description ?? null,
      ownerId: v.ownerId ?? ws.user.id,
      color: v.color,
      billingType: v.billingType,
      budget: toMinor(v.budget),
      hourlyRate: toMinor(v.hourlyRate),
      startDate: v.startDate ?? null,
      dueDate: v.dueDate ?? null,
      status: v.status,
    })
    .returning({ id: schema.projects.id });
  await logActivity(ctxOf(ws), { module: "projects", entityType: "project", entityId: p.id, action: "created", summary: `Created project ${code} ${v.name}` });
  refresh();
  redirect(`/app/projects/${p.id}`);
}

export async function updateProjectAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await ws_();
  const o = formObject(fd);
  const id = reqId.safeParse(o.id);
  if (!id.success) return { ok: false, message: "Project not found." };
  const project = await ownProject(ws, id.data);
  if (!project) return { ok: false, message: "Project not found." };
  const parsed = ProjectSchema.safeParse(o);
  if (!parsed.success) return fail(parsed.error);
  const v = parsed.data;
  const bad = await validRefs(ws, v);
  if (bad) return { ok: false, message: "Please fix the highlighted fields.", errors: bad };
  await db
    .update(schema.projects)
    .set({
      name: v.name,
      companyId: v.companyId ?? null,
      description: v.description ?? null,
      ownerId: v.ownerId ?? project.ownerId,
      color: v.color,
      billingType: v.billingType,
      budget: toMinor(v.budget),
      hourlyRate: toMinor(v.hourlyRate),
      startDate: v.startDate ?? null,
      dueDate: v.dueDate ?? null,
      status: v.status,
    })
    .where(eq(schema.projects.id, project.id));
  await logActivity(ctxOf(ws), { module: "projects", entityType: "project", entityId: project.id, action: "updated", summary: `Updated project ${project.code}` });
  refresh();
  return { ok: true, message: "Project saved." };
}

export async function setProjectStatusAction(fd: FormData) {
  const ws = await ws_();
  const id = reqId.safeParse(fd.get("id"));
  const status = z.enum(PROJECT_STATUSES).safeParse(fd.get("status"));
  if (!id.success || !status.success) return;
  const p = await ownProject(ws, id.data);
  if (!p) return;
  await db.update(schema.projects).set({ status: status.data }).where(eq(schema.projects.id, p.id));
  await logActivity(ctxOf(ws), { module: "projects", entityType: "project", entityId: p.id, action: "status", summary: `${p.code} → ${status.data.replace("_", " ")}` });
  refresh();
}

export async function deleteProjectAction(fd: FormData) {
  const ws = await ws_();
  const id = reqId.safeParse(fd.get("id"));
  if (!id.success) return;
  const p = await ownProject(ws, id.data);
  if (!p) return;
  if (!canManage(ws.role) && p.ownerId !== ws.user.id) return;
  await db.delete(schema.projects).where(and(eq(schema.projects.id, p.id), eq(schema.projects.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "projects", entityType: "project", entityId: p.id, action: "deleted", summary: `Deleted project ${p.code} ${p.name}` });
  refresh();
  redirect("/app/projects");
}

/* ───────────── Tasks ───────────── */

const TaskSchema = z
  .object({
    title: z.string().trim().min(2, "Enter a task title.").max(200),
    description: z.string().max(4000).optional(),
    assigneeId: optId,
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(PRIORITIES),
    startDate: ymd,
    dueDate: ymd,
    estimateHours: z.string().regex(/^\d+(\.\d+)?$/, "Enter hours.").optional(),
    milestoneId: optId,
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, { path: ["dueDate"], message: "Due date is before the start date." });

export async function createTaskAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await ws_();
  const o = formObject(fd);
  const pid = reqId.safeParse(o.projectId);
  if (!pid.success) return { ok: false, message: "Project not found." };
  const project = await ownProject(ws, pid.data);
  if (!project) return { ok: false, message: "Project not found." };
  const parsed = TaskSchema.safeParse(o);
  if (!parsed.success) return fail(parsed.error);
  const v = parsed.data;
  const bad = await validRefs(ws, { ...v, projectId: project.id });
  if (bad) return { ok: false, message: "Please fix the highlighted fields.", errors: bad };
  const status = v.status ?? "todo";
  const [{ top }] = await db.select({ top: max(schema.tasks.sortOrder) }).from(schema.tasks).where(eq(schema.tasks.projectId, project.id));
  const [t] = await db
    .insert(schema.tasks)
    .values({
      orgId: ws.org.id,
      projectId: project.id,
      milestoneId: v.milestoneId ?? null,
      title: v.title,
      description: v.description ?? null,
      assigneeId: v.assigneeId ?? null,
      status,
      priority: v.priority,
      startDate: v.startDate ?? null,
      dueDate: v.dueDate ?? null,
      estimateHours: v.estimateHours ? Number(v.estimateHours) : null,
      sortOrder: (top ?? 0) + 1,
      completedAt: status === "done" ? new Date() : null,
    })
    .returning({ id: schema.tasks.id });
  await logActivity(ctxOf(ws), { module: "projects", entityType: "task", entityId: t.id, action: "created", summary: `Added task “${v.title}” to ${project.code}` });
  refresh();
  return { ok: true, message: "Task added." };
}

export async function updateTaskAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await ws_();
  const o = formObject(fd);
  const id = reqId.safeParse(o.id);
  if (!id.success) return { ok: false, message: "Task not found." };
  const task = await ownTask(ws, id.data);
  if (!task) return { ok: false, message: "Task not found." };
  const parsed = TaskSchema.safeParse(o);
  if (!parsed.success) return fail(parsed.error);
  const v = parsed.data;
  const bad = await validRefs(ws, { ...v, projectId: task.projectId });
  if (bad) return { ok: false, message: "Please fix the highlighted fields.", errors: bad };
  const status = v.status ?? task.status;
  await db
    .update(schema.tasks)
    .set({
      title: v.title,
      description: v.description ?? null,
      assigneeId: v.assigneeId ?? null,
      milestoneId: v.milestoneId ?? null,
      status,
      priority: v.priority,
      startDate: v.startDate ?? null,
      dueDate: v.dueDate ?? null,
      estimateHours: v.estimateHours ? Number(v.estimateHours) : null,
      completedAt: status === "done" ? (task.completedAt ?? new Date()) : null,
    })
    .where(eq(schema.tasks.id, task.id));
  await logActivity(ctxOf(ws), { module: "projects", entityType: "task", entityId: task.id, action: "updated", summary: `Updated task “${v.title}”` });
  refresh();
  return { ok: true, message: "Task saved." };
}

/** Kanban drop and inline status select. */
export async function moveTaskAction(fd: FormData) {
  const ws = await ws_();
  const id = reqId.safeParse(fd.get("id"));
  const status = z.enum(TASK_STATUSES).safeParse(fd.get("status"));
  if (!id.success || !status.success) return;
  const t = await ownTask(ws, id.data);
  if (!t || t.status === status.data) return;
  await db
    .update(schema.tasks)
    .set({ status: status.data, completedAt: status.data === "done" ? new Date() : null })
    .where(eq(schema.tasks.id, t.id));
  await logActivity(ctxOf(ws), { module: "projects", entityType: "task", entityId: t.id, action: "status", summary: `“${t.title}” → ${status.data.replace("_", " ")}` });
  refresh();
}

export async function setTaskPriorityAction(fd: FormData) {
  const ws = await ws_();
  const id = reqId.safeParse(fd.get("id"));
  const priority = z.enum(PRIORITIES).safeParse(fd.get("priority"));
  if (!id.success || !priority.success) return;
  const t = await ownTask(ws, id.data);
  if (!t) return;
  await db.update(schema.tasks).set({ priority: priority.data }).where(eq(schema.tasks.id, t.id));
  refresh();
}

export async function deleteTaskAction(fd: FormData) {
  const ws = await ws_();
  const id = reqId.safeParse(fd.get("id"));
  if (!id.success) return;
  const t = await ownTask(ws, id.data);
  if (!t) return;
  await db.delete(schema.tasks).where(eq(schema.tasks.id, t.id));
  await logActivity(ctxOf(ws), { module: "projects", entityType: "task", entityId: t.id, action: "deleted", summary: `Deleted task “${t.title}”` });
  refresh();
  redirect(`/app/projects/${t.projectId}`);
}

export async function addCommentAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await ws_();
  const o = formObject(fd);
  const id = reqId.safeParse(o.taskId);
  const body = z.string().trim().min(1, "Write a comment.").max(4000).safeParse(o.body);
  if (!id.success) return { ok: false, message: "Task not found." };
  if (!body.success) return { ok: false, message: "Write a comment.", errors: { body: ["Write a comment."] } };
  const t = await ownTask(ws, id.data);
  if (!t) return { ok: false, message: "Task not found." };
  await db.insert(schema.taskComments).values({ orgId: ws.org.id, taskId: t.id, authorId: ws.user.id, body: body.data });
  await logActivity(ctxOf(ws), { module: "projects", entityType: "task", entityId: t.id, action: "commented", summary: `Commented on “${t.title}”` });
  refresh();
  return { ok: true, message: "Comment posted." };
}

/* ───────────── Milestones ───────────── */

const MilestoneSchema = z.object({ title: z.string().trim().min(2, "Enter a title.").max(160), dueDate: ymd });

export async function createMilestoneAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await ws_();
  const o = formObject(fd);
  const pid = reqId.safeParse(o.projectId);
  if (!pid.success) return { ok: false, message: "Project not found." };
  const project = await ownProject(ws, pid.data);
  if (!project) return { ok: false, message: "Project not found." };
  const parsed = MilestoneSchema.safeParse(o);
  if (!parsed.success) return fail(parsed.error);
  const [m] = await db
    .insert(schema.milestones)
    .values({ orgId: ws.org.id, projectId: project.id, title: parsed.data.title, dueDate: parsed.data.dueDate ?? null })
    .returning({ id: schema.milestones.id });
  await logActivity(ctxOf(ws), { module: "projects", entityType: "milestone", entityId: m.id, action: "created", summary: `Milestone “${parsed.data.title}” on ${project.code}` });
  refresh();
  return { ok: true, message: "Milestone added." };
}

export async function updateMilestoneAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await ws_();
  const o = formObject(fd);
  const id = reqId.safeParse(o.id);
  const parsed = MilestoneSchema.safeParse(o);
  if (!id.success) return { ok: false, message: "Milestone not found." };
  if (!parsed.success) return fail(parsed.error);
  const res = await db
    .update(schema.milestones)
    .set({ title: parsed.data.title, dueDate: parsed.data.dueDate ?? null })
    .where(and(eq(schema.milestones.id, id.data), eq(schema.milestones.orgId, ws.org.id)))
    .returning({ id: schema.milestones.id });
  if (!res.length) return { ok: false, message: "Milestone not found." };
  refresh();
  return { ok: true, message: "Saved." };
}

export async function toggleMilestoneAction(fd: FormData) {
  const ws = await ws_();
  const id = reqId.safeParse(fd.get("id"));
  if (!id.success) return;
  const [m] = await db
    .select()
    .from(schema.milestones)
    .where(and(eq(schema.milestones.id, id.data), eq(schema.milestones.orgId, ws.org.id)))
    .limit(1);
  if (!m) return;
  await db.update(schema.milestones).set({ done: !m.done }).where(eq(schema.milestones.id, m.id));
  await logActivity(ctxOf(ws), { module: "projects", entityType: "milestone", entityId: m.id, action: m.done ? "reopened" : "completed", summary: `Milestone “${m.title}” ${m.done ? "reopened" : "completed"}` });
  refresh();
}

export async function deleteMilestoneAction(fd: FormData) {
  const ws = await ws_();
  const id = reqId.safeParse(fd.get("id"));
  if (!id.success) return;
  await db.delete(schema.milestones).where(and(eq(schema.milestones.id, id.data), eq(schema.milestones.orgId, ws.org.id)));
  refresh();
}

/* ───────────── Time ───────────── */

const TimeSchema = z.object({
  projectId: reqId,
  taskId: optId,
  employeeId: optId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  hours: z.coerce.number("Enter hours.").min(0.25, "Minimum 0.25 hours.").max(24, "Maximum 24 hours."),
  description: z.string().max(500).optional(),
  billable: z.enum(["1", "0"]).optional(),
});

export async function logTimeAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await ws_();
  const parsed = TimeSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error);
  const v = parsed.data;
  const orgId = ws.org.id;

  const project = await ownProject(ws, v.projectId);
  if (!project) return { ok: false, message: "Project not found.", errors: { projectId: ["Choose a project."] } };

  const [linked] = await db
    .select({ id: schema.employees.id })
    .from(schema.employees)
    .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.userId, ws.user.id)))
    .limit(1);
  const employeeId = v.employeeId ?? linked?.id;
  if (!employeeId) return { ok: false, message: "Your account isn't linked to an employee record yet.", errors: { employeeId: ["Choose an employee."] } };
  if (!canManage(ws.role) && employeeId !== linked?.id) return { ok: false, message: "You can only log your own time." };
  if (!(await db.$count(schema.employees, and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, orgId)))))
    return { ok: false, message: "Unknown employee.", errors: { employeeId: ["Unknown employee."] } };

  if (v.taskId) {
    const t = await ownTask(ws, v.taskId);
    if (!t || t.projectId !== project.id) return { ok: false, message: "That task isn't part of the project.", errors: { taskId: ["Choose a task from this project."] } };
  }

  const billable = project.billingType === "non_billable" ? false : v.billable !== "0";
  const [e] = await db
    .insert(schema.timeEntries)
    .values({
      orgId,
      projectId: project.id,
      taskId: v.taskId ?? null,
      employeeId,
      date: v.date,
      hours: v.hours,
      description: v.description ?? null,
      billable,
    })
    .returning({ id: schema.timeEntries.id });
  await logActivity(ctxOf(ws), { module: "projects", entityType: "time_entry", entityId: e.id, action: "logged", summary: `Logged ${v.hours}h on ${project.code}` });
  refresh();
  return { ok: true, message: `Logged ${v.hours}h.` };
}

export async function deleteTimeAction(fd: FormData) {
  const ws = await ws_();
  const id = reqId.safeParse(fd.get("id"));
  if (!id.success) return;
  const [e] = await db
    .select()
    .from(schema.timeEntries)
    .where(and(eq(schema.timeEntries.id, id.data), eq(schema.timeEntries.orgId, ws.org.id)))
    .limit(1);
  if (!e || e.invoiceId) return;
  if (!canManage(ws.role)) {
    const [linked] = await db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, ws.org.id), eq(schema.employees.userId, ws.user.id)))
      .limit(1);
    if (linked?.id !== e.employeeId) return;
  }
  await db.delete(schema.timeEntries).where(eq(schema.timeEntries.id, e.id));
  refresh();
}

export async function billTimeAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await ws_();
  const id = reqId.safeParse(fd.get("projectId"));
  if (!id.success) return { ok: false, message: "Project not found." };
  const project = await ownProject(ws, id.data);
  if (!project) return { ok: false, message: "Project not found." };
  const unbilled = await db.$count(
    schema.timeEntries,
    and(eq(schema.timeEntries.projectId, project.id), eq(schema.timeEntries.billable, true), isNull(schema.timeEntries.invoiceId)),
  );
  if (!unbilled) return { ok: false, message: "No unbilled billable hours." };
  const res = await invoiceProjectTime(ctxOf(ws), project.id);
  if ("error" in res) return { ok: false, message: res.error };
  refresh();
  redirect(`/app/finance/invoices/${res.invoiceId}`);
}
