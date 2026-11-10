"use server";

import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import { isValidYmd, isWeekend } from "@/lib/hrm";
import { holidaySet, upsertAttendance } from "@/lib/hrm-data";
import { requireWorkspace } from "@/lib/tenancy";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
type Status = (typeof schema.ATTENDANCE_STATUSES)[number];

/** Daily register: set (or clear) one employee's status and check-in/out for a date. */
export async function saveAttendance(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const employeeId = Number(fd.get("employeeId"));
  const date = String(fd.get("date") ?? "");
  const status = String(fd.get("status") ?? "");
  if (!isValidYmd(date)) return;
  const [emp] = await db
    .select({ id: schema.employees.id, name: schema.employees.name })
    .from(schema.employees)
    .where(and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, orgId)))
    .limit(1);
  if (!emp) return;

  if (!status) {
    await db
      .delete(schema.attendance)
      .where(and(eq(schema.attendance.orgId, orgId), eq(schema.attendance.employeeId, employeeId), eq(schema.attendance.date, date), isNull(schema.attendance.leaveRequestId)));
  } else if ((schema.ATTENDANCE_STATUSES as readonly string[]).includes(status)) {
    const inT = String(fd.get("checkIn") ?? "");
    const outT = String(fd.get("checkOut") ?? "");
    const checkIn = TIME.test(inT) ? inT : null;
    const checkOut = TIME.test(outT) && (!checkIn || outT >= checkIn) ? outT : null;
    await upsertAttendance(orgId, employeeId, date, { status: status as Status, checkIn, checkOut });
    await logActivity(ctxOf(ws), { module: "hrm", entityType: "attendance", entityId: employeeId, action: "marked", summary: `Marked ${emp.name} ${status.replace("_", " ")} on ${date}` });
  }
  refresh();
}

/** Marks every active/notice employee without a record that day as present (skips weekends and holidays). */
export async function markAllPresent(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const date = String(fd.get("date") ?? "");
  if (!isValidYmd(date) || isWeekend(date) || (await holidaySet(orgId, date, date)).has(date)) return;

  const [emps, marked] = await Promise.all([
    db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), notInArray(schema.employees.status, ["exited"]), sql`${schema.employees.joinDate} <= ${date}`)),
    db.select({ employeeId: schema.attendance.employeeId }).from(schema.attendance).where(and(eq(schema.attendance.orgId, orgId), eq(schema.attendance.date, date))),
  ]);
  const done = new Set(marked.map((m) => m.employeeId));
  const todo = emps.filter((e) => !done.has(e.id));
  if (todo.length) {
    await db
      .insert(schema.attendance)
      .values(todo.map((e) => ({ orgId, employeeId: e.id, date, status: "present" as const })))
      .onConflictDoNothing();
    await logActivity(ctxOf(ws), { module: "hrm", entityType: "attendance", action: "bulk_present", summary: `Marked ${todo.length} employee(s) present on ${date}` });
  }
  refresh();
}
