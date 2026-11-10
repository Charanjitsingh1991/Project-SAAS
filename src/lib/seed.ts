import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "./activity";
import { initOrgDefaults } from "./org";
import { seedCrm } from "./seed/crm";
import { seedFinance } from "./seed/finance";
import { seedHelpdesk } from "./seed/helpdesk";
import { seedHrm } from "./seed/hrm";
import { seedInventory } from "./seed/inventory";
import { seedPayroll } from "./seed/payroll";
import { seedProjects } from "./seed/projects";

/**
 * Fill an empty workspace with realistic, interconnected demo data.
 * Order matters: later modules reference earlier ones (employees → payroll, companies → invoices, products → POs/invoices).
 * Idempotent: does nothing if the workspace already has employees.
 */
export async function seedWorkspace(ctx: Ctx) {
  const existing = await db.$count(schema.employees, eq(schema.employees.orgId, ctx.orgId));
  if (existing > 0) return;
  await initOrgDefaults(ctx.orgId);
  await seedHrm(ctx);
  await seedCrm(ctx);
  await seedInventory(ctx);
  await seedFinance(ctx);
  await seedProjects(ctx);
  await seedPayroll(ctx);
  await seedHelpdesk(ctx);
}
