"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { createInvite } from "@/lib/invites";
import { requireWorkspace } from "@/lib/tenancy";

/** Invite (or re-send the invite to) one employee's work email as an employee-portal user. */
export async function inviteToPortal(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return { message: "Employee not found." };
  const [emp] = await db
    .select({ id: schema.employees.id, name: schema.employees.name, email: schema.employees.email, userId: schema.employees.userId, status: schema.employees.status })
    .from(schema.employees)
    .where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, ws.org.id)))
    .limit(1);
  if (!emp) return { message: "Employee not found." };
  if (!emp.email) return { message: "Add a work email to this employee first." };
  if (emp.userId) return { message: "This employee already has portal access." };
  if (emp.status === "exited") return { message: "Exited employees can't be invited." };

  const res = await createInvite(ws, emp.email, "member");
  if (!res.ok) return { message: res.error };
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "employee", entityId: emp.id, action: "invited", summary: `Invited ${emp.name} to the employee portal` });
  refresh();
  return {
    ok: true,
    message: res.emailed ? `Invite emailed to ${res.email}.` : `Email isn't configured, so copy this link and send it to ${res.email}: ${res.url}`,
  };
}
