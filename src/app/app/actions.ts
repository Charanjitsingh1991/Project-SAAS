"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/dal";
import type { FormState } from "@/lib/definitions";
import { createOrganization } from "@/lib/org";
import { ctxOf, logActivity } from "@/lib/activity";
import { AUTOMATIONS } from "@/lib/automations";
import { formObject } from "@/lib/format";
import { seedWorkspace } from "@/lib/seed";
import { ORG_COOKIE, requireWorkspace } from "@/lib/tenancy";

async function setActiveOrg(orgId: number) {
  (await cookies()).set(ORG_COOKIE, String(orgId), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function createWorkspace(_: FormState, fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const parsed = z.object({ name: z.string().trim().min(2, "Give your workspace a name.").max(80) }).safeParse({ name: fd.get("name") });
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const orgId = await createOrganization(user.id, parsed.data.name);
  await setActiveOrg(orgId);
  redirect("/app");
}

export async function switchWorkspace(fd: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const orgId = Number(fd.get("orgId"));
  const [m] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, user.id)))
    .limit(1);
  if (m) await setActiveOrg(orgId);
  redirect("/app");
}

export async function loadSampleData() {
  const ws = await requireWorkspace({ manage: true });
  await seedWorkspace({ orgId: ws.org.id, userId: ws.user.id });
  refresh();
}

export async function saveAutomations(fd: FormData) {
  const ws = await requireWorkspace({ manage: true });
  const settings = Object.fromEntries(AUTOMATIONS.map((a) => [a.key, fd.get(a.key) === "on"]));
  await db.update(schema.organizations).set({ automations: JSON.stringify(settings) }).where(eq(schema.organizations.id, ws.org.id));
  await logActivity(ctxOf(ws), { module: "workspace", entityType: "settings", action: "updated", summary: "Updated automation settings" });
  refresh();
}

export async function saveCompanyProfile(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ manage: true });
  const parsed = z
    .object({
      state: z.string().max(80).optional(),
      gstin: z
        .string()
        .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN format.")
        .optional(),
      address: z.string().max(300).optional(),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  await db
    .update(schema.organizations)
    .set({ state: parsed.data.state ?? null, gstin: parsed.data.gstin ?? null, address: parsed.data.address ?? null })
    .where(eq(schema.organizations.id, ws.org.id));
  refresh();
  return { ok: true, message: "Company details saved." };
}
