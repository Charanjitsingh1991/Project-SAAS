import "server-only";
import { db, schema } from "@/db";
import { trialEndFor } from "./trial";

/** New workspace with the creator as owner and a fresh 14-day trial (no card needed). */
export async function createOrganization(userId: number, name: string) {
  const now = new Date();
  const [org] = await db
    .insert(schema.organizations)
    .values({ name, ownerId: userId, trialStartedAt: now, trialEndsAt: trialEndFor(now) })
    .returning({ id: schema.organizations.id });
  await db.insert(schema.memberships).values({ orgId: org.id, userId, role: "owner" });
  return org.id;
}
