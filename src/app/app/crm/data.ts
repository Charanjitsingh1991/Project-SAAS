import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { ACTIVE_WINDOW_DAYS } from "@/lib/crm";

export async function getMembers(orgId: number) {
  return db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.users.name));
}

export async function getCompanyOptions(orgId: number) {
  const rows = await db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.orgId, orgId)).orderBy(asc(schema.companies.name));
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

export async function getContactOptions(orgId: number) {
  const rows = await db.select({ id: schema.contacts.id, name: schema.contacts.name }).from(schema.contacts).where(eq(schema.contacts.orgId, orgId)).orderBy(asc(schema.contacts.name));
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

/** Deal ids / contact ids with an activity logged in the last 14 days, plus all deal values (for percentiles). */
export async function getScoreContext(orgId: number, nowMs: number) {
  const cutoff = new Date(nowMs - ACTIVE_WINDOW_DAYS * 86_400_000);
  const acts = await db
    .select({ dealId: schema.crmActivities.dealId, contactId: schema.crmActivities.contactId })
    .from(schema.crmActivities)
    .where(and(eq(schema.crmActivities.orgId, orgId), gte(schema.crmActivities.createdAt, cutoff)));
  const deals = await db.select({ value: schema.deals.value }).from(schema.deals).where(eq(schema.deals.orgId, orgId));
  return {
    activeDeals: new Set(acts.map((a) => a.dealId).filter((x): x is number => x !== null)),
    activeContacts: new Set(acts.map((a) => a.contactId).filter((x): x is number => x !== null)),
    allValues: deals.map((d) => d.value),
  };
}
