"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

const EmployeeSchema = z.object({
  name: z.string().min(2, "Enter a name."),
  email: z.email("Invalid email.").optional(),
  department: z.string().min(1, "Required."),
  designation: z.string().min(1, "Required."),
  joinDate: date,
  monthlySalary: z.coerce.number().int().min(0, "Must be 0 or more."),
});

export async function createEmployee(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const parsed = EmployeeSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };
  await db.insert(schema.employees).values({ ...parsed.data, orgId: ws.org.id });
  refresh();
  return { ok: true, message: `${parsed.data.name} added.` };
}

export async function setEmployeeStatus(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const status = z.enum(["active", "inactive"]).parse(fd.get("status"));
  await db
    .update(schema.employees)
    .set({ status })
    .where(and(eq(schema.employees.id, Number(fd.get("id"))), eq(schema.employees.orgId, ws.org.id)));
  refresh();
}

const LeaveSchema = z
  .object({
    employeeId: z.coerce.number().int().positive("Choose an employee."),
    type: z.enum(["casual", "sick", "earned", "unpaid"]),
    startDate: date,
    endDate: date,
    reason: z.string().max(300).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "End must be on or after start." });

export async function createLeave(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const parsed = LeaveSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };

  // Employee must belong to this workspace.
  const [emp] = await db
    .select({ id: schema.employees.id })
    .from(schema.employees)
    .where(and(eq(schema.employees.id, parsed.data.employeeId), eq(schema.employees.orgId, ws.org.id)))
    .limit(1);
  if (!emp) return { errors: { employeeId: ["Choose an employee."] } };

  await db.insert(schema.leaveRequests).values({ ...parsed.data, orgId: ws.org.id });
  refresh();
  return { ok: true, message: "Leave request logged." };
}

export async function setLeaveStatus(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const status = z.enum(["pending", "approved", "rejected"]).parse(fd.get("status"));
  await db
    .update(schema.leaveRequests)
    .set({ status })
    .where(and(eq(schema.leaveRequests.id, Number(fd.get("id"))), eq(schema.leaveRequests.orgId, ws.org.id)));
  refresh();
}
