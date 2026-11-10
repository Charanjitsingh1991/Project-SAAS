"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { isValidYmd } from "@/lib/hrm";
import { LETTER_KIND_LABEL } from "@/lib/letters";
import { nextNumber } from "@/lib/sequence";
import { requireWorkspace } from "@/lib/tenancy";

const Fields = z.object({
  employeeId: z.string().regex(/^\d+$/, "Choose an employee."),
  kind: z.enum(schema.LETTER_KINDS),
  issuedOn: z.string().refine(isValidYmd, "Enter a valid date."),
  subject: z.string().trim().min(2, "Enter a subject.").max(200),
  body: z.string().trim().min(10, "Write the letter.").max(20000),
});

export async function issueLetter(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const parsed = Fields.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const d = parsed.data;
  const employeeId = Number(d.employeeId);
  const [emp] = await db
    .select({ id: schema.employees.id, name: schema.employees.name })
    .from(schema.employees)
    .where(and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, ws.org.id)))
    .limit(1);
  if (!emp) return { errors: { employeeId: ["Employee not found."] } };

  const number = await nextNumber(ws.org.id, "letter");
  const [row] = await db
    .insert(schema.hrLetters)
    .values({ orgId: ws.org.id, employeeId: emp.id, kind: d.kind, number, issuedOn: d.issuedOn, subject: d.subject, body: d.body, issuedBy: ws.user.id })
    .returning({ id: schema.hrLetters.id });
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "letter", entityId: row.id, action: "issued", summary: `Issued ${LETTER_KIND_LABEL[d.kind].toLowerCase()} ${number} to ${emp.name}` });
  refresh();
  redirect(`/app/hrm/letters/${row.id}`);
}
