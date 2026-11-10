"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { ACTIVITY_TYPES, DEAL_STAGES, LEAD_SOURCES, LIFECYCLES, STAGE_PROBABILITY, type DealStage } from "@/db/schema";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { formObject, toMinor } from "@/lib/format";
import { onDealWon } from "@/lib/posting";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { normalizeTaxId, taxIdError } from "./_components/tax-id";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");
const optId = z.coerce.number().int().positive().optional();
const fail = (e: z.ZodError): FormState => ({ errors: z.flattenError(e).fieldErrors, message: "Please fix the highlighted fields." });

type Ws = Awaited<ReturnType<typeof requireWorkspace>>;

/** Foreign IDs must belong to the caller's organisation. */
async function checkRefs(ws: Ws, refs: { companyId?: number; contactId?: number; ownerId?: number }) {
  const orgId = ws.org.id;
  const errors: Record<string, string[]> = {};
  if (refs.companyId) {
    const [r] = await db.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.id, refs.companyId), eq(schema.companies.orgId, orgId))).limit(1);
    if (!r) errors.companyId = ["Choose a valid company."];
  }
  if (refs.contactId) {
    const [r] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(and(eq(schema.contacts.id, refs.contactId), eq(schema.contacts.orgId, orgId))).limit(1);
    if (!r) errors.contactId = ["Choose a valid contact."];
  }
  if (refs.ownerId) {
    const [r] = await db.select({ id: schema.memberships.id }).from(schema.memberships).where(and(eq(schema.memberships.userId, refs.ownerId), eq(schema.memberships.orgId, orgId))).limit(1);
    if (!r) errors.ownerId = ["Choose a team member."];
  }
  return Object.keys(errors).length ? errors : null;
}

async function loadDeal(orgId: number, id: number) {
  const [d] = await db.select().from(schema.deals).where(and(eq(schema.deals.id, id), eq(schema.deals.orgId, orgId))).limit(1);
  return d;
}

/**
 * Single stage-transition path (board, deal page, edit form).
 * Resets probability, stamps stageChangedAt, sets/clears closedAt, logs, runs won automations.
 * Moving to "lost" without a reason keeps any existing reason, else stores "Not specified"
 * (the deal page flags it and lets the user edit it).
 */
