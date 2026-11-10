import type { Role } from "@/db/schema";

export type ModuleKey = "hrm" | "crm" | "finance" | "inventory" | "payroll" | "projects" | "helpdesk" | "analytics";

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  owner: { label: "Owner", description: "Full access, billing and can transfer the workspace." },
  admin: { label: "Admin", description: "Full access to every module, team and billing." },
  hr: { label: "HR", description: "People, leave, payroll and projects." },
  sales: { label: "Sales", description: "CRM, helpdesk, inventory and projects." },
  finance: { label: "Finance", description: "Accounts, payroll, inventory and analytics." },
  member: { label: "Employee", description: "My space (leave, attendance, payslips, claims, goals), projects and helpdesk." },
};

export const MODULE_ACCESS: Record<ModuleKey, Role[]> = {
  hrm: ["owner", "admin", "hr"],
  payroll: ["owner", "admin", "hr", "finance"],
  crm: ["owner", "admin", "sales"],
  helpdesk: ["owner", "admin", "sales", "member"],
  finance: ["owner", "admin", "finance"],
  inventory: ["owner", "admin", "finance", "sales"],
  projects: ["owner", "admin", "hr", "sales", "finance", "member"],
  analytics: ["owner", "admin", "finance"],
};

export function roleCanUse(role: Role, mod: ModuleKey) {
  return MODULE_ACCESS[mod].includes(role);
}

export function canManage(role: Role) {
  return role === "owner" || role === "admin";
}

export const INVITABLE_ROLES: Role[] = ["admin", "hr", "sales", "finance", "member"];
