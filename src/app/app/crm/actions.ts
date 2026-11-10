"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEAL_STAGES } from "@/db/schema";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";

const DealSchema = z.object({
  title: z.string().min(2, "Enter a title."),
  contactId: z.coerce.number().int().positive().optional(),
  value: z.coerce.number().int().min(0, "Must be 0 or more."),
  stage: z.enum(DEAL_STAGES),
  expectedClose: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").optional(),
});

export async function createDeal(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const parsed = DealSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };

  if (parsed.data.contactId) {
    const [c] = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, parsed.data.contactId), eq(schema.contacts.orgId, ws.org.id)))
      .limit(1);
    if (!c) return { errors: { contactId: ["Choose a contact."] } };
  }

  await db.insert(schema.deals).values({ ...parsed.data, orgId: ws.org.id });
  refresh();
  return { ok: true, message: `${parsed.data.title} added.` };
}

export async function setDealStage(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const stage = z.enum(DEAL_STAGES).parse(fd.get("stage"));
  await db
    .update(schema.deals)
    .set({ stage })
    .where(and(eq(schema.deals.id, Number(fd.get("id"))), eq(schema.deals.orgId, ws.org.id)));
  refresh();
}

export async function deleteDeal(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  await db.delete(schema.deals).where(and(eq(schema.deals.id, Number(fd.get("id"))), eq(schema.deals.orgId, ws.org.id)));
  refresh();
}

const ContactSchema = z.object({
  name: z.string().min(2, "Enter a name."),
  company: z.string().max(120).optional(),
  email: z.email("Invalid email.").optional(),
  phone: z.string().max(40).optional(),
});

export async function createContact(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const parsed = ContactSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };
  await db.insert(schema.contacts).values({ ...parsed.data, orgId: ws.org.id });
  refresh();
  return { ok: true, message: `${parsed.data.name} added.` };
}

export async function deleteContact(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  await db.delete(schema.contacts).where(and(eq(schema.contacts.id, Number(fd.get("id"))), eq(schema.contacts.orgId, ws.org.id)));
  refresh();
}
