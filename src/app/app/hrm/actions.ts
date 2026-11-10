"use server";

import { and, eq, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { addDaysYmd, formObject, todayYmd } from "@/lib/format";
import { emitEvent } from "@/lib/integrations/events";
import type { CountryPack } from "@/lib/countries";
import { UAE_COMPONENT_KEYS, isValidYmd, packageFromComponents, parseEmployeeFields } from "@/lib/hrm";
import { createChecklist } from "@/lib/hrm-data";
import { toMinor } from "@/lib/money";
import { nextNumber } from "@/lib/sequence";
import { packFor, requireWorkspace } from "@/lib/tenancy";

const Ymd = z.string().refine(isValidYmd, "Enter a valid date.");
const Id = z.string().regex(/^\d+$/, "Invalid selection.");
const GENDERS = ["male", "female", "other", "undisclosed"] as const;

const Personal = {
  name: z.string().min(2, "Enter the employee's name.").max(120),
  email: z.email("Enter a valid email.").toLowerCase().optional(),
  phone: z.string().max(30).optional(),
  gender: z.enum(GENDERS).default("undisclosed"),
  dob: Ymd.optional(),
  address: z.string().max(300).optional(),
};
const Job = {
  departmentId: Id.optional(),
  designation: z.string().min(2, "Enter a designation.").max(120),
  managerId: Id.optional(),
  employmentType: z.enum(schema.EMPLOYMENT_TYPES),
  workLocation: z.string().max(120).optional(),
  joinDate: Ymd,
  probationEndDate: Ymd.optional(),
};
const SECTIONS = {
  personal: z.object(Personal),
  job: z.object(Job),
  // Validated by compensationOf() against the workspace's country pack.
  compensation: z.object({}),
} as const;

function ctcOf(raw: string | undefined): { value: number } | { error: string } {
  const v = toMinor(raw);
  if (!Number.isFinite(v) || v < 0 || v > 1e13) return { error: "Enter a valid annual CTC." };
  return { value: v };
}

/** Pay + country identity/bank fields. India: annual CTC, PF, metro. UAE: monthly components → JSON, package = total × 12. */
function compensationOf(pack: CountryPack, raw: Record<string, string | undefined>) {
  const errors: Record<string, string[]> = {};
  let pay: { annualCtc: number; salaryComponents?: string | null; pfEnrolled?: boolean; metro?: boolean } = { annualCtc: 0 };
  if (pack.code === "AE") {
    const c = { basic: 0, housing: 0, transport: 0, other: 0 };
    for (const k of UAE_COMPONENT_KEYS) {
      const v = toMinor(raw[`comp_${k}`]);
      if (!Number.isFinite(v) || v < 0 || v > 1e11) errors[`comp_${k}`] = ["Enter a valid monthly amount."];
      else c[k] = v;
    }
    if (!errors.comp_basic && raw.comp_basic === undefined && Object.values(c).some((v) => v > 0)) errors.comp_basic = ["Enter the basic salary."];
    const p = packageFromComponents(c);
    pay = { annualCtc: p.annual, salaryComponents: p.json };
  } else {
    const ctc = ctcOf(raw.annualCtc);
    if ("error" in ctc) errors.annualCtc = [ctc.error];
    else pay = { annualCtc: ctc.value, pfEnrolled: raw.pfEnrolled === "on", metro: raw.metro === "on" };
  }
  const fields = parseEmployeeFields(pack.hr.employeeFields, raw);
  Object.assign(errors, fields.errors);
  return Object.keys(errors).length ? ({ errors } as const) : ({ set: { ...pay, ...fields.values } } as const);
}

/** Validates department/manager belong to this org, and the manager link can't form a loop. */
async function refErrors(orgId: number, v: { departmentId?: string; managerId?: string }, selfId?: number) {
  const errors: Record<string, string[]> = {};
  if (v.departmentId) {
    const [d] = await db
      .select({ id: schema.departments.id })
      .from(schema.departments)
      .where(and(eq(schema.departments.id, Number(v.departmentId)), eq(schema.departments.orgId, orgId)))
      .limit(1);
    if (!d) errors.departmentId = ["Department not found."];
  }
  if (v.managerId) {
    const mid = Number(v.managerId);
    if (mid === selfId) errors.managerId = ["An employee can't report to themselves."];
    else {
      const all = await db
        .select({ id: schema.employees.id, managerId: schema.employees.managerId })
        .from(schema.employees)
        .where(eq(schema.employees.orgId, orgId));
      const byId = new Map(all.map((e) => [e.id, e.managerId]));
      if (!byId.has(mid)) errors.managerId = ["Manager not found."];
      else if (selfId) {
        for (let cur: number | null | undefined = mid, i = 0; cur != null && i < all.length + 1; i++) {
          if (cur === selfId) {
            errors.managerId = ["That would create a reporting loop."];
            break;
          }
          cur = byId.get(cur);
        }
      }
    }
  }
  return errors;
}

async function memberUserByEmail(orgId: number, email: string, excludeEmployeeId?: number) {
  const [u] = await db
    .select({ id: schema.users.id })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.users.email, email)))
    .limit(1);
  if (!u) return null;
  const [taken] = await db
    .select({ id: schema.employees.id })
    .from(schema.employees)
    .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.userId, u.id)))
    .limit(1);
  return taken && taken.id !== excludeEmployeeId ? null : u.id;
}

