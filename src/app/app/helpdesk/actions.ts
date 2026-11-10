"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { PRIORITIES, TICKET_CHANNELS, TICKET_STATUSES } from "@/db/schema";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { addSystemMessage, getHelpdeskAgents, isMember, setTicketStatus, slaDuesFor, uniqueKbSlug } from "@/lib/helpdesk-data";
import { createTicket } from "@/lib/helpdesk-data";
import { requireWorkspace } from "@/lib/tenancy";

const fail = (e: z.ZodError): FormState => ({ errors: z.flattenError(e).fieldErrors, message: "Please fix the highlighted fields." });
const optId = z.coerce.number().int().positive().optional();

async function loadTicket(orgId: number, id: number) {
  const [t] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.id, id), eq(schema.tickets.orgId, orgId))).limit(1);
  return t;
}

const NewTicketSchema = z.object({
  subject: z.string().min(3, "Add a short subject.").max(200),
  requesterName: z.string().min(1, "Requester name is required.").max(120),
  requesterEmail: z.email("Enter a valid email.").max(200),
  channel: z.enum(TICKET_CHANNELS),
  category: z.string().max(60).optional(),
  priority: z.enum(PRIORITIES),
  assigneeId: optId,
  description: z.string().max(10_000).optional(),
});

export async function createTicketAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const p = NewTicketSchema.safeParse(formObject(fd));
  if (!p.success) return fail(p.error);
  const orgId = ws.org.id;
  if (p.data.assigneeId && !(await isMember(orgId, p.data.assigneeId))) return { errors: { assigneeId: ["Choose a team member."] }, message: "Please fix the highlighted fields." };
  const t = await createTicket(orgId, p.data, { userId: ws.user.id, actor: ws.user.name });
  redirect(`/app/helpdesk/tickets/${t.id}`);
}

const ReplySchema = z.object({
  id: z.coerce.number().int().positive(),
  body: z.string().min(1, "Write a message.").max(10_000),
  mode: z.enum(["public", "internal"]),
  setStatus: z.enum(TICKET_STATUSES).optional(),
});

export async function replyAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const p = ReplySchema.safeParse(formObject(fd));
  if (!p.success) return fail(p.error);
  const orgId = ws.org.id;
  const t = await loadTicket(orgId, p.data.id);
  if (!t) return { message: "Ticket not found." };

  const now = new Date();
  const internal = p.data.mode === "internal";
  await db.insert(schema.ticketMessages).values({ orgId, ticketId: t.id, authorType: "agent", authorId: ws.user.id, body: p.data.body, internal, createdAt: now });
  await db
    .update(schema.tickets)
    .set({ updatedAt: now, ...(!internal && !t.firstRespondedAt ? { firstRespondedAt: now } : {}) })
    .where(and(eq(schema.tickets.id, t.id), eq(schema.tickets.orgId, orgId)));
  await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "ticket", entityId: t.id, action: internal ? "note" : "reply", summary: `${internal ? "Internal note on" : "Replied to"} ${t.number}` });
  if (p.data.setStatus) await setTicketStatus(orgId, { ...t, firstRespondedAt: t.firstRespondedAt }, p.data.setStatus, { userId: ws.user.id, name: ws.user.name });
  refresh();
  return { ok: true, message: internal ? "Note added." : "Reply sent." };
}

const UpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().optional(),
  category: z.string().max(60).optional(),
});

