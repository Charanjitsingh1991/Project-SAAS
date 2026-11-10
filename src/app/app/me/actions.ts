"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { parseClaim, submitClaim, withdrawClaim } from "@/lib/claims";
import { formatMoney, formObject, todayYmd } from "@/lib/format";
import { hhmm } from "@/lib/hrm";
import { authorizeDecision, decideLeave, decideRegularization, resolveMyEmployee, submitLeave, submitRegularization, upsertAttendance } from "@/lib/hrm-data";
import { notifyLeaveDecided, notifyLeaveSubmitted, notifyRegularizationDecided, notifyRegularizationSubmitted } from "@/lib/notify";
import { canUseModule, packFor, planModules, requireWorkspace } from "@/lib/tenancy";
import { redirect } from "next/navigation";

async function me() {
  const ws = await requireWorkspace();
  const emp = await resolveMyEmployee(ws.org.id, ws.user);
  return { ws, emp: emp && emp.status !== "exited" ? emp : null };
}

/** Workspace timezone (Asia/Kolkata, Asia/Dubai, …) so check-in times match the office clock. */
const tz = (ws: { org: { timezone: string } }) => ws.org.timezone || process.env.APP_TIMEZONE || "Asia/Kolkata";

export async function checkIn(_: FormState, fd: FormData): Promise<FormState> {
  const { ws, emp } = await me();
  if (!emp) return { message: "Your profile isn't linked to an active employee record." };
  const date = todayYmd();
  const [row] = await db
    .select()
    .from(schema.attendance)
    .where(and(eq(schema.attendance.orgId, ws.org.id), eq(schema.attendance.employeeId, emp.id), eq(schema.attendance.date, date)))
    .limit(1);
  if (row?.status === "leave") return { message: "You're on approved leave today." };
  if (row?.checkIn) return { message: `Already checked in at ${row.checkIn}.` };
  const time = hhmm(new Date(), tz(ws));
  await upsertAttendance(ws.org.id, emp.id, date, { status: fd.get("mode") === "wfh" ? "wfh" : "present", checkIn: time, note: row?.note });
  refresh();
  return { ok: true, message: `Checked in at ${time}.` };
}

export async function checkOut(): Promise<FormState> {
  const { ws, emp } = await me();
  if (!emp) return { message: "Your profile isn't linked to an active employee record." };
  const date = todayYmd();
  const [row] = await db
    .select()
    .from(schema.attendance)
    .where(and(eq(schema.attendance.orgId, ws.org.id), eq(schema.attendance.employeeId, emp.id), eq(schema.attendance.date, date)))
    .limit(1);
  if (!row?.checkIn) return { message: "Check in first." };
  if (row.checkOut) return { message: `Already checked out at ${row.checkOut}.` };
  const time = hhmm(new Date(), tz(ws));
  if (time < row.checkIn) return { message: "Check-out can't be earlier than check-in." };
  await db
    .update(schema.attendance)
    .set({ checkOut: time })
    .where(and(eq(schema.attendance.id, row.id), eq(schema.attendance.orgId, ws.org.id)));
  refresh();
  return { ok: true, message: `Checked out at ${time}.` };
}

