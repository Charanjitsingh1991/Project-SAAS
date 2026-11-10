import "server-only";
import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity, type Ctx } from "./activity";
import { parseAutomations } from "./automations";
import { weekendOf } from "./countries";
import { addDaysYmd, formatDate } from "./format";
import { ONBOARDING_TEMPLATE, OFFBOARDING_TEMPLATE, countLeaveDays, isValidYmd, leaveBalance, workingDates } from "./hrm";

export async function holidaySet(orgId: number, from: string, to: string) {
  const rows = await db
    .select({ date: schema.holidays.date })
    .from(schema.holidays)
    .where(and(eq(schema.holidays.orgId, orgId), eq(schema.holidays.optional, false), gte(schema.holidays.date, from), lte(schema.holidays.date, to)));
  return new Set(rows.map((r) => r.date));
}

/** Workspace weekend days (country default or owner override). */
export async function orgWeekend(orgId: number) {
  const [o] = await db.select({ weekendDays: schema.organizations.weekendDays, country: schema.organizations.country }).from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  return weekendOf(o ?? {});
}

/** Balances per active leave type for a calendar year (approved days used, pending shown separately). */
export async function leaveBalances(orgId: number, employeeId: number, year: number) {
  const [types, reqs] = await Promise.all([
    db.select().from(schema.leaveTypes).where(and(eq(schema.leaveTypes.orgId, orgId), eq(schema.leaveTypes.active, true))).orderBy(asc(schema.leaveTypes.id)),
    db
      .select({ typeId: schema.leaveRequests.leaveTypeId, status: schema.leaveRequests.status, days: schema.leaveRequests.days })
      .from(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.orgId, orgId),
          eq(schema.leaveRequests.employeeId, employeeId),
          inArray(schema.leaveRequests.status, ["approved", "pending"]),
          gte(schema.leaveRequests.startDate, `${year}-01-01`),
          lte(schema.leaveRequests.startDate, `${year}-12-31`),
        ),
      ),
  ]);
  return types.map((t) => {
    const approved = reqs.filter((r) => r.typeId === t.id && r.status === "approved").reduce((a, r) => a + r.days, 0);
    const pending = reqs.filter((r) => r.typeId === t.id && r.status === "pending").reduce((a, r) => a + r.days, 0);
    return { type: t, ...leaveBalance(t.annualQuota, approved, pending) };
  });
}

export type LeaveInput = {
  employeeId: number;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  reason?: string;
};
export type LeaveResult = { ok: true; id: number; days: number } | { ok: false; errors: Record<string, string[]> };

const fail = (field: string, msg: string): LeaveResult => ({ ok: false, errors: { [field]: [msg] } });

