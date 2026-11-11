import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import type { Role } from "@/db/schema";
import { getCurrentUser, redirectToAuth } from "./dal";
import { packOf } from "./countries";
import { activeModules, effectivePlan, planHas, type Feature } from "./plans";
import { canManage, roleCanUse, type ModuleKey } from "./roles";
import { accessFor } from "./trial";

export const ORG_COOKIE = "saas_org";

const DEFAULT_ADMIN_EMAILS = "charanjit@thecharanjitsingh.com";

export function isPlatformAdmin(email: string) {
  const list = (process.env.ADMIN_EMAILS || DEFAULT_ADMIN_EMAILS)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** Gives every workspace owned by `userId` free Enterprise access. */
export async function compOwnedWorkspaces(userId: number) {
  await db
    .update(schema.organizations)
    .set({ compedAt: new Date(), plan: "enterprise" })
    .where(and(eq(schema.organizations.ownerId, userId), isNull(schema.organizations.compedAt)));
}

/** Current user + active workspace for this request (deduped per render). */
export const getWorkspace = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  const admin = isPlatformAdmin(user.email);
  // Platform admins run their own workspaces free, on Enterprise, without a trial (no-op once applied).
  if (admin) await compOwnedWorkspaces(user.id);

  const rows = await db
    .select({ org: schema.organizations, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.memberships.orgId, schema.organizations.id))
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(asc(schema.memberships.createdAt));

  const orgs = rows.map((r) => ({ id: r.org.id, name: r.org.name, role: r.role }));
  const wanted = Number((await cookies()).get(ORG_COOKIE)?.value);
  const pick = rows.find((r) => r.org.id === wanted) ?? rows[0];

  if (!pick) return { user, org: null, role: null, orgs, access: null, isPlatformAdmin: admin } as const;

  const access = accessFor(pick.org);
  return { user, org: pick.org, role: pick.role as Role, orgs, access, isPlatformAdmin: admin } as const;
});

export type Workspace = NonNullable<Awaited<ReturnType<typeof getWorkspace>>>;
export type ActiveWorkspace = Workspace & { org: NonNullable<Workspace["org"]>; role: Role; access: NonNullable<Workspace["access"]> };

/** The plan in force: trials run on Growth. */
export function planOf(ws: ActiveWorkspace) {
  return effectivePlan(ws.org, ws.access.state === "trial");
}

/** Modules switched on for this workspace (plan-allowed ∩ owner selection). */
export function planModules(ws: ActiveWorkspace): ModuleKey[] {
  return activeModules(planOf(ws), ws.org.enabledModules);
}

export function canUseModule(ws: ActiveWorkspace, mod: ModuleKey) {
  return roleCanUse(ws.role, mod) && planModules(ws).includes(mod);
}

export function hasFeature(ws: ActiveWorkspace, feature: Feature) {
  return planHas(planOf(ws), feature);
}

/** Country pack for the active workspace. */
export function packFor(ws: ActiveWorkspace) {
  return packOf(ws.org);
}

/**
 * Guard for every workspace page and server action.
 * Redirects to login / setup / billing (when deactivated) / overview (no permission).
 */
export async function requireWorkspace(opts: { module?: ModuleKey; manage?: boolean; allowLocked?: boolean; feature?: Feature } = {}) {
  const ws = await getWorkspace();
  if (!ws) return redirectToAuth();
  if (!ws.org || !ws.role || !ws.access) redirect("/app/setup");
  const active = ws as ActiveWorkspace;

  if (active.access.state === "locked" && !opts.allowLocked) redirect("/app/billing");
  if (opts.manage && !canManage(active.role)) redirect("/app?denied=manage");
  if (opts.module && !canUseModule(active, opts.module)) redirect(`/app?denied=${opts.module}`);
  if (opts.feature && !hasFeature(active, opts.feature)) redirect(`/app/billing?upgrade=${opts.feature}`);
  return active;
}

export async function requirePlatformAdmin() {
  const ws = await getWorkspace();
  if (!ws) return redirectToAuth();
  if (!ws.isPlatformAdmin) redirect("/app");
  return ws;
}
