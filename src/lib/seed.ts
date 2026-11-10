import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "./activity";
import { defaultTaxRate, packOf, type CountryCode } from "./countries";
import { postJournal } from "./ledger";
import { initOrgDefaults } from "./org";
import { createDraftInvoice, recordPayment, sendInvoice } from "./posting";
import { seedCrm } from "./seed/crm";
import { seedFinance } from "./seed/finance";
import { seedHelpdesk } from "./seed/helpdesk";
import { seedHrm } from "./seed/hrm";
import { seedInventory } from "./seed/inventory";
import { seedPayroll } from "./seed/payroll";
import { seedProjects } from "./seed/projects";

const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(new Date());

function monthDay(monthsAgo: number, day: number) {
  const t = todayYmd();
  const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 - monthsAgo, day));
  return d.toISOString().slice(0, 10);
}

async function packFor(orgId: number) {
  const [org] = await db.select({ country: schema.organizations.country }).from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  return packOf(org ?? {});
}

// Minor units per country.
const OPENING_CAPITAL: Record<CountryCode, number> = { IN: 45_00_000_00, AE: 1_200_000_00 };
// Major units per country.
const RETAINER_PLAN: Record<CountryCode, { monthsAgo: number; amounts: number[] }[]> = {
  IN: [
    { monthsAgo: 3, amounts: [12_50_000, 9_00_000] },
    { monthsAgo: 2, amounts: [12_50_000, 9_00_000, 4_50_000] },
    { monthsAgo: 1, amounts: [14_00_000, 9_00_000, 5_00_000] },
    { monthsAgo: 0, amounts: [14_00_000, 9_50_000] },
  ],
  AE: [
    { monthsAgo: 3, amounts: [125_000, 90_000] },
    { monthsAgo: 2, amounts: [125_000, 90_000, 45_000] },
    { monthsAgo: 1, amounts: [140_000, 90_000, 50_000] },
    { monthsAgo: 0, amounts: [140_000, 95_000] },
  ],
};
const TRANSFER_REF: Record<CountryCode, string> = { IN: "NEFT", AE: "FT" };

/** Opening capital, so the demo bank balance reflects a funded company. */
async function seedOpeningBalance(ctx: Ctx) {
  const capital = OPENING_CAPITAL[(await packFor(ctx.orgId)).code];
  await postJournal(ctx, {
    date: monthDay(4, 1),
    memo: "Opening balance — founders' capital",
    sourceType: "manual",
    lines: [
      { key: "bank", debit: capital },
      { key: "equity", credit: capital },
    ],
  });
}

/** Monthly service retainers sized for a ~17-person company, billed and collected through the normal posting flow. */
async function seedRetainerRevenue(ctx: Ctx) {
  const companies = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.orgId, ctx.orgId))
    .orderBy(asc(schema.companies.id))
    .limit(3);
  if (!companies.length) return;
  const pack = await packFor(ctx.orgId);
  const tax = pack.code === "IN" ? { taxRate: 18 } : { taxRate: defaultTaxRate(pack), taxCode: pack.tax.defaultCode };
  const today = todayYmd();
  for (const month of RETAINER_PLAN[pack.code]) {
    for (const [i, major] of month.amounts.entries()) {
      const c = companies[i % companies.length];
      const issueDate = monthDay(month.monthsAgo, 2 + i);
      if (issueDate > today) continue;
      const inv = await createDraftInvoice(
        ctx,
        {
          companyId: c.id,
          customerName: c.name,
          billingAddress: c.billingAddress,
          customerGstin: c.gstin,
          placeOfSupply: c.state,
          issueDate,
          notes: "Monthly managed-services retainer.",
        },
        [{ description: `Managed services retainer — ${new Date(`${issueDate}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`, quantity: 1, unitPrice: major * 100, ...tax }],
      );
      await sendInvoice(ctx, inv.id);
      const payDate = monthDay(month.monthsAgo, 16 + i);
      if (payDate <= today) {
        const [row] = await db.select({ total: schema.invoices.total }).from(schema.invoices).where(eq(schema.invoices.id, inv.id));
        await recordPayment(ctx, inv.id, { date: payDate, amount: row.total, method: "bank_transfer", reference: `${TRANSFER_REF[pack.code]}-${inv.number}` });
      }
    }
  }
}

/**
 * Fill an empty workspace with realistic, interconnected demo data.
 * Order matters: later modules reference earlier ones (employees → payroll, companies → invoices, products → POs/invoices).
 * Idempotent: does nothing if the workspace already has employees.
 */
export async function seedWorkspace(ctx: Ctx) {
  const existing = await db.$count(schema.employees, eq(schema.employees.orgId, ctx.orgId));
  if (existing > 0) return;
  await initOrgDefaults(ctx.orgId);
  await seedOpeningBalance(ctx);
  await seedHrm(ctx);
  await seedCrm(ctx);
  await seedInventory(ctx);
  await seedFinance(ctx);
  await seedRetainerRevenue(ctx);
  await seedProjects(ctx);
  await seedPayroll(ctx);
  await seedHelpdesk(ctx);
}