/** Shared validation + insert for HR and self-service leave requests. */
export async function submitLeave(ctx: Ctx, input: LeaveInput): Promise<LeaveResult> {
  const { orgId } = ctx;
  const { employeeId, leaveTypeId, startDate, endDate, halfDay } = input;
  if (!isValidYmd(startDate)) return fail("startDate", "Enter a valid start date.");
  if (!isValidYmd(endDate)) return fail("endDate", "Enter a valid end date.");
  if (endDate < startDate) return fail("endDate", "End date can't be before the start date.");
  if (halfDay && startDate !== endDate) return fail("halfDay", "A half-day request must be for a single date.");
  if (daysSpan(startDate, endDate) > 366) return fail("endDate", "A single request can't span more than a year.");

  const [emp] = await db
    .select({ id: schema.employees.id, status: schema.employees.status, name: schema.employees.name })
    .from(schema.employees)
    .where(and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, orgId)))
    .limit(1);
  if (!emp) return fail("employeeId", "Employee not found.");
  if (emp.status === "exited") return fail("employeeId", "This employee has exited.");

  const [type] = await db
    .select()
    .from(schema.leaveTypes)
    .where(and(eq(schema.leaveTypes.id, leaveTypeId), eq(schema.leaveTypes.orgId, orgId)))
    .limit(1);
  if (!type || !type.active) return fail("leaveTypeId", "Pick an active leave type.");

  const holidays = await holidaySet(orgId, startDate, endDate);
  const days = countLeaveDays(startDate, endDate, halfDay, holidays, await orgWeekend(orgId));
  if (days <= 0) return fail("startDate", "No working days in this range (weekends and holidays are skipped).");

  const [clash] = await db
    .select({ id: schema.leaveRequests.id, s: schema.leaveRequests.startDate, e: schema.leaveRequests.endDate })
    .from(schema.leaveRequests)
    .where(
      and(
        eq(schema.leaveRequests.orgId, orgId),
        eq(schema.leaveRequests.employeeId, employeeId),
        inArray(schema.leaveRequests.status, ["pending", "approved"]),
        lte(schema.leaveRequests.startDate, endDate),
        gte(schema.leaveRequests.endDate, startDate),
      ),
    )
    .limit(1);
  if (clash) return fail("startDate", `Overlaps an existing leave request (${formatDate(clash.s)} – ${formatDate(clash.e)}).`);

  if (type.paid) {
    const year = Number(startDate.slice(0, 4));
    const bal = (await leaveBalances(orgId, employeeId, year)).find((b) => b.type.id === type.id);
    const available = bal?.available ?? type.annualQuota;
    if (days > available) {
      return fail("leaveTypeId", `Not enough ${type.name} balance: ${Math.max(0, available)} day(s) available, ${days} requested.`);
    }
  }

  const [row] = await db
    .insert(schema.leaveRequests)
    .values({ orgId, employeeId, leaveTypeId, startDate, endDate, halfDay, days, reason: input.reason ?? null })
    .returning({ id: schema.leaveRequests.id });
  await logActivity(ctx, {
    module: "hrm",
    entityType: "leave_request",
    entityId: row.id,
    action: "applied",
    summary: `${emp.name} applied for ${days} day(s) of ${type.name} (${formatDate(startDate)}${endDate !== startDate ? ` – ${formatDate(endDate)}` : ""})`,
  });
  return { ok: true, id: row.id, days };
}

