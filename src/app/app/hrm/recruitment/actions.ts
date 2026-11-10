"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { formObject, todayYmd } from "@/lib/format";
import { isValidYmd } from "@/lib/hrm";
import { toMinor } from "@/lib/money";
import { salaryRangeError } from "@/lib/recruitment";
import { requireWorkspace } from "@/lib/tenancy";
import { hireCandidate, loadCandidate, loadJob, moveCandidateStage } from "./data";

const guard = () => requireWorkspace({ module: "hrm", feature: "recruitment" });
const Id = z.string().regex(/^\d+$/, "Invalid selection.");
const Ymd = z.string().refine(isValidYmd, "Enter a valid date.");

const OpeningSchema = z.object({
  title: z.string().min(2, "Enter a job title.").max(120),
  departmentId: Id.optional(),
  hiringManagerId: Id.optional(),
  location: z.string().max(120).optional(),
  employmentType: z.enum(schema.EMPLOYMENT_TYPES),
  openings: z.coerce.number().int("Whole number.").min(1, "At least 1.").max(500),
  salaryMin: z.string().optional(),
  salaryMax: z.string().optional(),
  description: z.string().max(8000).optional(),
  status: z.enum(schema.JOB_STATUSES).default("open"),
});

/** Validates refs + salary band; returns the insert/update values or field errors. */
async function openingValues(orgId: number, raw: Record<string, string | undefined>) {
  const parsed = OpeningSchema.safeParse(raw);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const salaryMin = toMinor(v.salaryMin);
  const salaryMax = toMinor(v.salaryMax);
  const bandErr = salaryRangeError(salaryMin, salaryMax);
  if (bandErr) return { errors: { salaryMin: [bandErr] } };
  if (v.departmentId) {
    const [d] = await db.select({ id: schema.departments.id }).from(schema.departments).where(and(eq(schema.departments.id, Number(v.departmentId)), eq(schema.departments.orgId, orgId))).limit(1);
    if (!d) return { errors: { departmentId: ["Department not found."] } };
  }
  if (v.hiringManagerId) {
    const [e] = await db.select({ id: schema.employees.id }).from(schema.employees).where(and(eq(schema.employees.id, Number(v.hiringManagerId)), eq(schema.employees.orgId, orgId))).limit(1);
    if (!e) return { errors: { hiringManagerId: ["Employee not found."] } };
  }
  return {
    values: {
      title: v.title,
      departmentId: v.departmentId ? Number(v.departmentId) : null,
      hiringManagerId: v.hiringManagerId ? Number(v.hiringManagerId) : null,
      location: v.location ?? null,
      employmentType: v.employmentType,
      openings: v.openings,
      salaryMin,
      salaryMax,
      description: v.description ?? null,
      status: v.status,
    },
  };
}

export async function createOpening(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const r = await openingValues(ws.org.id, formObject(fd));
  if ("errors" in r) return { errors: r.errors };
  const [row] = await db.insert(schema.jobOpenings).values({ orgId: ws.org.id, ...r.values }).returning({ id: schema.jobOpenings.id });
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "job_opening", entityId: row.id, action: "created", summary: `Opened job "${r.values.title}" (${r.values.openings} position${r.values.openings === 1 ? "" : "s"})` });
  redirect(`/app/hrm/recruitment/${row.id}`);
}

