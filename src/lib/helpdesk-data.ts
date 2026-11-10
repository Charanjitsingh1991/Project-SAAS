import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PRIORITIES, TICKET_CHANNELS } from "@/db/schema";
import { logActivity } from "./activity";
import { slaDue, slugify, statusPatch, type TicketStatus } from "./helpdesk";
import { DEFAULT_SLA } from "./org";
import { roleCanUse } from "./roles";
import { parseUserIds, pickNext } from "./round-robin";
import { nextNumber } from "./sequence";

type Priority = (typeof PRIORITIES)[number];

export async function getSlaPolicies(orgId: number) {
  const rows = await db.select().from(schema.slaPolicies).where(eq(schema.slaPolicies.orgId, orgId));
  const map = new Map(rows.map((r) => [r.priority, r]));
  return DEFAULT_SLA.map((d) => {
    const r = map.get(d.priority);
    return { priority: d.priority, firstResponseMins: r?.firstResponseMins ?? d.firstResponseMins, resolutionMins: r?.resolutionMins ?? d.resolutionMins };
  });
}

export async function slaDuesFor(orgId: number, priority: Priority, createdAt: Date) {
  const p = (await getSlaPolicies(orgId)).find((x) => x.priority === priority)!;
  return { firstResponseDueAt: slaDue(createdAt, p.firstResponseMins), resolutionDueAt: slaDue(createdAt, p.resolutionMins) };
}

export async function getMembers(orgId: number) {
  return db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.users.name));
}

export async function isMember(orgId: number, userId: number) {
  const [r] = await db.select({ id: schema.memberships.id }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId))).limit(1);
  return !!r;
}

export async function getAssignmentConfig(orgId: number) {
  const [r] = await db.select().from(schema.helpdeskAssignment).where(eq(schema.helpdeskAssignment.orgId, orgId)).limit(1);
  return { enabled: r?.enabled ?? false, memberUserIds: parseUserIds(r?.memberUserIds), lastAssignedUserId: r?.lastAssignedUserId ?? null };
}

/** Org members whose role can use the helpdesk (candidates for the rotation). */
export async function getHelpdeskAgents(orgId: number) {
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.users.name));
  return rows.filter((r) => roleCanUse(r.role, "helpdesk"));
}

/**
 * Pick and claim the next agent in the rotation, or null when disabled/empty.
 * The pointer moves by compare-and-swap so concurrent creates get distinct turns.
 */
export async function nextAutoAssignee(orgId: number): Promise<number | null> {
  const A = schema.helpdeskAssignment;
  for (let attempt = 0; attempt < 5; attempt++) {
    const cfg = await getAssignmentConfig(orgId);
    if (!cfg.enabled || cfg.memberUserIds.length === 0) return null;
    const agents = new Set((await getHelpdeskAgents(orgId)).map((a) => a.id));
    const next = pickNext(cfg.memberUserIds.filter((u) => agents.has(u)), cfg.lastAssignedUserId);
    if (next == null) return null;
    const claimed = await db
      .update(A)
      .set({ lastAssignedUserId: next })
      .where(and(eq(A.orgId, orgId), cfg.lastAssignedUserId == null ? isNull(A.lastAssignedUserId) : eq(A.lastAssignedUserId, cfg.lastAssignedUserId)))
      .returning({ id: A.id });
    if (claimed.length) return next;
  }
  return null;
}

export type NewTicket = {
  subject: string;
  description?: string | null;
  requesterName: string;
  requesterEmail: string;
  channel: (typeof TICKET_CHANNELS)[number];
  category?: string | null;
  priority: Priority;
  assigneeId?: number | null;
};

/**
 * Create a ticket: number, SLA dues from the workspace policy, private token,
 * CRM contact/company auto-link by requester email, first message and activity log.
 * Caller must have validated `assigneeId` belongs to the org.
 */
export async function createTicket(orgId: number, input: NewTicket, opts: { userId?: number | null; createdAt?: Date; actor?: string } = {}) {
  const createdAt = opts.createdAt ?? new Date();
  const autoAssigneeId = input.assigneeId ? null : await nextAutoAssignee(orgId);
  const assigneeId = input.assigneeId ?? autoAssigneeId;
  const number = await nextNumber(orgId, "ticket");
  const dues = await slaDuesFor(orgId, input.priority, createdAt);
  const email = input.requesterEmail.trim().toLowerCase();

  const [contact] = await db
    .select({ id: schema.contacts.id, companyId: schema.contacts.companyId })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), sql`lower(${schema.contacts.email}) = ${email}`))
    .limit(1);

  const publicToken = randomBytes(24).toString("base64url");
  const [t] = await db
    .insert(schema.tickets)
    .values({
      orgId,
      number,
      subject: input.subject,
      description: input.description ?? null,
      requesterName: input.requesterName,
      requesterEmail: email,
      contactId: contact?.id ?? null,
      companyId: contact?.companyId ?? null,
      channel: input.channel,
      category: input.category ?? null,
      priority: input.priority,
      status: "open",
      assigneeId,
      ...dues,
      publicToken,
      createdAt,
      updatedAt: createdAt,
    })
    .returning({ id: schema.tickets.id });

  if (input.description) {
    await db.insert(schema.ticketMessages).values({ orgId, ticketId: t.id, authorType: "requester", body: input.description, internal: false, createdAt });
  }
  await logActivity(
    { orgId, userId: opts.userId ?? null },
    { module: "helpdesk", entityType: "ticket", entityId: t.id, action: "created", summary: `${opts.actor ?? input.requesterName} opened ${number}: ${input.subject}` },
  );
  if (autoAssigneeId) {
    await logActivity(
      { orgId, userId: opts.userId ?? null },
      { module: "helpdesk", entityType: "ticket", entityId: t.id, action: "auto_assigned", summary: `${number} auto-assigned (round-robin)` },
    );
  }
  return { id: t.id, number, publicToken };
}

export async function addSystemMessage(orgId: number, ticketId: number, body: string, authorId: number | null, at?: Date) {
  await db.insert(schema.ticketMessages).values({ orgId, ticketId, authorType: "system", authorId, body, internal: false, createdAt: at ?? new Date() });
}

type TicketRow = typeof schema.tickets.$inferSelect;

/** Move a ticket to a new status with resolve/close/reopen bookkeeping. Returns false when unchanged. */
export async function setTicketStatus(orgId: number, t: TicketRow, status: TicketStatus, actor: { userId: number | null; name: string }) {
  if (t.status === status) return false;
  const now = new Date();
  await db
    .update(schema.tickets)
    .set({ status, ...statusPatch(t, status, now), updatedAt: now })
    .where(and(eq(schema.tickets.id, t.id), eq(schema.tickets.orgId, orgId)));
  await addSystemMessage(orgId, t.id, `${actor.name} changed status from ${t.status.replace("_", " ")} to ${status.replace("_", " ")}`, actor.userId, now);
  await logActivity({ orgId, userId: actor.userId }, { module: "helpdesk", entityType: "ticket", entityId: t.id, action: "status", summary: `${t.number} → ${status.replace("_", " ")}` });
  return true;
}

/** Unique KB slug per org (suffix -2, -3 …). */
export async function uniqueKbSlug(orgId: number, title: string, excludeId?: number) {
  const base = slugify(title);
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const conds = [eq(schema.kbArticles.orgId, orgId), eq(schema.kbArticles.slug, candidate)];
    if (excludeId) conds.push(ne(schema.kbArticles.id, excludeId));
    const [hit] = await db.select({ id: schema.kbArticles.id }).from(schema.kbArticles).where(and(...conds)).limit(1);
    if (!hit) return candidate;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
}