function daysSpan(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

export type DecideResult = { ok: true } | { ok: false; message: string };

/** approve / reject / cancel with attendance side-effects. `self` restricts cancel to pending requests. */
export async function decideLeave(
  ctx: Ctx,
  orgAutomations: string | null,
  requestId: number,
  action: "approve" | "reject" | "cancel",
  opts: { onlyEmployeeId?: number } = {},
): Promise<DecideResult> {
  const { orgId } = ctx;
  const [req] = await db
    .select()
    .from(schema.leaveRequests)
    .where(and(eq(schema.leaveRequests.id, requestId), eq(schema.leaveRequests.orgId, orgId)))
    .limit(1);
  if (!req || (opts.onlyEmployeeId !== undefined && req.employeeId !== opts.onlyEmployeeId)) return { ok: false, message: "Request not found." };
  const [[emp], [type]] = await Promise.all([
    db.select({ name: schema.employees.name }).from(schema.employees).where(eq(schema.employees.id, req.employeeId)).limit(1),
    db.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.id, req.leaveTypeId)).limit(1),
  ]);

  if (action === "approve") {
    if (req.status !== "pending") return { ok: false, message: "Only pending requests can be approved." };
    if (type?.paid) {
      const year = Number(req.startDate.slice(0, 4));
      const bal = (await leaveBalances(orgId, req.employeeId, year)).find((b) => b.type.id === type.id);
      if (bal && req.days > bal.balance) return { ok: false, message: `${emp?.name ?? "Employee"} has only ${Math.max(0, bal.balance)} day(s) of ${type.name} left.` };
    }
    await db
      .update(schema.leaveRequests)
      .set({ status: "approved", decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(eq(schema.leaveRequests.id, req.id), eq(schema.leaveRequests.orgId, orgId)));
    if (parseAutomations(orgAutomations).leaveToAttendance) {
      const holidays = await holidaySet(orgId, req.startDate, req.endDate);
      const dates = workingDates(req.startDate, req.endDate, holidays, await orgWeekend(orgId));
      for (const date of dates) {
        const values = {
          orgId,
          employeeId: req.employeeId,
          date,
          status: "leave" as const,
          checkIn: null,
          checkOut: null,
          note: req.halfDay ? `${type?.name ?? "Leave"} (half day)` : (type?.name ?? "Leave"),
          leaveRequestId: req.id,
        };
        await db
          .insert(schema.attendance)
          .values(values)
          .onConflictDoUpdate({ target: [schema.attendance.employeeId, schema.attendance.date], set: values });
      }
    }
  } else {
    if (action === "cancel" && !["pending", "approved"].includes(req.status)) return { ok: false, message: "This request can't be cancelled." };
    if (action === "reject" && !["pending", "approved"].includes(req.status)) return { ok: false, message: "This request has already been closed." };
    if (opts.onlyEmployeeId !== undefined && req.status !== "pending") return { ok: false, message: "Only pending requests can be cancelled from My space." };
    await db
      .update(schema.leaveRequests)
      .set({ status: action === "reject" ? "rejected" : "cancelled", decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(eq(schema.leaveRequests.id, req.id), eq(schema.leaveRequests.orgId, orgId)));
    await db
      .delete(schema.attendance)
      .where(and(eq(schema.attendance.orgId, orgId), eq(schema.attendance.leaveRequestId, req.id)));
  }

  await logActivity(ctx, {
    module: "hrm",
    entityType: "leave_request",
    entityId: req.id,
    action: action === "approve" ? "approved" : action === "reject" ? "rejected" : "cancelled",
    summary: `${action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Cancelled"} ${emp?.name ?? "employee"}'s ${req.days} day(s) of ${type?.name ?? "leave"} (${formatDate(req.startDate)})`,
  });
  return { ok: true };
}

export async function createChecklist(orgId: number, employeeId: number, kind: "onboarding" | "offboarding", anchor: string) {
  const template = kind === "onboarding" ? ONBOARDING_TEMPLATE : OFFBOARDING_TEMPLATE;
  await db
    .insert(schema.onboardingTasks)
    .values(template.map((t) => ({ orgId, employeeId, kind, title: t.title, dueDate: addDaysYmd(anchor, t.offset) })));
}

/** Employee linked to the signed-in user; auto-links by matching email when HR hasn't linked one yet. */
export async function resolveMyEmployee(orgId: number, user: { id: number; email: string }) {
  const [mine] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.userId, user.id)))
    .limit(1);
  if (mine) return mine;
  const [match] = await db
    .select()
    .from(schema.employees)
    .where(
      and(
        eq(schema.employees.orgId, orgId),
        sql`lower(${schema.employees.email}) = ${user.email.toLowerCase()}`,
        sql`${schema.employees.userId} is null`,
        ne(schema.employees.status, "exited"),
      ),
    )
    .limit(1);
  if (!match) return null;
  await db.update(schema.employees).set({ userId: user.id }).where(and(eq(schema.employees.id, match.id), eq(schema.employees.orgId, orgId)));
  return { ...match, userId: user.id };
}

export async function upsertAttendance(
  orgId: number,
  employeeId: number,
  date: string,
  v: { status: (typeof schema.ATTENDANCE_STATUSES)[number]; checkIn?: string | null; checkOut?: string | null; note?: string | null },
) {
  const values = { orgId, employeeId, date, status: v.status, checkIn: v.checkIn ?? null, checkOut: v.checkOut ?? null, note: v.note ?? null, leaveRequestId: null };
  await db
    .insert(schema.attendance)
    .values(values)
    .onConflictDoUpdate({ target: [schema.attendance.employeeId, schema.attendance.date], set: values });
}

/** Unpaid-leave day weight per attendance row id → 1 (or 0.5 for half-day) when the linked type is unpaid. */
export async function unpaidLeaveByRequest(orgId: number) {
  const rows = await db
    .select({ id: schema.leaveRequests.id, half: schema.leaveRequests.halfDay })
    .from(schema.leaveRequests)
    .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
    .where(and(eq(schema.leaveRequests.orgId, orgId), eq(schema.leaveTypes.paid, false)));
  return new Map(rows.map((r) => [r.id, r.half ? 0.5 : 1]));
}

