"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { createTicket, setTicketStatus } from "@/lib/helpdesk-data";
import { logActivity } from "@/lib/activity";
import { getPortalOrg } from "./parts";

const fail = (e: z.ZodError): FormState => ({ errors: z.flattenError(e).fieldErrors, message: "Please fix the highlighted fields." });

const RequestSchema = z.object({
  slug: z.string().max(80),
  name: z.string().min(1, "Your name is required.").max(120),
  email: z.email("Enter a valid email.").max(200),
  subject: z.string().min(3, "Add a short subject.").max(200),
  description: z.string().min(5, "Tell us a bit more.").max(5000),
  website: z.string().max(200).optional(),
});

export async function submitRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  const p = RequestSchema.safeParse(formObject(fd));
  if (!p.success) return fail(p.error);
  const org = await getPortalOrg(p.data.slug);
  if (p.data.website) return { ok: true, message: "Thanks, we got your request." };

  const t = await createTicket(
    org.id,
    { subject: p.data.subject, description: p.data.description, requesterName: p.data.name, requesterEmail: p.data.email, channel: "portal", priority: "medium" },
    { actor: p.data.name },
  );
  redirect(`/support/${org.slug}/ticket/${t.publicToken}`);
}

async function loadByToken(slug: string, token: string) {
  const org = await getPortalOrg(slug);
  const [t] = await db
    .select()
    .from(schema.tickets)
    .where(and(eq(schema.tickets.orgId, org.id), eq(schema.tickets.publicToken, token)))
    .limit(1);
  return t ? { org, t } : null;
}

const ReplySchema = z.object({ slug: z.string().max(80), token: z.string().min(10).max(80), body: z.string().min(1, "Write a message.").max(5000) });

export async function requesterReplyAction(_: FormState, fd: FormData): Promise<FormState> {
  const p = ReplySchema.safeParse(formObject(fd));
  if (!p.success) return fail(p.error);
  const found = await loadByToken(p.data.slug, p.data.token);
  if (!found) return { message: "Request not found." };
  const { org, t } = found;
  if (t.status === "closed") return { message: "This request is closed. Please submit a new one." };

  const now = new Date();
  await db.insert(schema.ticketMessages).values({ orgId: org.id, ticketId: t.id, authorType: "requester", body: p.data.body, internal: false, createdAt: now });
  await db.update(schema.tickets).set({ updatedAt: now }).where(and(eq(schema.tickets.id, t.id), eq(schema.tickets.orgId, org.id)));
  if (t.status === "pending" || t.status === "resolved") await setTicketStatus(org.id, t, "open", { userId: null, name: t.requesterName });
  await logActivity({ orgId: org.id, userId: null }, { module: "helpdesk", entityType: "ticket", entityId: t.id, action: "requester_reply", summary: `${t.requesterName} replied to ${t.number}` });
  refresh();
  return { ok: true, message: "Reply sent." };
}

const CsatSchema = z.object({
  slug: z.string().max(80),
  token: z.string().min(10).max(80),
  rating: z.coerce.number().int().min(1, "Pick a rating.").max(5, "Pick a rating."),
  comment: z.string().max(1000).optional(),
});

export async function rateTicketAction(_: FormState, fd: FormData): Promise<FormState> {
  const p = CsatSchema.safeParse(formObject(fd));
  if (!p.success) return fail(p.error);
  const found = await loadByToken(p.data.slug, p.data.token);
  if (!found) return { message: "Request not found." };
  const { org, t } = found;
  if (t.status !== "resolved" && t.status !== "closed") return { message: "You can rate once the request is resolved." };
  if (t.csatRating != null) return { message: "Thanks, you've already rated this request." };

  await db
    .update(schema.tickets)
    .set({ csatRating: p.data.rating, csatComment: p.data.comment ?? null, updatedAt: new Date() })
    .where(and(eq(schema.tickets.id, t.id), eq(schema.tickets.orgId, org.id), isNull(schema.tickets.csatRating)));
  await logActivity({ orgId: org.id, userId: null }, { module: "helpdesk", entityType: "ticket", entityId: t.id, action: "csat", summary: `${t.requesterName} rated ${t.number} ${p.data.rating}/5` });
  refresh();
  return { ok: true, message: "Thank you for your feedback!" };
}
