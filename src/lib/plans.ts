import type { ModuleKey } from "./roles";

export type PlanKey = "starter" | "growth" | "enterprise";

export type Feature =
  | "automations"
  | "recruitment"
  | "performance"
  | "expenseClaims"
  | "webForms"
  | "recurringInvoices"
  | "bankReconciliation"
  | "supportPortal"
  | "auditLog"
  | "payrollModule"
  | "analyticsModule";

export const ALL_MODULES: ModuleKey[] = ["hrm", "payroll", "crm", "finance", "inventory", "projects", "helpdesk", "analytics"];
/** Modules a Starter workspace can choose from (payroll & analytics need Growth). */
export const CORE_MODULES: ModuleKey[] = ["hrm", "crm", "finance", "inventory", "projects", "helpdesk"];

export type PlanDef = {
  key: PlanKey;
  name: string;
  blurb: string;
  /** Modules the plan can enable. */
  allowedModules: ModuleKey[];
  /** Max modules enabled at once (null = no limit). */
  moduleLimit: number | null;
  maxUsers: number | null;
  maxWarehouses: number | null;
  maxWorkspacesPerOwner: number | null;
  features: Feature[];
  /** Customer-facing bullet list (only things that exist). */
  highlights: string[];
};

const GROWTH_FEATURES: Feature[] = [
  "automations",
  "recruitment",
  "performance",
  "expenseClaims",
  "webForms",
  "recurringInvoices",
  "bankReconciliation",
  "supportPortal",
  "payrollModule",
  "analyticsModule",
];

export const PLANS: Record<PlanKey, PlanDef> = {
  starter: {
    key: "starter",
    name: "Starter",
    blurb: "Pick the 3 modules you need today.",
    allowedModules: CORE_MODULES,
    moduleLimit: 3,
    maxUsers: 25,
    maxWarehouses: 1,
    maxWorkspacesPerOwner: 1,
    features: [],
    highlights: ["Any 3 of HRM, CRM, Finance, Inventory, Projects, Helpdesk", "Up to 25 users", "Quotes, CSV import & exports", "India & UAE tax compliance"],
  },
  growth: {
    key: "growth",
    name: "Growth",
    blurb: "Every module, connected by automations.",
    allowedModules: ALL_MODULES,
    moduleLimit: null,
    maxUsers: null,
    maxWarehouses: 5,
    maxWorkspacesPerOwner: 3,
    features: GROWTH_FEATURES,
    highlights: [
      "All 8 modules incl. Payroll & Analytics",
      "Cross-module automations",
      "Recruitment, performance & expense claims",
      "Recurring invoices & bank reconciliation",
      "Customer support portal & web-to-lead forms",
      "Unlimited users, up to 5 warehouses",
    ],
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    blurb: "For multi-entity groups that need control.",
    allowedModules: ALL_MODULES,
    moduleLimit: null,
    maxUsers: null,
    maxWarehouses: null,
    maxWorkspacesPerOwner: null,
    features: [...GROWTH_FEATURES, "auditLog"],
    highlights: ["Everything in Growth", "Full audit log with filters & export", "Unlimited warehouses & workspaces", "Dedicated success manager"],
  },
};

export function planDef(key: string | null | undefined): PlanDef {
  return PLANS[(key as PlanKey) ?? "growth"] ?? PLANS.growth;
}

/** Effective plan: trials run on Growth. */
export function effectivePlan(org: { plan: string }, inTrial: boolean): PlanDef {
  if (inTrial) return PLANS.growth;
  return planDef(org.plan);
}

export function parseEnabledModules(json: string | null | undefined): ModuleKey[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v.filter((m) => ALL_MODULES.includes(m)) as ModuleKey[]) : null;
  } catch {
    return null;
  }
}

/**
 * Modules a workspace can actually use: the plan's allowed modules ∩ the owner's selection,
 * truncated to the plan's module limit (Starter default: HRM, CRM, Projects).
 */
export function activeModules(plan: PlanDef, enabledJson: string | null | undefined): ModuleKey[] {
  const selected = parseEnabledModules(enabledJson);
  let mods = (selected ?? (plan.moduleLimit ? ["hrm", "crm", "projects"] : plan.allowedModules)).filter((m) => plan.allowedModules.includes(m));
  if (plan.moduleLimit !== null) mods = mods.slice(0, plan.moduleLimit);
  return ALL_MODULES.filter((m) => mods.includes(m));
}

export function planHas(plan: PlanDef, feature: Feature) {
  return plan.features.includes(feature);
}
