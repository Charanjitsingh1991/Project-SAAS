import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { createOrganization } from "@/lib/org";
import { seedWorkspace } from "@/lib/seed";

const country = (process.argv[2] ?? "IN") as "IN" | "AE";
const TABLES = ["employees", "departments", "holidays", "attendance", "leaveRequests", "companies", "contacts", "deals", "crmActivities", "vendors", "products", "stockMovements", "purchaseOrders", "invoices", "invoiceLines", "expenses", "payrollRuns", "payslips", "journalLines", "projects", "tasks", "tickets", "quotes"];

async function main() {
  const email = `seed-${country}-${Date.now()}@example.com`;
  const [u] = await db.insert(schema.users).values({ name: "Seed Owner", email, passwordHash: "x" }).returning({ id: schema.users.id });
  const orgId = await createOrganization(u.id, `Seed ${country} ${Date.now()}`, { country, phone: country === "AE" ? "+971501234567" : "+919876543210" });
  await seedWorkspace({ orgId, userId: u.id });
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tb = (schema as any)[t];
    if (tb?.orgId) counts[t] = await db.$count(tb, eq(tb.orgId, orgId));
  }
  const [tb] = await db.select({ dr: sql<number>`coalesce(sum(debit),0)`, cr: sql<number>`coalesce(sum(credit),0)` }).from(schema.journalLines).where(eq(schema.journalLines.orgId, orgId));
  const [inv] = await db.select({ t: sql<number>`sum(total)` }).from(schema.invoices).where(eq(schema.invoices.orgId, orgId));
  const [exp] = await db.select({ t: sql<number>`sum(total)` }).from(schema.expenses).where(eq(schema.expenses.orgId, orgId));
  const [slip] = await db.select({ t: sql<number>`sum(net_pay)` }).from(schema.payslips).where(eq(schema.payslips.orgId, orgId));
  console.log(JSON.stringify({ orgId, counts, dr: tb.dr, cr: tb.cr, invTotal: inv.t, expTotal: exp.t, netPay: slip.t }));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