export async function createEmployee(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const raw = formObject(fd);
  const parsed = z.object({ ...Personal, ...Job }).safeParse(raw);
  const comp = compensationOf(packFor(ws), raw);
  if (!parsed.success || "errors" in comp) {
    return { errors: { ...(parsed.success ? {} : z.flattenError(parsed.error).fieldErrors), ...("errors" in comp ? comp.errors : {}) } };
  }
  const v = parsed.data;
  if (v.probationEndDate && v.probationEndDate < v.joinDate) return { errors: { probationEndDate: ["Probation can't end before the join date."] } };
  const refs = await refErrors(orgId, v);
  if (Object.keys(refs).length) return { errors: refs };

  const userId = v.email ? await memberUserByEmail(orgId, v.email) : null;
  const code = await nextNumber(orgId, "employee");
  const [row] = await db
    .insert(schema.employees)
    .values({
      orgId,
      code,
      userId,
      name: v.name,
      email: v.email ?? null,
      phone: v.phone ?? null,
      gender: v.gender,
      dob: v.dob ?? null,
      address: v.address ?? null,
      departmentId: v.departmentId ? Number(v.departmentId) : null,
      designation: v.designation,
      managerId: v.managerId ? Number(v.managerId) : null,
      employmentType: v.employmentType,
      workLocation: v.workLocation ?? null,
      joinDate: v.joinDate,
      probationEndDate: v.probationEndDate ?? null,
      // India PF / metro HRA don't apply outside India.
      pfEnrolled: false,
      metro: false,
      ...comp.set,
    })
    .returning({ id: schema.employees.id });
  await createChecklist(orgId, row.id, "onboarding", v.joinDate);
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "employee", entityId: row.id, action: "created", summary: `Added ${v.name} (${code}) as ${v.designation}` });
  await emitEvent(ctxOf(ws), "employee.created", { id: row.id, code, name: v.name, designation: v.designation, join_date: v.joinDate });
  redirect(`/app/hrm/${row.id}`);
}

