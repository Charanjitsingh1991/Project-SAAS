import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ensureChartOfAccounts } from "./ledger";
import { defaultWarehouseId } from "./stock";
import { trialEndFor } from "./trial";

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

export const DEFAULT_LEAVE_TYPES = [
  { name: "Casual leave", code: "CL", annualQuota: 12, paid: true, color: "mint" },
  { name: "Sick leave", code: "SL", annualQuota: 12, paid: true, color: "sky" },
  { name: "Earned leave", code: "EL", annualQuota: 15, paid: true, color: "lime" },
  { name: "Leave without pay", code: "LWP", annualQuota: 0, paid: false, color: "rose" },
];

export const DEFAULT_SLA = [
  { priority: "urgent" as const, firstResponseMins: 60, resolutionMins: 4 * 60 },
  { priority: "high" as const, firstResponseMins: 4 * 60, resolutionMins: 24 * 60 },
  { priority: "medium" as const, firstResponseMins: 8 * 60, resolutionMins: 48 * 60 },
  { priority: "low" as const, firstResponseMins: 24 * 60, resolutionMins: 120 * 60 },
];

/** Defaults every workspace needs: chart of accounts, main warehouse, leave types, SLA policies. Idempotent. */
export async function initOrgDefaults(orgId: number) {
  await ensureChartOfAccounts(orgId);
  await defaultWarehouseId(orgId);
  const lt = await db.$count(schema.leaveTypes, eq(schema.leaveTypes.orgId, orgId));
  if (!lt) await db.insert(schema.leaveTypes).values(DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, orgId })));
  await db
    .insert(schema.slaPolicies)
    .values(DEFAULT_SLA.map((s) => ({ ...s, orgId })))
    .onConflictDoNothing();
}

/** New workspace with the creator as owner and a fresh 14-day trial (no card needed). */
export async function createOrganization(userId: number, name: string) {
  const now = new Date();
  const [org] = await db
    .insert(schema.organizations)
    .values({ name, slug: await uniqueSlug(name), ownerId: userId, trialStartedAt: now, trialEndsAt: trialEndFor(now) })
    .returning({ id: schema.organizations.id });
  await db.insert(schema.memberships).values({ orgId: org.id, userId, role: "owner" });
  await initOrgDefaults(org.id);
  return org.id;
}