async function changeStage(ws: Ws, dealId: number, stage: DealStage, lostReason?: string) {
  const deal = await loadDeal(ws.org.id, dealId);
  if (!deal || deal.stage === stage) return deal;
  const closing = stage === "won" || stage === "lost";
  await db
    .update(schema.deals)
    .set({
      stage,
      probability: STAGE_PROBABILITY[stage],
      stageChangedAt: new Date(),
      closedAt: closing ? new Date() : null,
      lostReason: stage === "lost" ? lostReason || (deal.lostReason && deal.lostReason !== "Not specified" ? deal.lostReason : "Not specified") : null,
    })
    .where(and(eq(schema.deals.id, deal.id), eq(schema.deals.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), {
    module: "crm",
    entityType: "deal",
    entityId: deal.id,
    action: "stage_changed",
    summary: `Moved ${deal.title} from ${deal.stage} to ${stage}${stage === "lost" && lostReason ? ` (${lostReason})` : ""}`,
  });
  if (stage === "won") await onDealWon(ctxOf(ws), deal.id);
  return deal;
}

/* ───────────── Deals ───────────── */

const DealSchema = z.object({
  title: z.string().trim().min(2, "Enter a title.").max(160),
  value: z.string().optional(),
  companyId: optId,
  contactId: optId,
  ownerId: optId,
  source: z.enum(LEAD_SOURCES),
  expectedClose: ymd.optional(),
  stage: z.enum(DEAL_STAGES),
  probability: z.coerce.number().int().min(0, "0–100").max(100, "0–100").optional(),
  lostReason: z.string().trim().max(300).optional(),
});

export async function createDeal(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const parsed = DealSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  const value = toMinor(d.value);
  if (!Number.isFinite(value) || value < 0) return { errors: { value: ["Enter a valid amount."] } };
  if (d.stage === "lost" && !d.lostReason) return { errors: { lostReason: ["A lost reason is required."] } };
  const bad = await checkRefs(ws, d);
  if (bad) return { errors: bad };

  const closing = d.stage === "won" || d.stage === "lost";
  const [row] = await db
    .insert(schema.deals)
    .values({
      orgId: ws.org.id,
      title: d.title,
      value,
      companyId: d.companyId ?? null,
      contactId: d.contactId ?? null,
      ownerId: d.ownerId ?? ws.user.id,
      source: d.source,
      expectedClose: d.expectedClose ?? null,
      stage: d.stage,
      probability: d.probability ?? STAGE_PROBABILITY[d.stage],
      closedAt: closing ? new Date() : null,
      lostReason: d.stage === "lost" ? d.lostReason : null,
    })
    .returning({ id: schema.deals.id });
  await logActivity(ctxOf(ws), { module: "crm", entityType: "deal", entityId: row.id, action: "created", summary: `Created deal ${d.title} in ${d.stage}` });
  if (d.stage === "won") await onDealWon(ctxOf(ws), row.id);
  refresh();
  return { ok: true, message: `${d.title} added.` };
}

export async function updateDeal(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const raw = formObject(fd);
  const id = Number(raw.id);
  const parsed = DealSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  const deal = Number.isInteger(id) ? await loadDeal(ws.org.id, id) : undefined;
  if (!deal) return { message: "Deal not found." };
  const value = toMinor(d.value);
  if (!Number.isFinite(value) || value < 0) return { errors: { value: ["Enter a valid amount."] } };
  if (d.stage === "lost" && !d.lostReason && (!deal.lostReason || deal.lostReason === "Not specified")) {
    return { errors: { lostReason: ["A lost reason is required."] } };
  }
  const bad = await checkRefs(ws, d);
  if (bad) return { errors: bad };

  const where = and(eq(schema.deals.id, deal.id), eq(schema.deals.orgId, ws.org.id));
  // Fields first so won-automations see the final value/company/contact, then the transition, then the probability override.
  await db
    .update(schema.deals)
    .set({
      title: d.title,
      value,
      companyId: d.companyId ?? null,
      contactId: d.contactId ?? null,
      ownerId: d.ownerId ?? null,
      source: d.source,
      expectedClose: d.expectedClose ?? null,
    })
    .where(where);
  await changeStage(ws, deal.id, d.stage, d.lostReason);
  await db
    .update(schema.deals)
    .set({
      probability: d.probability ?? STAGE_PROBABILITY[d.stage],
      lostReason: d.stage === "lost" ? d.lostReason || deal.lostReason || "Not specified" : null,
    })
    .where(where);
  await logActivity(ctxOf(ws), { module: "crm", entityType: "deal", entityId: deal.id, action: "updated", summary: `Updated deal ${d.title}` });
  refresh();
  return { ok: true, message: "Deal saved." };
}

/** Board drag / StatusSelect: `id` + `stage`. */
export async function moveDeal(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const id = Number(fd.get("id"));
  const stage = z.enum(DEAL_STAGES).safeParse(fd.get("stage"));
  if (!Number.isInteger(id) || !stage.success) return;
  await changeStage(ws, id, stage.data);
  refresh();
}

/** Deal-page stage buttons; the Lost button carries a required reason. */
export async function setDealStage(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const id = Number(fd.get("id"));
  const stage = z.enum(DEAL_STAGES).safeParse(fd.get("stage"));
  if (!Number.isInteger(id) || !stage.success) return;
  const reason = String(fd.get("lostReason") ?? "").trim().slice(0, 300);
  if (stage.data === "lost" && !reason) return;
  await changeStage(ws, id, stage.data, reason || undefined);
  refresh();
}

export async function deleteDeal(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const deal = await loadDeal(ws.org.id, Number(fd.get("id")));
  if (!deal) return;
  await db.delete(schema.crmActivities).where(and(eq(schema.crmActivities.dealId, deal.id), eq(schema.crmActivities.orgId, ws.org.id)));
  await db.delete(schema.deals).where(and(eq(schema.deals.id, deal.id), eq(schema.deals.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "crm", entityType: "deal", entityId: deal.id, action: "deleted", summary: `Deleted deal ${deal.title}` });
  redirect("/app/crm");
}

/* ───────────── Activities ───────────── */

const ActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().trim().min(2, "Enter a subject.").max(200),
  body: z.string().trim().max(2000).optional(),
  dueDate: ymd.optional(),
  dealId: optId,
  contactId: optId,
  companyId: optId,
});