export async function updateEmployee(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const raw = formObject(fd);
  const id = Number(raw.id);
  const section = raw.section as keyof typeof SECTIONS;
  if (!SECTIONS[section]) return { message: "Unknown section." };
  const [emp] = await db.select().from(schema.employees).where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId))).limit(1);
  if (!emp) return { message: "Employee not found." };

  const parsed = (SECTIONS[section] as z.ZodType<Record<string, string | undefined>>).safeParse(raw);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data as Record<string, string | undefined>;

  if (section === "personal") {
    await db
      .update(schema.employees)
      .set({ name: v.name!, email: v.email ?? null, phone: v.phone ?? null, gender: (v.gender ?? "undisclosed") as (typeof GENDERS)[number], dob: v.dob ?? null, address: v.address ?? null })
      .where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId)));
  } else if (section === "job") {
    if (v.probationEndDate && v.probationEndDate < v.joinDate!) return { errors: { probationEndDate: ["Probation can't end before the join date."] } };
    const refs = await refErrors(orgId, v, id);
    if (Object.keys(refs).length) return { errors: refs };
    await db
      .update(schema.employees)
      .set({
        departmentId: v.departmentId ? Number(v.departmentId) : null,
        designation: v.designation!,
        managerId: v.managerId ? Number(v.managerId) : null,
        employmentType: v.employmentType as (typeof schema.EMPLOYMENT_TYPES)[number],
        workLocation: v.workLocation ?? null,
        joinDate: v.joinDate!,
        probationEndDate: v.probationEndDate ?? null,
      })
      .where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId)));
  } else {
    const comp = compensationOf(packFor(ws), raw);
    if ("errors" in comp) return { errors: comp.errors };
    await db
      .update(schema.employees)
      .set(comp.set)
      .where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId)));
  }
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "employee", entityId: id, action: "updated", summary: `Updated ${section} details for ${emp.name} (${emp.code})` });
  refresh();
  return { ok: true, message: "Saved." };
}

/** Link (or unlink with an empty value) a workspace member to an employee record. */
export async function linkUser(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const raw = formObject(fd);
  const id = Number(raw.id);
  const [emp] = await db.select().from(schema.employees).where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId))).limit(1);
  if (!emp) return { message: "Employee not found." };

  let userId: number | null = null;
  if (raw.userId) {
    userId = Number(raw.userId);
    const [m] = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)))
      .limit(1);
    if (!m) return { errors: { userId: ["That person isn't a member of this workspace."] } };
    const [taken] = await db
      .select({ id: schema.employees.id, name: schema.employees.name })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.userId, userId), ne(schema.employees.id, id)))
      .limit(1);
    if (taken) return { errors: { userId: [`Already linked to ${taken.name}.`] } };
  }
  await db.update(schema.employees).set({ userId }).where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "employee", entityId: id, action: userId ? "linked" : "unlinked", summary: `${userId ? "Linked" : "Unlinked"} user account for ${emp.name}` });
  refresh();
  return { ok: true, message: userId ? "Account linked." : "Account unlinked." };
}

async function loadEmployee(orgId: number, id: number) {
  const [emp] = await db.select().from(schema.employees).where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId))).limit(1);
  return emp;
}

export async function startNotice(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const raw = formObject(fd);
  const emp = await loadEmployee(ws.org.id, Number(raw.id));
  if (!emp) return { message: "Employee not found." };
  if (emp.status !== "active") return { message: "Only active employees can be moved to notice." };
  if (raw.exitDate && !isValidYmd(raw.exitDate)) return { errors: { exitDate: ["Enter a valid date."] } };
  if (raw.exitDate && raw.exitDate < emp.joinDate) return { errors: { exitDate: ["Last working day can't be before the join date."] } };

  await db
    .update(schema.employees)
    .set({ status: "notice", exitDate: raw.exitDate ?? null, exitReason: raw.exitReason ?? null })
    .where(and(eq(schema.employees.id, emp.id), eq(schema.employees.orgId, ws.org.id)));
  const existing = await db
    .select({ id: schema.onboardingTasks.id })
    .from(schema.onboardingTasks)
    .where(and(eq(schema.onboardingTasks.employeeId, emp.id), eq(schema.onboardingTasks.kind, "offboarding")))
    .limit(1);
  if (!existing.length) await createChecklist(ws.org.id, emp.id, "offboarding", raw.exitDate ?? addDaysYmd(todayYmd(), 28));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "employee", entityId: emp.id, action: "notice", summary: `${emp.name} moved to notice period${raw.exitDate ? ` (last day ${raw.exitDate})` : ""}` });
  refresh();
  return { ok: true, message: "Moved to notice. Offboarding checklist created." };
}