export async function applyMyLeave(_: FormState, fd: FormData): Promise<FormState> {
  const { ws, emp } = await me();
  if (!emp) return { message: "Your profile isn't linked to an active employee record." };
  const parsed = z
    .object({
      leaveTypeId: z.string().regex(/^\d+$/, "Pick a leave type."),
      startDate: z.string().min(1, "Pick a start date."),
      endDate: z.string().min(1, "Pick an end date."),
      halfDay: z.string().optional(),
      reason: z.string().max(500).optional(),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const res = await submitLeave(ctxOf(ws), {
    employeeId: emp.id,
    leaveTypeId: Number(v.leaveTypeId),
    startDate: v.startDate,
    endDate: v.endDate,
    halfDay: v.halfDay === "on",
    reason: v.reason,
  });
  if (!res.ok) return { errors: res.errors };
  await notifyLeaveSubmitted(ws.org.id, res.id);
  refresh();
  return { ok: true, message: `Request submitted for ${res.days} day(s). Your manager or HR will review it.` };
}

/** Claims need the HRM module on the plan (any role may submit their own). */
async function claimant() {
  const ws = await requireWorkspace({ feature: "expenseClaims" });
  if (!planModules(ws).includes("hrm")) return { ws, emp: null, error: "Expense claims need the HRM module." };
  const emp = await resolveMyEmployee(ws.org.id, ws.user);
  if (!emp || emp.userId !== ws.user.id || emp.status === "exited") return { ws, emp: null, error: "Your login isn't linked to an active employee record. Ask HR to link it." };
  return { ws, emp, error: null };
}

export async function submitMyClaim(_: FormState, fd: FormData): Promise<FormState> {
  const { ws, emp, error } = await claimant();
  if (!emp) return { message: error };
  const res = parseClaim(formObject(fd), packFor(ws), planModules(ws).includes("payroll"), todayYmd());
  if ("errors" in res) return { errors: res.errors };
  await submitClaim(ctxOf(ws), emp, res.claim, ws.org.currency);
  refresh();
  return { ok: true, message: `Claim for ${formatMoney(res.claim.total, ws.org.currency)} submitted for approval.` };
}

export async function withdrawMyClaim(fd: FormData) {
  const { ws, emp } = await claimant();
  if (!emp) return;
  await withdrawClaim(ctxOf(ws), Number(fd.get("id")), emp.id);
  refresh();
}

export async function cancelMyLeave(fd: FormData) {
  const { ws, emp } = await me();
  if (!emp) return;
  await decideLeave(ctxOf(ws), ws.org.automations, Number(fd.get("id")), "cancel", { onlyEmployeeId: emp.id });
  refresh();
}

/* ───────── Attendance regularisation (employee side) ───────── */

export async function requestRegularization(_: FormState, fd: FormData): Promise<FormState> {
  const { ws, emp } = await me();
  if (!emp) return { message: "Your profile isn't linked to an active employee record." };
  const parsed = z
    .object({
      date: z.string().min(1, "Pick a date."),
      requestedStatus: z.string().min(1, "Pick a status."),
      checkIn: z.string().optional(),
      checkOut: z.string().optional(),
      reason: z.string().min(3, "Give a short reason.").max(500),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const res = await submitRegularization(ctxOf(ws), {
    employeeId: emp.id,
    date: v.date,
    requestedStatus: v.requestedStatus,
    checkIn: v.checkIn ?? "",
    checkOut: v.checkOut ?? "",
    reason: v.reason,
    today: todayYmd(),
  });
  if (!res.ok) return { errors: res.errors };
  await notifyRegularizationSubmitted(ws.org.id, res.id);
  refresh();
  return { ok: true, message: "Correction requested. Your manager or HR will review it." };
}

export async function cancelMyRegularization(fd: FormData) {
  const { ws, emp } = await me();
  if (!emp) return;
  await decideRegularization(ctxOf(ws), Number(fd.get("id")), "cancel", { onlyEmployeeId: emp.id });
  refresh();
}

/* ───────── Team approvals (reporting manager, or HRM roles) ───────── */

const back = (msg: string): never => redirect(`/app/me?error=${encodeURIComponent(msg)}`);

export async function decideTeamLeave(fd: FormData) {
  const ws = await requireWorkspace();
  const decision = String(fd.get("decision"));
  if (decision !== "approve" && decision !== "reject") return;
  const id = Number(fd.get("id"));
  const [req] = await db
    .select({ employeeId: schema.leaveRequests.employeeId, status: schema.leaveRequests.status })
    .from(schema.leaveRequests)
    .where(and(eq(schema.leaveRequests.id, id), eq(schema.leaveRequests.orgId, ws.org.id)))
    .limit(1);
  if (!req) return back("Request not found.");
  const auth = await authorizeDecision(ws.org.id, ws.user, canUseModule(ws, "hrm"), req.employeeId, req.status);
  if (!auth.ok) return back(auth.message);
  const res = await decideLeave(ctxOf(ws), ws.org.automations, id, decision);
  if (!res.ok) return back(res.message);
  await notifyLeaveDecided(ws.org.id, id);
  refresh();
}

export async function decideTeamRegularization(fd: FormData) {
  const ws = await requireWorkspace();
  const decision = String(fd.get("decision"));
  if (decision !== "approve" && decision !== "reject") return;
  const id = Number(fd.get("id"));
  const [req] = await db
    .select({ employeeId: schema.attendanceRegularizations.employeeId, status: schema.attendanceRegularizations.status })
    .from(schema.attendanceRegularizations)
    .where(and(eq(schema.attendanceRegularizations.id, id), eq(schema.attendanceRegularizations.orgId, ws.org.id)))
    .limit(1);
  if (!req) return back("Request not found.");
  const auth = await authorizeDecision(ws.org.id, ws.user, canUseModule(ws, "hrm"), req.employeeId, req.status);
  if (!auth.ok) return back(auth.message);
  const res = await decideRegularization(ctxOf(ws), id, decision, { note: String(fd.get("note") ?? "") });
  if (!res.ok) return back(res.message);
  await notifyRegularizationDecided(ws.org.id, id);
  refresh();
}
