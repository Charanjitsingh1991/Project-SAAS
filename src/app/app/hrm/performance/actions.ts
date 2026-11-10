"use server";

import { and, eq, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { formObject, todayYmd } from "@/lib/format";
import { isValidYmd } from "@/lib/hrm";
import { clampProgress, nextReviewStatus } from "@/lib/performance";
import { liveGoalStatus, loadEmployee, loadGoal, loadReview, requirePerformance, reviewRoles } from "./data";

const Id = z.string().regex(/^\d+$/, "Invalid selection.");
const Ymd = z.string().refine(isValidYmd, "Enter a valid date.");
const Cycle = z.string().trim().min(2, "Enter a cycle, e.g. 2026-H2.").max(20);
const Rating = z.coerce.number().int().min(1, "Rate 1–5.").max(5, "Rate 1–5.");

/* ───── Goals ───── */

const GoalSchema = z.object({
  employeeId: Id,
  title: z.string().min(2, "Enter a goal.").max(160),
  description: z.string().max(2000).optional(),
  cycle: Cycle,
  dueDate: Ymd.optional(),
  progress: z.coerce.number().min(0).max(100).default(0),
  weight: z.coerce.number().int().min(1, "Weight 1–10.").max(10, "Weight 1–10.").default(1),
});

export async function createGoal(_: FormState, fd: FormData): Promise<FormState> {
  const p = await requirePerformance({ manage: true });
  const parsed = GoalSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const emp = await loadEmployee(p.ws.org.id, Number(v.employeeId));
  if (!emp || emp.status === "exited") return { errors: { employeeId: ["Employee not found."] } };
  const progress = clampProgress(v.progress);
  const today = todayYmd();
  const status = liveGoalStatus({ progress, dueDate: v.dueDate ?? null, cycle: v.cycle, createdAt: new Date() }, today);
  const [row] = await db
    .insert(schema.goals)
    .values({ orgId: p.ws.org.id, employeeId: emp.id, title: v.title, description: v.description ?? null, cycle: v.cycle, dueDate: v.dueDate ?? null, progress, weight: v.weight, status })
    .returning({ id: schema.goals.id });
  await logActivity(ctxOf(p.ws), { module: "hrm", entityType: "goal", entityId: row.id, action: "created", summary: `Set goal "${v.title}" for ${emp.name} (${v.cycle})` });
  refresh();
  return { ok: true, message: "Goal added." };
}

export async function updateGoal(_: FormState, fd: FormData): Promise<FormState> {
  const p = await requirePerformance({ manage: true });
  const raw = formObject(fd);
  const g = await loadGoal(p.ws.org.id, Number(raw.id));
  if (!g) return { message: "Goal not found." };
  const parsed = GoalSchema.safeParse({ ...raw, employeeId: String(g.employeeId) });
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const progress = clampProgress(v.progress);
  const status = liveGoalStatus({ progress, dueDate: v.dueDate ?? null, cycle: v.cycle, createdAt: g.createdAt }, todayYmd());
  await db
    .update(schema.goals)
    .set({ title: v.title, description: v.description ?? null, cycle: v.cycle, dueDate: v.dueDate ?? null, progress, weight: v.weight, status })
    .where(and(eq(schema.goals.id, g.id), eq(schema.goals.orgId, p.ws.org.id)));
  await logActivity(ctxOf(p.ws), { module: "hrm", entityType: "goal", entityId: g.id, action: "updated", summary: `Updated goal "${v.title}"` });
  refresh();
  return { ok: true, message: "Saved." };
}

/** Progress check-in: HR, or the employee who owns the goal. */
export async function updateGoalProgress(_: FormState, fd: FormData): Promise<FormState> {
  const p = await requirePerformance();
  const g = await loadGoal(p.ws.org.id, Number(fd.get("id")));
  if (!g) return { message: "Goal not found." };
  if (!p.isHr && p.me?.id !== g.employeeId) return { message: "You can only update your own goals." };
  const n = Number(fd.get("progress"));
  if (fd.get("progress") === null || fd.get("progress") === "" || !Number.isFinite(n) || n < 0 || n > 100) return { errors: { progress: ["Enter 0–100."] } };
  const progress = clampProgress(n);
  const status = liveGoalStatus({ ...g, progress }, todayYmd());
  await db.update(schema.goals).set({ progress, status }).where(and(eq(schema.goals.id, g.id), eq(schema.goals.orgId, p.ws.org.id)));
  await logActivity(ctxOf(p.ws), { module: "hrm", entityType: "goal", entityId: g.id, action: "progress", summary: `Goal "${g.title}" progress ${g.progress}% → ${progress}%` });
  refresh();
  return { ok: true, message: `Progress ${progress}% · ${status.replace("_", " ")}` };
}

export async function deleteGoal(fd: FormData) {
  const p = await requirePerformance({ manage: true });
  const g = await loadGoal(p.ws.org.id, Number(fd.get("id")));
  if (!g) return;
  await db.delete(schema.goals).where(and(eq(schema.goals.id, g.id), eq(schema.goals.orgId, p.ws.org.id)));
  await logActivity(ctxOf(p.ws), { module: "hrm", entityType: "goal", entityId: g.id, action: "deleted", summary: `Deleted goal "${g.title}"` });
  refresh();
}

/* ───── Reviews ───── */

export async function createReview(_: FormState, fd: FormData): Promise<FormState> {
  const p = await requirePerformance({ manage: true });
  const parsed = z.object({ employeeId: Id, cycle: Cycle, reviewerId: Id.optional() }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const orgId = p.ws.org.id;
  const emp = await loadEmployee(orgId, Number(v.employeeId));
  if (!emp || emp.status === "exited") return { errors: { employeeId: ["Employee not found."] } };
  const reviewerId = v.reviewerId ? Number(v.reviewerId) : emp.managerId;
  if (reviewerId === emp.id) return { errors: { reviewerId: ["Choose someone other than the employee."] } };
  if (reviewerId && !(await loadEmployee(orgId, reviewerId))) return { errors: { reviewerId: ["Reviewer not found."] } };
  const [dup] = await db
    .select({ id: schema.performanceReviews.id })
    .from(schema.performanceReviews)
    .where(and(eq(schema.performanceReviews.employeeId, emp.id), eq(schema.performanceReviews.cycle, v.cycle)))
    .limit(1);
  if (dup) return { errors: { employeeId: [`${emp.name} already has a ${v.cycle} review.`] } };
  const [row] = await db.insert(schema.performanceReviews).values({ orgId, employeeId: emp.id, reviewerId: reviewerId ?? null, cycle: v.cycle }).returning({ id: schema.performanceReviews.id });
  await logActivity(ctxOf(p.ws), { module: "hrm", entityType: "review", entityId: row.id, action: "created", summary: `Started ${v.cycle} review for ${emp.name}` });
  refresh();
  return { ok: true, message: "Review started." };
}

/** Opens a review for every active employee without one in the cycle; reviewer = reporting manager. */
export async function startReviewCycle(_: FormState, fd: FormData): Promise<FormState> {
  const p = await requirePerformance({ manage: true });
  const cycle = Cycle.safeParse(String(fd.get("cycle") ?? ""));
  if (!cycle.success) return { errors: { cycle: [cycle.error.issues[0].message] } };
  const orgId = p.ws.org.id;
  const [emps, existing] = await Promise.all([
    db.select({ id: schema.employees.id, managerId: schema.employees.managerId }).from(schema.employees).where(and(eq(schema.employees.orgId, orgId), ne(schema.employees.status, "exited"))),
    db.select({ employeeId: schema.performanceReviews.employeeId }).from(schema.performanceReviews).where(and(eq(schema.performanceReviews.orgId, orgId), eq(schema.performanceReviews.cycle, cycle.data))),
  ]);
  const have = new Set(existing.map((e) => e.employeeId));
  const ids = new Set(emps.map((e) => e.id));
  const todo = emps.filter((e) => !have.has(e.id));
  if (!todo.length) return { message: `Everyone already has a ${cycle.data} review.` };
  await db
    .insert(schema.performanceReviews)
    .values(todo.map((e) => ({ orgId, employeeId: e.id, reviewerId: e.managerId && ids.has(e.managerId) ? e.managerId : null, cycle: cycle.data })));
  await logActivity(ctxOf(p.ws), { module: "hrm", entityType: "review", action: "cycle_started", summary: `Started ${cycle.data} review cycle for ${todo.length} employee(s)` });
  refresh();
  return { ok: true, message: `Opened ${todo.length} review(s) for ${cycle.data}.` };
}

export async function submitSelfReview(_: FormState, fd: FormData): Promise<FormState> {
  const p = await requirePerformance();
  const r = await loadReview(p.ws.org.id, Number(fd.get("id")));
  if (!r) return { message: "Review not found." };
  if (!reviewRoles(p, r).isSelf) return { message: "Only the employee can submit their self-review." };
  const parsed = z.object({ selfRating: Rating, selfComments: z.string().max(4000).optional() }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const next = nextReviewStatus(r.status, "submit_self", false);
  if (!next) return { message: "The self-review is already submitted." };
  await db
    .update(schema.performanceReviews)
    .set({ selfRating: parsed.data.selfRating, selfComments: parsed.data.selfComments ?? null, status: next })
    .where(and(eq(schema.performanceReviews.id, r.id), eq(schema.performanceReviews.orgId, p.ws.org.id)));
  await logActivity(ctxOf(p.ws), { module: "hrm", entityType: "review", entityId: r.id, action: "self_submitted", summary: `Self-review submitted for ${r.cycle}` });
  refresh();
  return { ok: true, message: "Self-review submitted to your manager." };
}

/** Manager assessment; intent=complete finalises, otherwise saves a draft. */
export async function saveManagerReview(_: FormState, fd: FormData): Promise<FormState> {
  const p = await requirePerformance();
  const r = await loadReview(p.ws.org.id, Number(fd.get("id")));
  if (!r) return { message: "Review not found." };
  if (!reviewRoles(p, r).canManage) return { message: "Only HR or the assigned reviewer can do this." };
  if (r.status === "completed") return { message: "Reopen the review to edit it." };
  const complete = fd.get("intent") === "complete";
  const parsed = z
    .object({ managerRating: complete ? Rating : Rating.optional(), strengths: z.string().max(4000).optional(), improvements: z.string().max(4000).optional() })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const status = complete ? nextReviewStatus(r.status, "complete", true)! : r.status;
  await db
    .update(schema.performanceReviews)
    .set({ managerRating: v.managerRating ?? null, strengths: v.strengths ?? null, improvements: v.improvements ?? null, status, completedAt: complete ? new Date() : null })
    .where(and(eq(schema.performanceReviews.id, r.id), eq(schema.performanceReviews.orgId, p.ws.org.id)));
  const emp = await loadEmployee(p.ws.org.id, r.employeeId);
  await logActivity(ctxOf(p.ws), {
    module: "hrm",
    entityType: "review",
    entityId: r.id,
    action: complete ? "completed" : "updated",
    summary: `${complete ? "Completed" : "Saved"} ${r.cycle} review for ${emp?.name ?? "employee"}${complete ? ` — rated ${v.managerRating}/5` : ""}`,
  });
  refresh();
  return { ok: true, message: complete ? "Review completed." : "Draft saved." };
}

export async function reopenReview(fd: FormData) {
  const p = await requirePerformance();
  const r = await loadReview(p.ws.org.id, Number(fd.get("id")));
  if (!r || !reviewRoles(p, r).canManage) return;
  const next = nextReviewStatus(r.status, "reopen", true);
  if (!next) return;
  await db.update(schema.performanceReviews).set({ status: next, completedAt: null }).where(and(eq(schema.performanceReviews.id, r.id), eq(schema.performanceReviews.orgId, p.ws.org.id)));
  await logActivity(ctxOf(p.ws), { module: "hrm", entityType: "review", entityId: r.id, action: "reopened", summary: `Reopened ${r.cycle} review` });
  refresh();
}

export async function deleteReview(fd: FormData) {
  const p = await requirePerformance({ manage: true });
  const r = await loadReview(p.ws.org.id, Number(fd.get("id")));
  if (!r) return;
  await db.delete(schema.performanceReviews).where(and(eq(schema.performanceReviews.id, r.id), eq(schema.performanceReviews.orgId, p.ws.org.id)));
  await logActivity(ctxOf(p.ws), { module: "hrm", entityType: "review", entityId: r.id, action: "deleted", summary: `Deleted ${r.cycle} review` });
  redirect(`/app/hrm/performance?cycle=${encodeURIComponent(r.cycle)}`);
}