export async function markExited(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const raw = formObject(fd);
  const emp = await loadEmployee(orgId, Number(raw.id));
  if (!emp) return { message: "Employee not found." };
  if (emp.status === "exited") return { message: "Already exited." };
  const errors: Record<string, string[]> = {};
  if (!isValidYmd(raw.exitDate)) errors.exitDate = ["Enter the exit date."];
  else if (raw.exitDate < emp.joinDate) errors.exitDate = ["Exit date can't be before the join date."];
  if (!raw.exitReason) errors.exitReason = ["Give a reason for the exit."];
  if (Object.keys(errors).length) return { errors };

  await db
    .update(schema.employees)
    .set({ status: "exited", exitDate: raw.exitDate, exitReason: raw.exitReason })
    .where(and(eq(schema.employees.id, emp.id), eq(schema.employees.orgId, orgId)));
  await db
    .update(schema.leaveRequests)
    .set({ status: "cancelled", decidedBy: ws.user.id, decidedAt: new Date() })
    .where(and(eq(schema.leaveRequests.orgId, orgId), eq(schema.leaveRequests.employeeId, emp.id), eq(schema.leaveRequests.status, "pending")));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "employee", entityId: emp.id, action: "exited", summary: `${emp.name} exited on ${raw.exitDate} — ${raw.exitReason}` });
  await emitEvent(ctxOf(ws), "employee.exited", { id: emp.id, name: emp.name, exit_date: raw.exitDate });
  refresh();
  return { ok: true, message: "Marked as exited." };
}

export async function reactivate(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const emp = await loadEmployee(ws.org.id, Number(fd.get("id")));
  if (!emp || emp.status === "active") return;
  await db
    .update(schema.employees)
    .set({ status: "active", exitDate: null, exitReason: null })
    .where(and(eq(schema.employees.id, emp.id), eq(schema.employees.orgId, ws.org.id)));
  await db
    .delete(schema.onboardingTasks)
    .where(and(eq(schema.onboardingTasks.employeeId, emp.id), eq(schema.onboardingTasks.orgId, ws.org.id), eq(schema.onboardingTasks.kind, "offboarding")));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "employee", entityId: emp.id, action: "reactivated", summary: `Reactivated ${emp.name}` });
  refresh();
}

export async function toggleTask(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const done = fd.get("done") === "1";
  await db
    .update(schema.onboardingTasks)
    .set({ done })
    .where(and(eq(schema.onboardingTasks.id, Number(fd.get("id"))), eq(schema.onboardingTasks.orgId, ws.org.id)));
  refresh();
}

export async function deleteTask(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  await db.delete(schema.onboardingTasks).where(and(eq(schema.onboardingTasks.id, Number(fd.get("id"))), eq(schema.onboardingTasks.orgId, ws.org.id)));
  refresh();
}

export async function addTask(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const parsed = z
    .object({ employeeId: Id, kind: z.enum(["onboarding", "offboarding"]), title: z.string().min(2, "Enter a task.").max(200), dueDate: Ymd.optional() })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const emp = await loadEmployee(ws.org.id, Number(parsed.data.employeeId));
  if (!emp) return { message: "Employee not found." };
  await db.insert(schema.onboardingTasks).values({ orgId: ws.org.id, employeeId: emp.id, kind: parsed.data.kind, title: parsed.data.title, dueDate: parsed.data.dueDate ?? null });
  refresh();
  return { ok: true, message: "Task added." };
}

/* ───── Departments ───── */

async function headError(orgId: number, headId: string | undefined) {
  if (!headId) return null;
  const emp = await loadEmployee(orgId, Number(headId));
  return emp ? null : "Employee not found.";
}