export async function addActivity(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const parsed = ActivitySchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error);
  const a = parsed.data;
  let { companyId, contactId } = a;
  const dealId = a.dealId;
  if (dealId) {
    const deal = await loadDeal(ws.org.id, dealId);
    if (!deal) return { message: "Deal not found." };
    companyId ??= deal.companyId ?? undefined;
    contactId ??= deal.contactId ?? undefined;
  }
  if (!dealId && !contactId && !companyId) return { message: "Link the activity to a deal, contact or company." };
  const bad = await checkRefs(ws, { companyId, contactId });
  if (bad) return { message: "Linked record not found." };

  const [row] = await db
    .insert(schema.crmActivities)
    .values({
      orgId: ws.org.id,
      dealId: dealId ?? null,
      contactId: contactId ?? null,
      companyId: companyId ?? null,
      type: a.type,
      subject: a.subject,
      body: a.body ?? null,
      dueDate: a.dueDate ?? null,
      ownerId: ws.user.id,
      done: a.type !== "task" && !a.dueDate,
    })
    .returning({ id: schema.crmActivities.id });
  await logActivity(ctxOf(ws), {
    module: "crm",
    entityType: dealId ? "deal" : contactId ? "contact" : "company",
    entityId: dealId ?? contactId ?? companyId,
    action: "activity_added",
    summary: `Logged ${a.type}: ${a.subject}`,
  });
  void row;
  refresh();
  return { ok: true, message: "Activity added." };
}

export async function toggleActivity(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const [a] = await db.select().from(schema.crmActivities).where(and(eq(schema.crmActivities.id, id), eq(schema.crmActivities.orgId, ws.org.id))).limit(1);
  if (!a) return;
  await db.update(schema.crmActivities).set({ done: !a.done }).where(and(eq(schema.crmActivities.id, a.id), eq(schema.crmActivities.orgId, ws.org.id)));
  refresh();
}

export async function deleteActivity(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await db.delete(schema.crmActivities).where(and(eq(schema.crmActivities.id, id), eq(schema.crmActivities.orgId, ws.org.id)));
  refresh();
}

/* ───────────── Companies ───────────── */

const CompanySchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(160),
  industry: z.string().trim().max(80).optional(),
  website: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  // Tax ID (GSTIN / TRN) is validated per workspace country in companyInput().
  gstin: z.string().max(40).transform(normalizeTaxId).optional(),
  billingAddress: z.string().trim().max(400).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  ownerId: optId,
});

/** Parse a company form and check its tax ID against the workspace country pack. */
function companyInput(ws: Ws, fd: FormData) {
  const parsed = CompanySchema.safeParse(formObject(fd));
  if (!parsed.success) return { error: fail(parsed.error) };
  const pack = packFor(ws);
  const err = taxIdError(pack, parsed.data.gstin, parsed.data.country);
  if (err) return { error: { errors: { gstin: [err] }, message: "Please fix the highlighted fields." } as FormState };
  return { data: parsed.data, pack };
}

export async function createCompany(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const parsed = companyInput(ws, fd);
  if (!parsed.data) return parsed.error;
  const bad = await checkRefs(ws, parsed.data);
  if (bad) return { errors: bad };
  const [row] = await db
    .insert(schema.companies)
    .values({ ...parsed.data, orgId: ws.org.id, ownerId: parsed.data.ownerId ?? ws.user.id, country: parsed.data.country ?? parsed.pack.name })
    .returning({ id: schema.companies.id });
  await logActivity(ctxOf(ws), { module: "crm", entityType: "company", entityId: row.id, action: "created", summary: `Added company ${parsed.data.name}` });
  refresh();
  return { ok: true, message: `${parsed.data.name} added.` };
}

