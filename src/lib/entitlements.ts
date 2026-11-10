import "server-only";
import { activeModules, effectivePlan, planHas, type Feature } from "./plans";
import type { ModuleKey } from "./roles";
import { accessFor } from "./trial";

type OrgLike = Parameters<typeof accessFor>[0] & { plan: string; enabledModules: string | null };

/** Plan, modules and lock state for an organization row (for public routes without a signed-in workspace). */
export function orgEntitlements(org: OrgLike) {
  const access = accessFor(org);
  const plan = effectivePlan(org, access.state === "trial");
  const modules = activeModules(plan, org.enabledModules);
  return {
    plan,
    modules,
    locked: access.state === "locked",
    allows: (mod: ModuleKey, feature?: Feature) => access.state !== "locked" && modules.includes(mod) && (!feature || planHas(plan, feature)),
  };
}
