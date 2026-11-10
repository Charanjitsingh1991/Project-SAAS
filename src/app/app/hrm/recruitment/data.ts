import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity, type Ctx } from "@/lib/activity";
import { createChecklist } from "@/lib/hrm-data";
import { canHire, canMoveStage, isFilled, type CandidateStage } from "@/lib/recruitment";
import { nextNumber } from "@/lib/sequence";

export async function loadJob(orgId: number, id: number) {
  if (!Number.isInteger(id)) return null;
  const [job] = await db.select().from(schema.jobOpenings).where(and(eq(schema.jobOpenings.id, id), eq(schema.jobOpenings.orgId, orgId))).limit(1);
  return job ?? null;
}

export async function loadCandidate(orgId: number, id: number) {
  if (!Number.isInteger(id)) return null;
  const [c] = await db.select().from(schema.candidates).where(and(eq(schema.candidates.id, id), eq(schema.candidates.orgId, orgId))).limit(1);
  return c ?? null;
}

export async function hiredCount(orgId: number, jobId: number) {
  const [r] = await db
    .select({ n: count() })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.orgId, orgId), eq(schema.candidates.jobId, jobId), eq(schema.candidates.stage, "hired")));
  return r?.n ?? 0;
}

export type Result = { ok: true; id?: number } | { ok: false; message: string };

export async function moveCandidateStage(ctx: Ctx, candidateId: number, to: CandidateStage, rejectionReason?: string): Promise<Result> {
  const c = await loadCandidate(ctx.orgId, candidateId);
  if (!c) return { ok: false, message: "Candidate not found." };
  const check = canMoveStage(c.stage, to);
  if (!check.ok) return { ok: false, message: check.reason };
  await db
    .update(schema.candidates)
    .set({ stage: to, stageChangedAt: new Date(), rejectionReason: to === "rejected" ? (rejectionReason ?? null) : null })
    .where(and(eq(schema.candidates.id, c.id), eq(schema.candidates.orgId, ctx.orgId)));
  await logActivity(ctx, {
    module: "hrm",
    entityType: "candidate",
    entityId: c.id,
    action: "stage_changed",
    summary: `Moved candidate ${c.name} from ${c.stage} to ${to}${to === "rejected" && rejectionReason ? ` (${rejectionReason})` : ""}`,
  });
  return { ok: true };
}

/**
 * Converts an offer-stage candidate into an employee (with onboarding checklist), links the two,
 * and closes the opening once every position is filled.
 */
export async function hireCandidate(
  ctx: Ctx,
  input: { candidateId: number; joinDate: string; annualCtc: number; departmentId?: number | null; designation?: string; employmentType?: (typeof schema.EMPLOYMENT_TYPES)[number] },
): Promise<Result> {
  const c = await loadCandidate(ctx.orgId, input.candidateId);
  if (!c) return { ok: false, message: "Candidate not found." };
  const job = await loadJob(ctx.orgId, c.jobId);
  if (!job) return { ok: false, message: "Opening not found." };
  const hired = await hiredCount(ctx.orgId, job.id);
  const check = canHire(c.stage, job, hired);
  if (!check.ok) return { ok: false, message: check.reason };

  const departmentId = input.departmentId === undefined ? job.departmentId : input.departmentId;
  if (departmentId) {
    const [d] = await db
      .select({ id: schema.departments.id })
      .from(schema.departments)
      .where(and(eq(schema.departments.id, departmentId), eq(schema.departments.orgId, ctx.orgId)))
      .limit(1);
    if (!d) return { ok: false, message: "Department not found." };
  }

  const code = await nextNumber(ctx.orgId, "employee");
  const designation = input.designation?.trim() || job.title;
  const [emp] = await db
    .insert(schema.employees)
    .values({
      orgId: ctx.orgId,
      code,
      name: c.name,
      email: c.email,
      phone: c.phone,
      departmentId: departmentId ?? null,
      designation,
      managerId: job.hiringManagerId ?? null,
      employmentType: input.employmentType ?? job.employmentType,
      workLocation: job.location,
      joinDate: input.joinDate,
      annualCtc: input.annualCtc,
    })
    .returning({ id: schema.employees.id });
  await createChecklist(ctx.orgId, emp.id, "onboarding", input.joinDate);
  await db
    .update(schema.candidates)
    .set({ stage: "hired", employeeId: emp.id, stageChangedAt: new Date(), rejectionReason: null })
    .where(and(eq(schema.candidates.id, c.id), eq(schema.candidates.orgId, ctx.orgId)));

  const filled = isFilled(hired + 1, job.openings);
  if (filled) await db.update(schema.jobOpenings).set({ status: "closed" }).where(and(eq(schema.jobOpenings.id, job.id), eq(schema.jobOpenings.orgId, ctx.orgId)));

  await logActivity(ctx, { module: "hrm", entityType: "employee", entityId: emp.id, action: "created", summary: `Hired ${c.name} (${code}) as ${designation} from opening "${job.title}"` });
  await logActivity(ctx, { module: "hrm", entityType: "candidate", entityId: c.id, action: "hired", summary: `Hired candidate ${c.name} for ${job.title}${filled ? " — opening filled and closed" : ""}` });
  return { ok: true, id: emp.id };
}
