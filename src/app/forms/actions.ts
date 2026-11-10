"use server";

import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { STAGE_PROBABILITY } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { emitEvent } from "@/lib/integrations/events";
import type { FormState } from "@/lib/definitions";
import { formObject, todayYmd } from "@/lib/format";
import { DUPLICATE_WINDOW_MS, isBot, leadDealTitle, ORG_SUBMISSIONS_PER_WINDOW, WebLeadSchema } from "@/lib/webforms";
import { webFormOrg } from "./data";

const THANKS = "Thanks! We've received your details and will be in touch shortly.";

/** Public web-to-lead submission: contact (deduped by email) + lead-stage deal + follow-up task. */
export async function submitWebLead(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = WebLeadSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };
  const lead = parsed.data;
  if (isBot(lead)) return { ok: true, message: THANKS };

  const org = await webFormOrg(lead.slug);
  if (!org) return { message: "This form is no longer accepting submissions." };
  const orgId = org.id;
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.deals)
    .where(and(eq(schema.deals.orgId, orgId), eq(schema.deals.source, "website"), gte(schema.deals.createdAt, since)));
  if (Number(n) >= ORG_SUBMISSIONS_PER_WINDOW) return { message: "We're receiving a lot of submissions right now. Please try again in a minute." };

  let [contact] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.email, lead.email)))
    .limit(1);
  if (contact) {
    const [recent] = await db
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(and(eq(schema.deals.orgId, orgId), eq(schema.deals.contactId, contact.id), eq(schema.deals.source, "website"), gte(schema.deals.createdAt, since)))
      .limit(1);
    if (recent) return { message: "You've just sent this form. Please wait a minute before sending again." };
  }

  let companyId = contact?.companyId ?? null;
  if (!companyId && lead.company) {
    const [existing] = await db
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(and(eq(schema.companies.orgId, orgId), sql`lower(${schema.companies.name}) = ${lead.company.toLowerCase()}`))
      .limit(1);
    companyId =
      existing?.id ??
      (await db.insert(schema.companies).values({ orgId, name: lead.company, ownerId: org.ownerId, country: org.pack.name }).returning({ id: schema.companies.id }))[0].id;
  }

  if (!contact) {
    [contact] = await db
      .insert(schema.contacts)
      .values({ orgId, name: lead.name, email: lead.email, phone: lead.phone ?? null, companyId, ownerId: org.ownerId, lifecycle: "lead", source: "website" })
      .returning();
  } else if ((!contact.phone && lead.phone) || (!contact.companyId && companyId)) {
    await db
      .update(schema.contacts)
      .set({ phone: contact.phone ?? lead.phone ?? null, companyId: contact.companyId ?? companyId })
      .where(and(eq(schema.contacts.id, contact.id), eq(schema.contacts.orgId, orgId)));
  }

  const [deal] = await db
    .insert(schema.deals)
    .values({ orgId, title: leadDealTitle(lead), companyId, contactId: contact.id, ownerId: org.ownerId, value: 0, stage: "lead", probability: STAGE_PROBABILITY.lead, source: "website" })
    .returning({ id: schema.deals.id });

  await db.insert(schema.crmActivities).values({
    orgId,
    dealId: deal.id,
    contactId: contact.id,
    companyId,
    type: "task",
    subject: `Follow up web enquiry from ${lead.name}`,
    body: [lead.message, lead.phone ? `Phone: ${lead.phone}` : null, `Email: ${lead.email}`].filter(Boolean).join("\n"),
    dueDate: todayYmd(),
    ownerId: org.ownerId,
    done: false,
  });

  await logActivity(
    { orgId, userId: null },
    { module: "crm", entityType: "deal", entityId: deal.id, action: "web_form", summary: `New web form lead from ${lead.name}${lead.company ? ` (${lead.company})` : ""}` },
  );
  await emitEvent({ orgId, userId: null }, "lead.captured", { id: contact.id, contact_id: contact.id, deal_id: deal.id, name: lead.name, email: lead.email, company: lead.company ?? null, source: "website" });
  return { ok: true, message: THANKS };
}