/** Single mutation path for sidebar selects: status, priority, assignee, category. */
export async function updateTicketAction(fd: FormData): Promise<void> {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const raw = Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith("$ACTION")).map(([k, v]) => [k, String(v).trim()]));
  const p = UpdateSchema.safeParse({ ...raw, category: raw.category || undefined });
  if (!p.success) return;
  const orgId = ws.org.id;
  const t = await loadTicket(orgId, p.data.id);
  if (!t) return;
  const actor = { userId: ws.user.id, name: ws.user.name };

  if (p.data.status) await setTicketStatus(orgId, t, p.data.status, actor);

  if (p.data.priority && p.data.priority !== t.priority) {
    const dues = await slaDuesFor(orgId, p.data.priority, t.createdAt);
    await db.update(schema.tickets).set({ priority: p.data.priority, ...dues, updatedAt: new Date() }).where(and(eq(schema.tickets.id, t.id), eq(schema.tickets.orgId, orgId)));
    await addSystemMessage(orgId, t.id, `${ws.user.name} changed priority from ${t.priority} to ${p.data.priority} (SLA due times recalculated)`, ws.user.id);
    await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "ticket", entityId: t.id, action: "priority", summary: `${t.number} priority → ${p.data.priority}` });
  }

  if (p.data.assigneeId !== undefined) {
    const next = p.data.assigneeId === "" ? null : Number(p.data.assigneeId);
    if (next !== null && (!Number.isInteger(next) || !(await isMember(orgId, next)))) return;
    if (next !== t.assigneeId) {
      const members = await db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
        .where(eq(schema.memberships.orgId, orgId));
      const name = members.find((m) => m.id === next)?.name;
      await db.update(schema.tickets).set({ assigneeId: next, updatedAt: new Date() }).where(and(eq(schema.tickets.id, t.id), eq(schema.tickets.orgId, orgId)));
      await addSystemMessage(orgId, t.id, next ? `${ws.user.name} assigned this ticket to ${name ?? "a teammate"}` : `${ws.user.name} unassigned this ticket`, ws.user.id);
      await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "ticket", entityId: t.id, action: "assigned", summary: `${t.number} ${next ? `assigned to ${name ?? "teammate"}` : "unassigned"}` });
    }
  }

  if (fd.has("category") && (p.data.category ?? null) !== t.category) {
    await db.update(schema.tickets).set({ category: p.data.category ?? null, updatedAt: new Date() }).where(and(eq(schema.tickets.id, t.id), eq(schema.tickets.orgId, orgId)));
    await addSystemMessage(orgId, t.id, `${ws.user.name} set category to ${p.data.category ?? "none"}`, ws.user.id);
  }
  refresh();
}

/* ---------------- Knowledge base ---------------- */

const ArticleSchema = z.object({
  id: optId,
  title: z.string().min(3, "Add a title.").max(160),
  category: z.string().min(1, "Choose a category.").max(60),
  body: z.string().min(1, "Write the article.").max(50_000),
  published: z.string().optional(),
});

export async function saveArticleAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const p = ArticleSchema.safeParse(formObject(fd));
  if (!p.success) return fail(p.error);
  const orgId = ws.org.id;
  const published = p.data.published === "on";
  const now = new Date();
  if (p.data.id) {
    const [cur] = await db.select().from(schema.kbArticles).where(and(eq(schema.kbArticles.id, p.data.id), eq(schema.kbArticles.orgId, orgId))).limit(1);
    if (!cur) return { message: "Article not found." };
    const slug = cur.title === p.data.title ? cur.slug : await uniqueKbSlug(orgId, p.data.title, cur.id);
    await db.update(schema.kbArticles).set({ title: p.data.title, slug, category: p.data.category, body: p.data.body, published, updatedAt: now }).where(and(eq(schema.kbArticles.id, cur.id), eq(schema.kbArticles.orgId, orgId)));
    await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "kb_article", entityId: cur.id, action: "updated", summary: `Updated article “${p.data.title}”` });
  } else {
    const slug = await uniqueKbSlug(orgId, p.data.title);
    const [a] = await db.insert(schema.kbArticles).values({ orgId, title: p.data.title, slug, category: p.data.category, body: p.data.body, published, createdAt: now, updatedAt: now }).returning({ id: schema.kbArticles.id });
    await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "kb_article", entityId: a.id, action: "created", summary: `Created article “${p.data.title}”` });
  }
  redirect("/app/helpdesk/knowledge-base");
}

export async function toggleArticleAction(fd: FormData): Promise<void> {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const [a] = await db.select().from(schema.kbArticles).where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.orgId, ws.org.id))).limit(1);
  if (!a) return;
  await db.update(schema.kbArticles).set({ published: !a.published, updatedAt: new Date() }).where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "kb_article", entityId: id, action: a.published ? "unpublished" : "published", summary: `${a.published ? "Unpublished" : "Published"} “${a.title}”` });
  refresh();
}

