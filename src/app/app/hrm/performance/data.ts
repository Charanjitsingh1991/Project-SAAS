import "server-only";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { resolveMyEmployee } from "@/lib/hrm-data";
import { cycleRange, goalStatus } from "@/lib/performance";
import { canUseModule, planModules, requireWorkspace } from "@/lib/tenancy";

/**
 * Performance guard. HR/admins (HRM module access) manage everything; any other member may reach
 * self-service when the workspace has HRM + the performance feature, scoped to their own employee record.
 */
export async function requirePerformance(opts: { manage?: boolean } = {}) {
  const ws = await requireWorkspace({ feature: "performance" });
  if (!planModules(ws).includes("hrm")) redirect("/app?denied=hrm");
  const isHr = canUseModule(ws, "hrm");
  if (opts.manage && !isHr) redirect("/app/hrm/performance/me");
  const me = await resolveMyEmployee(ws.org.id, ws.user);
  return { ws, isHr, me: me && me.status !== "exited" ? me : null };
}

export type PerfCtx = Awaited<ReturnType<typeof requirePerformance>>;

export async function loadGoal(orgId: number, id: number) {
  if (!Number.isInteger(id)) return null;
  const [g] = await db.select().from(schema.goals).where(and(eq(schema.goals.id, id), eq(schema.goals.orgId, orgId))).limit(1);
  return g ?? null;
}

export async function loadReview(orgId: number, id: number) {
  if (!Number.isInteger(id)) return null;
  const [r] = await db.select().from(schema.performanceReviews).where(and(eq(schema.performanceReviews.id, id), eq(schema.performanceReviews.orgId, orgId))).limit(1);
  return r ?? null;
}

export async function loadEmployee(orgId: number, id: number) {
  if (!Number.isInteger(id)) return null;
  const [e] = await db.select().from(schema.employees).where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId))).limit(1);
  return e ?? null;
}

/** Who may act on a review: HR, the reviewee (self part) and the assigned reviewer (manager part). */
export function reviewRoles(p: PerfCtx, review: { employeeId: number; reviewerId: number | null }) {
  const isSelf = !!p.me && p.me.id === review.employeeId;
  const isReviewer = !!p.me && p.me.id === review.reviewerId;
  return { isSelf, isReviewer, canManage: p.isHr || isReviewer, canView: p.isHr || isSelf || isReviewer };
}

/** Goal health anchored to the cycle start (or creation date when the cycle label is free-form). */
export function liveGoalStatus(g: { progress: number; dueDate: string | null; cycle: string; createdAt: Date }, today: string) {
  const start = cycleRange(g.cycle)?.start ?? g.createdAt.toISOString().slice(0, 10);
  return goalStatus({ progress: g.progress, dueDate: g.dueDate, startDate: start > today ? today : start }, today);
}