export async function createDepartment(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const parsed = z.object({ name: z.string().min(2, "Enter a department name.").max(80), headEmployeeId: Id.optional() }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const he = await headError(ws.org.id, parsed.data.headEmployeeId);
  if (he) return { errors: { headEmployeeId: [he] } };
  const [dup] = await db.select({ id: schema.departments.id }).from(schema.departments).where(and(eq(schema.departments.orgId, ws.org.id), eq(schema.departments.name, parsed.data.name))).limit(1);
  if (dup) return { errors: { name: ["A department with this name already exists."] } };
  const [row] = await db
    .insert(schema.departments)
    .values({ orgId: ws.org.id, name: parsed.data.name, headEmployeeId: parsed.data.headEmployeeId ? Number(parsed.data.headEmployeeId) : null })
    .returning({ id: schema.departments.id });
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "department", entityId: row.id, action: "created", summary: `Created department ${parsed.data.name}` });
  refresh();
  return { ok: true, message: "Department added." };
}

export async function updateDepartment(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const parsed = z.object({ id: Id, name: z.string().min(2, "Enter a department name.").max(80), headEmployeeId: Id.optional() }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const id = Number(parsed.data.id);
  const he = await headError(ws.org.id, parsed.data.headEmployeeId);
  if (he) return { errors: { headEmployeeId: [he] } };
  const [dup] = await db
    .select({ id: schema.departments.id })
    .from(schema.departments)
    .where(and(eq(schema.departments.orgId, ws.org.id), eq(schema.departments.name, parsed.data.name), ne(schema.departments.id, id)))
    .limit(1);
  if (dup) return { errors: { name: ["A department with this name already exists."] } };
  const res = await db
    .update(schema.departments)
    .set({ name: parsed.data.name, headEmployeeId: parsed.data.headEmployeeId ? Number(parsed.data.headEmployeeId) : null })
    .where(and(eq(schema.departments.id, id), eq(schema.departments.orgId, ws.org.id)))
    .returning({ id: schema.departments.id });
  if (!res.length) return { message: "Department not found." };
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "department", entityId: id, action: "updated", summary: `Updated department ${parsed.data.name}` });
  refresh();
  return { ok: true, message: "Saved." };
}

export async function deleteDepartment(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const id = Number(fd.get("id"));
  const [dept] = await db.select().from(schema.departments).where(and(eq(schema.departments.id, id), eq(schema.departments.orgId, ws.org.id))).limit(1);
  if (!dept) return;
  await db.update(schema.employees).set({ departmentId: null }).where(and(eq(schema.employees.orgId, ws.org.id), eq(schema.employees.departmentId, id)));
  await db.delete(schema.departments).where(and(eq(schema.departments.id, id), eq(schema.departments.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "department", entityId: id, action: "deleted", summary: `Deleted department ${dept.name}` });
  refresh();
}

/* ───── Holidays ───── */

export async function addHoliday(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const parsed = z.object({ date: Ymd, name: z.string().min(2, "Enter a name.").max(100), optional: z.string().optional() }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const [dup] = await db.select({ id: schema.holidays.id }).from(schema.holidays).where(and(eq(schema.holidays.orgId, ws.org.id), eq(schema.holidays.date, parsed.data.date))).limit(1);
  if (dup) return { errors: { date: ["A holiday already exists on this date."] } };
  const [row] = await db
    .insert(schema.holidays)
    .values({ orgId: ws.org.id, date: parsed.data.date, name: parsed.data.name, optional: parsed.data.optional === "on" })
    .returning({ id: schema.holidays.id });
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "holiday", entityId: row.id, action: "created", summary: `Added holiday ${parsed.data.name} (${parsed.data.date})` });
  refresh();
  return { ok: true, message: "Holiday added." };
}

export async function deleteHoliday(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const id = Number(fd.get("id"));
  const [h] = await db.select().from(schema.holidays).where(and(eq(schema.holidays.id, id), eq(schema.holidays.orgId, ws.org.id))).limit(1);
  if (!h) return;
  await db.delete(schema.holidays).where(and(eq(schema.holidays.id, id), eq(schema.holidays.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "holiday", entityId: id, action: "deleted", summary: `Removed holiday ${h.name} (${h.date})` });
  refresh();
}
