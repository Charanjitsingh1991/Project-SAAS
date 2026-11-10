import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ensureChartOfAccounts } from "./ledger";
import { defaultWarehouseId } from "./stock";
import { trialEndFor } from "./trial";
import { countryPack, type CountryCode } from "./countries";

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    const [taken] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.slug, candidate)).limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

export const DEFAULT_SLA = [
  { priority: "urgent" as const, firstResponseMins: 60, resolutionMins: 4 * 60 },
  { priority: "high" as const, firstResponseMins: 4 * 60, resolutionMins: 24 * 60 },
  { priority: "medium" as const, firstResponseMins: 8 * 60, resolutionMins: 48 * 60 },
  { priority: "low" as const, firstResponseMins: 24 * 60, resolutionMins: 120 * 60 },
];

/**
 * Country defaults every workspace needs (idempotent): chart of accounts, main warehouse,
 * statutory leave types, public holidays for this and next year, and SLA policies.
 */
export async function initOrgDefaults(orgId: number) {
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  const pack = countryPack(org?.country);
  await ensureChartOfAccounts(orgId);
  await defaultWarehouseId(orgId);
  const lt = await db.$count(schema.leaveTypes, eq(schema.leaveTypes.orgId, orgId));
  if (!lt) {
    await db.insert(schema.leaveTypes).values(
      pack.hr.leaveTypes.map((t) => ({ orgId, name: t.name, code: t.code, annualQuota: t.annualQuota, paid: t.payPercent > 0, payPercent: t.payPercent, appliesTo: t.appliesTo, color: t.color })),
    );
  }
  const year = new Date().getUTCFullYear();
  const hols = [...pack.hr.holidays(year), ...pack.hr.holidays(year + 1)];
  if (hols.length) {
    await db
      .insert(schema.holidays)
      .values(hols.map((h) => ({ orgId, date: h.date, name: h.name, optional: !!h.optional })))
      .onConflictDoNothing();
  }
  await db
    .insert(schema.slaPolicies)
    .values(DEFAULT_SLA.map((s) => ({ ...s, orgId })))
    .onConflictDoNothing();
}

/** New workspace with the creator as owner and a fresh 14-day trial (no card needed), configured for its country. */
export async function createOrganization(userId: number, name: string, opts: { country?: CountryCode; phone?: string | null } = {}) {
  const pack = countryPack(opts.country ?? "IN");
  const now = new Date();
  const [org] = await db
    .insert(schema.organizations)
    .values({
      name,
      slug: await uniqueSlug(name),
      country: pack.code,
      phone: opts.phone ?? null,
      timezone: pack.timezone,
      currency: pack.currency,
      weekendDays: JSON.stringify(pack.weekendDays),
      fiscalYearStart: pack.fiscalYearStartMonth,
      ownerId: userId,
      trialStartedAt: now,
      trialEndsAt: trialEndFor(now),
    })
    .returning({ id: schema.organizations.id });
  await db.insert(schema.memberships).values({ orgId: org.id, userId, role: "owner" });
  await initOrgDefaults(org.id);
  return org.id;
}