export async function deleteArticleAction(fd: FormData): Promise<void> {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const [a] = await db.select().from(schema.kbArticles).where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.orgId, ws.org.id))).limit(1);
  if (!a) return;
  await db.delete(schema.kbArticles).where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "kb_article", entityId: id, action: "deleted", summary: `Deleted article “${a.title}”` });
  refresh();
}

/* ---------------- Settings (managers) ---------------- */

export async function saveSlaAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "helpdesk", manage: true });
  const hours = z.coerce.number().min(0.25, "Min 0.25h").max(24 * 365, "Too large");
  const shape = z.object(Object.fromEntries(PRIORITIES.flatMap((p) => [[`${p}_response`, hours], [`${p}_resolution`, hours]])));
  const p = shape.safeParse(formObject(fd));
  if (!p.success) return fail(p.error);
  const v = p.data as Record<string, number>;
  const orgId = ws.org.id;
  for (const pr of PRIORITIES) {
    const firstResponseMins = Math.round(v[`${pr}_response`] * 60);
    const resolutionMins = Math.round(v[`${pr}_resolution`] * 60);
    await db
      .insert(schema.slaPolicies)
      .values({ orgId, priority: pr, firstResponseMins, resolutionMins })
      .onConflictDoUpdate({ target: [schema.slaPolicies.orgId, schema.slaPolicies.priority], set: { firstResponseMins, resolutionMins } });
  }
  await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "sla_policy", action: "updated", summary: "Updated SLA policies (applies to new tickets and priority changes)" });
  refresh();
  return { ok: true, message: "SLA policies saved." };
}

export async function saveAssignmentAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "helpdesk", manage: true });
  const orgId = ws.org.id;
  const enabled = fd.get("enabled") === "on";
  const requested = new Set(fd.getAll("agents").map((v) => Number(v)));
  const agents = (await getHelpdeskAgents(orgId)).map((a) => a.id).filter((id) => requested.has(id));
  if (enabled && agents.length === 0) return { message: "Pick at least one agent for the rotation." };
  const memberUserIds = JSON.stringify(agents);
  await db
    .insert(schema.helpdeskAssignment)
    .values({ orgId, enabled, memberUserIds })
    .onConflictDoUpdate({ target: schema.helpdeskAssignment.orgId, set: { enabled, memberUserIds, updatedAt: new Date() } });
  await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "assignment", action: "updated", summary: `Round-robin assignment ${enabled ? `on (${agents.length} agents)` : "off"}` });
  refresh();
  return { ok: true, message: "Assignment settings saved." };
}

const CannedSchema = z.object({ id: optId, title: z.string().min(2, "Add a title.").max(80), body: z.string().min(2, "Add the response text.").max(5000) });

export async function saveCannedAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "helpdesk", manage: true });
  const p = CannedSchema.safeParse(formObject(fd));
  if (!p.success) return fail(p.error);
  const orgId = ws.org.id;
  if (p.data.id) {
    await db.update(schema.cannedResponses).set({ title: p.data.title, body: p.data.body }).where(and(eq(schema.cannedResponses.id, p.data.id), eq(schema.cannedResponses.orgId, orgId)));
  } else {
    await db.insert(schema.cannedResponses).values({ orgId, title: p.data.title, body: p.data.body });
  }
  await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "canned_response", action: p.data.id ? "updated" : "created", summary: `${p.data.id ? "Updated" : "Added"} canned response “${p.data.title}”` });
  refresh();
  return { ok: true, message: "Saved." };
}

export async function deleteCannedAction(fd: FormData): Promise<void> {
  const ws = await requireWorkspace({ module: "helpdesk", manage: true });
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await db.delete(schema.cannedResponses).where(and(eq(schema.cannedResponses.id, id), eq(schema.cannedResponses.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "helpdesk", entityType: "canned_response", entityId: id, action: "deleted", summary: "Deleted a canned response" });
  refresh();
}
