import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { pickRecipients } from "./approvals";
import { sendEmail } from "./email";
import { formatDate, formatMoney } from "./format";
import { appOrigin } from "./url";

/*
 * Workflow notifications (leave, attendance corrections, expense claims).
 * Every entry point swallows errors: a mail problem must never break the action that triggered it.
 */

async function safely(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`notify:${label} failed`, e);
  }
}

type Employee = typeof schema.employees.$inferSelect;

async function employeeById(orgId: number, id: number): Promise<Employee | undefined> {
  const [e] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId)))
    .limit(1);
  return e;
}

async function userEmail(userId: number | null): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return u?.email ?? null;
}

/** The employee's own address: linked login first, else the HR record email. */
async function employeeAddress(emp: Employee): Promise<string[]> {
  return pickRecipients([await userEmail(emp.userId), emp.email]).slice(0, 1);
}

/** Reporting manager if reachable, otherwise the workspace's HR/admin/owner members (capped). */
async function approverAddresses(orgId: number, emp: Employee): Promise<{ to: string[]; manager: boolean }> {
  const exclude = [await userEmail(emp.userId), emp.email];
  if (emp.managerId) {
    const mgr = await employeeById(orgId, emp.managerId);
    if (mgr) {
      const to = pickRecipients([await userEmail(mgr.userId)], exclude);
      if (to.length) return { to, manager: true };
    }
  }
  const rows = await db
    .select({ email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(and(eq(schema.memberships.orgId, orgId), inArray(schema.memberships.role, ["hr", "admin", "owner"])));
  return { to: pickRecipients(rows.map((r) => r.email), exclude), manager: false };
}

const rangeLabel = (a: string, b: string) => (a === b ? formatDate(a) : `${formatDate(a)} – ${formatDate(b)}`);

export function notifyLeaveSubmitted(orgId: number, requestId: number) {
  return safely("leave-submitted", async () => {
    const [row] = await db
      .select({ r: schema.leaveRequests, type: schema.leaveTypes.name })
      .from(schema.leaveRequests)
      .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
      .where(and(eq(schema.leaveRequests.id, requestId), eq(schema.leaveRequests.orgId, orgId)))
      .limit(1);
    if (!row) return;
    const emp = await employeeById(orgId, row.r.employeeId);
    if (!emp) return;
    const { to, manager } = await approverAddresses(orgId, emp);
    if (!to.length) return;
    const origin = await appOrigin();
    await sendEmail({
      to,
      subject: `Leave request from ${emp.name} (${rangeLabel(row.r.startDate, row.r.endDate)})`,
      paragraphs: [
        `${emp.name} has requested ${row.r.days} day(s) of ${row.type}${row.r.halfDay ? " (half day)" : ""}: ${rangeLabel(row.r.startDate, row.r.endDate)}.`,
        ...(row.r.reason ? [`Reason: ${row.r.reason}`] : []),
      ],
      action: { label: "Review request", url: `${origin}${manager ? "/app/me" : "/app/hrm/leave?status=pending"}` },
    });
  });
}

export function notifyLeaveDecided(orgId: number, requestId: number) {
  return safely("leave-decided", async () => {
    const [row] = await db
      .select({ r: schema.leaveRequests, type: schema.leaveTypes.name })
      .from(schema.leaveRequests)
      .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
      .where(and(eq(schema.leaveRequests.id, requestId), eq(schema.leaveRequests.orgId, orgId)))
      .limit(1);
    if (!row || (row.r.status !== "approved" && row.r.status !== "rejected")) return;
    const emp = await employeeById(orgId, row.r.employeeId);
    if (!emp) return;
    const to = await employeeAddress(emp);
    if (!to.length) return;
    const origin = await appOrigin();
    await sendEmail({
      to,
      subject: `Your ${row.type} request was ${row.r.status}`,
      paragraphs: [`Your ${row.type} request for ${rangeLabel(row.r.startDate, row.r.endDate)} (${row.r.days} day(s)) has been ${row.r.status}.`],
      action: { label: "Open My space", url: `${origin}/app/me` },
    });
  });
}

export function notifyRegularizationSubmitted(orgId: number, id: number) {
  return safely("regularization-submitted", async () => {
    const [r] = await db
      .select()
      .from(schema.attendanceRegularizations)
      .where(and(eq(schema.attendanceRegularizations.id, id), eq(schema.attendanceRegularizations.orgId, orgId)))
      .limit(1);
    if (!r) return;
    const emp = await employeeById(orgId, r.employeeId);
    if (!emp) return;
    const { to, manager } = await approverAddresses(orgId, emp);
    if (!to.length) return;
    const origin = await appOrigin();
    await sendEmail({
      to,
      subject: `Attendance correction from ${emp.name} (${formatDate(r.date)})`,
      paragraphs: [
        `${emp.name} asked to correct attendance for ${formatDate(r.date)} as ${r.requestedStatus.replace("_", " ")}${r.checkIn ? `, in ${r.checkIn}` : ""}${r.checkOut ? `, out ${r.checkOut}` : ""}.`,
        `Reason: ${r.reason}`,
      ],
      action: { label: "Review request", url: `${origin}${manager ? "/app/me" : "/app/hrm/attendance?view=requests"}` },
    });
  });
}

export function notifyRegularizationDecided(orgId: number, id: number) {
  return safely("regularization-decided", async () => {
    const [r] = await db
      .select()
      .from(schema.attendanceRegularizations)
      .where(and(eq(schema.attendanceRegularizations.id, id), eq(schema.attendanceRegularizations.orgId, orgId)))
      .limit(1);
    if (!r || (r.status !== "approved" && r.status !== "rejected")) return;
    const emp = await employeeById(orgId, r.employeeId);
    if (!emp) return;
    const to = await employeeAddress(emp);
    if (!to.length) return;
    const origin = await appOrigin();
    await sendEmail({
      to,
      subject: `Your attendance correction was ${r.status}`,
      paragraphs: [`Your correction for ${formatDate(r.date)} has been ${r.status}.`, ...(r.decisionNote ? [`Note: ${r.decisionNote}`] : [])],
      action: { label: "Open My space", url: `${origin}/app/me` },
    });
  });
}

export function notifyClaimDecided(orgId: number, claimId: number, currency: string) {
  return safely("claim-decided", async () => {
    const [c] = await db
      .select()
      .from(schema.expenseClaims)
      .where(and(eq(schema.expenseClaims.id, claimId), eq(schema.expenseClaims.orgId, orgId)))
      .limit(1);
    if (!c) return;
    const rejected = c.status === "rejected";
    if (!rejected && c.status !== "approved" && c.status !== "reimbursed") return;
    const emp = await employeeById(orgId, c.employeeId);
    if (!emp) return;
    const to = await employeeAddress(emp);
    if (!to.length) return;
    const origin = await appOrigin();
    await sendEmail({
      to,
      subject: `Your expense claim was ${rejected ? "rejected" : "approved"}`,
      paragraphs: [
        `Your claim “${c.description}” for ${formatMoney(c.total, currency)} was ${rejected ? "rejected" : "approved"}.`,
        ...(rejected && c.rejectionReason ? [`Reason: ${c.rejectionReason}`] : []),
        ...(!rejected ? [c.status === "reimbursed" ? "It has been reimbursed." : "It will be reimbursed in the next payroll."] : []),
      ],
      action: { label: "Open My space", url: `${origin}/app/me` },
    });
  });
}
