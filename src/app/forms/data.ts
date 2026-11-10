import "server-only";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import { packOf } from "@/lib/countries";
import { orgEntitlements } from "@/lib/entitlements";

/** Workspace behind a public web form; null unless its effective plan has web forms and CRM is on. */
export async function webFormOrg(slug: string) {
  if (!/^[a-z0-9-]{1,80}$/i.test(slug)) return null;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.slug, slug.toLowerCase())).limit(1);
  if (!org || !orgEntitlements(org).allows("crm", "webForms")) return null;
  return { id: org.id, name: org.name, slug: org.slug, ownerId: org.ownerId, country: org.country, pack: packOf(org) };
}

export const getFormOrg = cache(async (slug: string) => {
  const org = await webFormOrg(slug);
  if (!org) notFound();
  return org;
});