export async function updateCompany(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const raw = formObject(fd);
  const id = Number(raw.id);
  const parsed = companyInput(ws, fd);
  if (!parsed.data) return parsed.error;
  const bad = await checkRefs(ws, parsed.data);
  if (bad) return { errors: bad };
  const d = parsed.data;
  const res = await db
    .update(schema.companies)
    .set({
      name: d.name,
      industry: d.industry ?? null,
      website: d.website ?? null,
      phone: d.phone ?? null,
      gstin: d.gstin ?? null,
      billingAddress: d.billingAddress ?? null,
      city: d.city ?? null,
      state: d.state ?? null,
      country: d.country ?? null,
      ownerId: d.ownerId ?? null,
    })
    .where(and(eq(schema.companies.id, id), eq(schema.companies.orgId, ws.org.id)))
    .returning({ id: schema.companies.id });
  if (!res.length) return { message: "Company not found." };
  await logActivity(ctxOf(ws), { module: "crm", entityType: "company", entityId: id, action: "updated", summary: `Updated company ${d.name}` });
  refresh();
  return { ok: true, message: "Company saved." };
}

export async function deleteCompany(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const id = Number(fd.get("id"));
  const [c] = await db.select().from(schema.companies).where(and(eq(schema.companies.id, id), eq(schema.companies.orgId, ws.org.id))).limit(1);
  if (!c) return;
  const org = ws.org.id;
  await db.update(schema.contacts).set({ companyId: null }).where(and(eq(schema.contacts.companyId, id), eq(schema.contacts.orgId, org)));
  await db.update(schema.deals).set({ companyId: null }).where(and(eq(schema.deals.companyId, id), eq(schema.deals.orgId, org)));
  await db.delete(schema.crmActivities).where(and(eq(schema.crmActivities.companyId, id), eq(schema.crmActivities.orgId, org)));
  await db.delete(schema.companies).where(and(eq(schema.companies.id, id), eq(schema.companies.orgId, org)));
  await logActivity(ctxOf(ws), { module: "crm", entityType: "company", entityId: id, action: "deleted", summary: `Deleted company ${c.name}` });
  redirect("/app/crm/companies");
}

/* ───────────── Contacts ───────────── */

const ContactSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(120),
  title: z.string().trim().max(120).optional(),
  email: z.email("Enter a valid email.").trim().toLowerCase().optional(),
  phone: z.string().trim().max(40).optional(),
  companyId: optId,
  ownerId: optId,
  lifecycle: z.enum(LIFECYCLES),
  source: z.enum(LEAD_SOURCES),
});

export async function createContact(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const parsed = ContactSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error);
  const bad = await checkRefs(ws, parsed.data);
  if (bad) return { errors: bad };
  const [row] = await db
    .insert(schema.contacts)
    .values({ ...parsed.data, orgId: ws.org.id, ownerId: parsed.data.ownerId ?? ws.user.id })
    .returning({ id: schema.contacts.id });
  await logActivity(ctxOf(ws), { module: "crm", entityType: "contact", entityId: row.id, action: "created", summary: `Added contact ${parsed.data.name}` });
  refresh();
  return { ok: true, message: `${parsed.data.name} added.` };
}

export async function updateContact(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const raw = formObject(fd);
  const id = Number(raw.id);
  const parsed = ContactSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  const bad = await checkRefs(ws, d);
  if (bad) return { errors: bad };
  const res = await db
    .update(schema.contacts)
    .set({
      name: d.name,
      title: d.title ?? null,
      email: d.email ?? null,
      phone: d.phone ?? null,
      companyId: d.companyId ?? null,
      ownerId: d.ownerId ?? null,
      lifecycle: d.lifecycle,
      source: d.source,
    })
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, ws.org.id)))
    .returning({ id: schema.contacts.id });
  if (!res.length) return { message: "Contact not found." };
  await logActivity(ctxOf(ws), { module: "crm", entityType: "contact", entityId: id, action: "updated", summary: `Updated contact ${d.name}` });
  refresh();
  return { ok: true, message: "Contact saved." };
}

export async function deleteContact(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const id = Number(fd.get("id"));
  const [c] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, ws.org.id))).limit(1);
  if (!c) return;
  const org = ws.org.id;
  await db.update(schema.deals).set({ contactId: null }).where(and(eq(schema.deals.contactId, id), eq(schema.deals.orgId, org)));
  await db.delete(schema.crmActivities).where(and(eq(schema.crmActivities.contactId, id), eq(schema.crmActivities.orgId, org)));
  await db.delete(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, org)));
  await logActivity(ctxOf(ws), { module: "crm", entityType: "contact", entityId: id, action: "deleted", summary: `Deleted contact ${c.name}` });
  redirect("/app/crm/contacts");
}