export async function updateOpening(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const raw = formObject(fd);
  const job = await loadJob(ws.org.id, Number(raw.id));
  if (!job) return { message: "Opening not found." };
  const r = await openingValues(ws.org.id, raw);
  if ("errors" in r) return { errors: r.errors };
  await db.update(schema.jobOpenings).set(r.values).where(and(eq(schema.jobOpenings.id, job.id), eq(schema.jobOpenings.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "job_opening", entityId: job.id, action: "updated", summary: `Updated job "${r.values.title}"` });
  refresh();
  return { ok: true, message: "Saved." };
}

export async function setOpeningStatus(fd: FormData) {
  const ws = await guard();
  const status = z.enum(schema.JOB_STATUSES).safeParse(fd.get("status"));
  const job = await loadJob(ws.org.id, Number(fd.get("id")));
  if (!job || !status.success || job.status === status.data) return;
  await db.update(schema.jobOpenings).set({ status: status.data }).where(and(eq(schema.jobOpenings.id, job.id), eq(schema.jobOpenings.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "job_opening", entityId: job.id, action: "status_changed", summary: `Job "${job.title}" ${job.status} → ${status.data}` });
  refresh();
}

export async function deleteOpening(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm", feature: "recruitment", manage: true });
  const job = await loadJob(ws.org.id, Number(fd.get("id")));
  if (!job) return;
  await db.delete(schema.jobOpenings).where(and(eq(schema.jobOpenings.id, job.id), eq(schema.jobOpenings.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "job_opening", entityId: job.id, action: "deleted", summary: `Deleted job "${job.title}" and its candidates` });
  redirect("/app/hrm/recruitment");
}

/* ───── Candidates ───── */

const CandidateSchema = z.object({
  name: z.string().min(2, "Enter the candidate's name.").max(120),
  email: z.email("Enter a valid email.").toLowerCase().optional(),
  phone: z.string().max(30).optional(),
  source: z.string().max(40).default("other"),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  expectedSalary: z.string().optional(),
  currentCompany: z.string().max(120).optional(),
  noticePeriodDays: z.coerce.number().int().min(0, "Can't be negative.").max(365).optional(),
  notes: z.string().max(8000).optional(),
});

function candidateValues(raw: Record<string, string | undefined>) {
  const parsed = CandidateSchema.safeParse(raw);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const expectedSalary = toMinor(v.expectedSalary);
  if (!Number.isFinite(expectedSalary) || expectedSalary < 0) return { errors: { expectedSalary: ["Enter a valid amount."] } };
  return {
    values: {
      name: v.name,
      email: v.email ?? null,
      phone: v.phone ?? null,
      source: v.source,
      rating: v.rating ?? null,
      expectedSalary,
      currentCompany: v.currentCompany ?? null,
      noticePeriodDays: v.noticePeriodDays ?? null,
      notes: v.notes ?? null,
    },
  };
}

export async function addCandidate(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const raw = formObject(fd);
  const job = await loadJob(ws.org.id, Number(raw.jobId));
  if (!job) return { message: "Opening not found." };
  if (job.status === "closed") return { message: "This opening is closed — reopen it to add candidates." };
  const r = candidateValues(raw);
  if ("errors" in r) return { errors: r.errors };
  if (r.values.email) {
    const [dup] = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(and(eq(schema.candidates.orgId, ws.org.id), eq(schema.candidates.jobId, job.id), eq(schema.candidates.email, r.values.email)))
      .limit(1);
    if (dup) return { errors: { email: ["This candidate already applied to this opening."] } };
  }
  const [row] = await db.insert(schema.candidates).values({ orgId: ws.org.id, jobId: job.id, ...r.values, sortOrder: Date.now() }).returning({ id: schema.candidates.id });
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "candidate", entityId: row.id, action: "created", summary: `Added candidate ${r.values.name} to "${job.title}"` });
  refresh();
  return { ok: true, message: `${r.values.name} added to Applied.` };
}

export async function updateCandidate(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const raw = formObject(fd);
  const c = await loadCandidate(ws.org.id, Number(raw.id));
  if (!c) return { message: "Candidate not found." };
  const r = candidateValues(raw);
  if ("errors" in r) return { errors: r.errors };
  await db.update(schema.candidates).set(r.values).where(and(eq(schema.candidates.id, c.id), eq(schema.candidates.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "candidate", entityId: c.id, action: "updated", summary: `Updated candidate ${r.values.name}` });
  refresh();
  return { ok: true, message: "Saved." };
}

/** Kanban drop / stage select. Invalid moves (e.g. to Hired) are ignored and the board snaps back. */
export async function moveCandidate(fd: FormData) {
  const ws = await guard();
  const stage = z.enum(schema.CANDIDATE_STAGES).safeParse(fd.get("stage"));
  if (!stage.success) return;
  await moveCandidateStage(ctxOf(ws), Number(fd.get("id")), stage.data);
  refresh();
}

export async function rejectCandidate(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300);
  if (!reason) return { errors: { reason: ["Give a reason."] } };
  const r = await moveCandidateStage(ctxOf(ws), Number(fd.get("id")), "rejected", reason);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "Candidate rejected." };
}

export async function addCandidateNote(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const c = await loadCandidate(ws.org.id, Number(fd.get("id")));
  if (!c) return { message: "Candidate not found." };
  const note = String(fd.get("note") ?? "").trim().slice(0, 2000);
  if (!note) return { errors: { note: ["Write a note."] } };
  const entry = `[${todayYmd()} · ${ws.user.name}] ${note}`;
  const notes = (c.notes ? `${entry}\n\n${c.notes}` : entry).slice(0, 20000);
  await db.update(schema.candidates).set({ notes }).where(and(eq(schema.candidates.id, c.id), eq(schema.candidates.orgId, ws.org.id)));
  refresh();
  return { ok: true, message: "Note added." };
}

export async function hire(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const parsed = z
    .object({
      id: Id,
      joinDate: Ymd,
      annualCtc: z.string().min(1, "Enter the offered annual package."),
      designation: z.string().max(120).optional(),
      departmentId: Id.optional(),
      employmentType: z.enum(schema.EMPLOYMENT_TYPES).optional(),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const ctc = toMinor(v.annualCtc);
  if (!Number.isFinite(ctc) || ctc <= 0 || ctc > 1e13) return { errors: { annualCtc: ["Enter a valid annual package."] } };
  const r = await hireCandidate(ctxOf(ws), {
    candidateId: Number(v.id),
    joinDate: v.joinDate,
    annualCtc: ctc,
    designation: v.designation,
    departmentId: v.departmentId ? Number(v.departmentId) : null,
    employmentType: v.employmentType,
  });
  if (!r.ok) return { message: r.message };
  redirect(`/app/hrm/${r.id}`);
}
