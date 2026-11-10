"use server";

import { and, eq, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { LEAVE_COLORS } from "@/lib/hrm";
import { authorizeDecision, decideLeave, submitLeave } from "@/lib/hrm-data";
import { notifyLeaveDecided, notifyLeaveSubmitted } from "@/lib/notify";
import { requireWorkspace } from "@/lib/tenancy";

const Id = z.string().regex(/^\d+$/, "Invalid selection.");

export async function applyLeaveForEmployee(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const parsed = z
    .object({
      employeeId: Id,
      leaveTypeId: Id,
      startDate: z.string().min(1, "Pick a start date."),
      endDate: z.string().min(1, "Pick an end date."),
      halfDay: z.string().optional(),
      reason: z.string().max(500).optional(),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const res = await submitLeave(ctxOf(ws), {
    employeeId: Number(v.employeeId),
    leaveTypeId: Number(v.leaveTypeId),
    startDate: v.startDate,
    endDate: v.endDate,
    halfDay: v.halfDay === "on",
    reason: v.reason,
  });
  if (!res.ok) return { errors: res.errors };
  await notifyLeaveSubmitted(ws.org.id, res.id);
  refresh();
  return { ok: true, message: `Request created for ${res.days} day(s). It is pending approval.` };
}

export async function decideLeaveAction(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const decision = String(fd.get("decision"));
  if (decision !== "approve" && decision !== "reject" && decision !== "cancel") return;
  const id = Number(fd.get("id"));
  if (decision !== "cancel") {
    const [req] = await db
      .select({ employeeId: schema.leaveRequests.employeeId })
      .from(schema.leaveRequests)
      .where(and(eq(schema.leaveRequests.id, id), eq(schema.leaveRequests.orgId, ws.org.id)))
      .limit(1);
    if (!req) redirect(`/app/hrm/leave?error=${encodeURIComponent("Request not found.")}`);
    const auth = await authorizeDecision(ws.org.id, ws.user, true, req.employeeId);
    if (!auth.ok) redirect(`/app/hrm/leave?error=${encodeURIComponent(auth.message)}`);
  }
  const res = await decideLeave(ctxOf(ws), ws.org.automations, id, decision);
  if (!res.ok) redirect(`/app/hrm/leave?error=${encodeURIComponent(res.message)}`);
  if (decision !== "cancel") await notifyLeaveDecided(ws.org.id, id);
  refresh();
}

export async function saveLeaveType(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const parsed = z
    .object({
      id: Id.optional(),
      name: z.string().min(2, "Enter a name.").max(60),
      code: z.string().trim().toUpperCase().min(1, "Enter a short code.").max(6),
      annualQuota: z.string().refine((s) => Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 366, "Quota must be 0–366 days."),
      color: z.enum(LEAVE_COLORS),
      paid: z.string().optional(),
      active: z.string().optional(),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const id = v.id ? Number(v.id) : null;
  const [dup] = await db
    .select({ id: schema.leaveTypes.id })
    .from(schema.leaveTypes)
    .where(and(eq(schema.leaveTypes.orgId, orgId), eq(schema.leaveTypes.code, v.code), id ? ne(schema.leaveTypes.id, id) : undefined))
    .limit(1);
  if (dup) return { errors: { code: ["This code is already used."] } };
  const values = { name: v.name, code: v.code, annualQuota: Number(v.annualQuota), color: v.color, paid: v.paid === "on", active: id ? v.active === "on" : true };
  if (id) {
    const res = await db.update(schema.leaveTypes).set(values).where(and(eq(schema.leaveTypes.id, id), eq(schema.leaveTypes.orgId, orgId))).returning({ id: schema.leaveTypes.id });
    if (!res.length) return { message: "Leave type not found." };
  } else {
    await db.insert(schema.leaveTypes).values({ ...values, orgId });
  }
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "leave_type", entityId: id, action: id ? "updated" : "created", summary: `${id ? "Updated" : "Created"} leave type ${v.name}` });
  refresh();
  return { ok: true, message: id ? "Saved." : "Leave type added." };
}
