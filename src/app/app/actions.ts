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
import { effectivePlan } from "@/lib/plans";
import { accessFor } from "@/lib/trial";
import { ctxOf, logActivity } from "@/lib/activity";
import { AUTOMATIONS } from "@/lib/automations";
import { formObject } from "@/lib/format";
import { seedWorkspace } from "@/lib/seed";
import { packOf } from "@/lib/countries";
import { ALL_MODULES } from "@/lib/plans";
import type { ModuleKey } from "@/lib/roles";
import { ORG_COOKIE, planOf, requireWorkspace } from "@/lib/tenancy";

async function setActiveOrg(orgId: number) {
  (await cookies()).set(ORG_COOKIE, String(orgId), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function createWorkspace(_: FormState, fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const parsed = z
    .object({ name: z.string().trim().min(2, "Give your workspace a name.").max(80), country: z.enum(["IN", "AE"], "Choose a country.") })
    .safeParse({ name: fd.get("name"), country: fd.get("country") ?? "IN" });
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };

  // Workspaces per owner are limited by the best plan among the workspaces they already own.
  const owned = await db.select().from(schema.organizations).where(eq(schema.organizations.ownerId, user.id));
  if (owned.length) {
    const limits = owned.map((o) => effectivePlan(o, accessFor(o).state === "trial").maxWorkspacesPerOwner);
    const limit = limits.includes(null) ? null : Math.max(...(limits as number[]));
    if (limit !== null && owned.length >= limit) {
      return { message: `Your plan allows ${limit} workspace${limit === 1 ? "" : "s"}. Upgrade to add more.` };
    }
  }
  const orgId = await createOrganization(user.id, parsed.data.name, { country: parsed.data.country, phone: user.phone ?? null });
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
  const pack = packOf(ws.org);
  const raw = formObject(fd);
  const parsed = z
    .object({
      state: z.enum(pack.regions as [string, ...string[]], `Choose a ${pack.regionLabel.toLowerCase()}.`).optional(),
      gstin: z
        .string()
        .transform((v) => v.toUpperCase().replace(/\s/g, ""))
        .pipe(z.string().regex(new RegExp(pack.tax.idPattern), `Invalid ${pack.tax.idLabel} (e.g. ${pack.tax.idExample}).`))
        .optional(),
      address: z.string().max(300).optional(),
      fiscalYearStart: z.coerce.number().int().min(1).max(12),
    })
    .safeParse(raw);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };

  const weekend = fd.getAll("weekend").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (weekend.length > 3) return { errors: { weekend: ["Pick at most 3 weekend days."] } };

  const statutory: Record<string, string> = {};
  const errors: Record<string, string[]> = {};
  for (const f of pack.statutoryOrgFields) {
    const v = raw[`st_${f.key}`];
    if (!v) continue;
    if (f.pattern && !new RegExp(f.pattern).test(v)) errors[`st_${f.key}`] = [`${f.label}: ${f.patternHint ?? "invalid format"}.`];
    statutory[f.key] = v;
  }
  if (Object.keys(errors).length) return { errors };

  await db
    .update(schema.organizations)
    .set({
      state: parsed.data.state ?? null,
      gstin: parsed.data.gstin ?? null,
      address: parsed.data.address ?? null,
      fiscalYearStart: parsed.data.fiscalYearStart,
      weekendDays: JSON.stringify(weekend.sort()),
      statutory: JSON.stringify(statutory),
    })
    .where(eq(schema.organizations.id, ws.org.id));
  await logActivity(ctxOf(ws), { module: "workspace", entityType: "settings", action: "updated", summary: "Updated company profile" });
  refresh();
  return { ok: true, message: "Company details saved." };
}

/** Owner/admin chooses which modules are switched on, within the plan's limits. */
export async function saveModules(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ manage: true });
  const plan = planOf(ws);
  const chosen = fd.getAll("modules").map(String).filter((m): m is ModuleKey => (ALL_MODULES as string[]).includes(m));
  const notAllowed = chosen.filter((m) => !plan.allowedModules.includes(m));
  if (notAllowed.length) return { message: `${notAllowed.join(", ")} ${notAllowed.length === 1 ? "needs" : "need"} the Growth plan.` };
  if (!chosen.length) return { message: "Keep at least one module switched on." };
  if (plan.moduleLimit !== null && chosen.length > plan.moduleLimit) {
    return { message: `The ${plan.name} plan includes ${plan.moduleLimit} modules. Switch one off or upgrade to Growth.` };
  }
  await db.update(schema.organizations).set({ enabledModules: JSON.stringify(chosen) }).where(eq(schema.organizations.id, ws.org.id));
  await logActivity(ctxOf(ws), { module: "workspace", entityType: "settings", action: "modules", summary: `Modules switched on: ${chosen.join(", ")}` });
  refresh();
  return { ok: true, message: "Modules updated." };
}
