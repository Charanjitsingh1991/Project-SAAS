import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { COUNTRIES } from "@/lib/countries";
import { addDaysYmd, todayYmd } from "@/lib/format";
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
  const [slip] = await db.select({ t: sql<number>`sum(net)` }).from(schema.payslips).where(eq(schema.payslips.orgId, orgId));
  console.log(JSON.stringify({ orgId, counts, dr: tb.dr, cr: tb.cr, invTotal: inv.t, expTotal: exp.t, netPay: slip.t }));
  assert.equal(Number(tb.dr), Number(tb.cr), "trial balance nets to zero");
  if (country === "AE") {
    const pack = COUNTRIES.AE;
    const gstinRe = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9]{2}$/;
    const trnRe = new RegExp(pack.tax.idPattern);
    const indian = new Set([...COUNTRIES.IN.regions, "Bengaluru", "Mumbai", "Delhi", "India"]);
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    assert.equal(org.currency, "AED");
    assert.ok(!org.gstin || trnRe.test(org.gstin), "org TRN");
    assert.ok(!org.state || pack.regions.includes(org.state), "org emirate");
    const companies = await db.select().from(schema.companies).where(eq(schema.companies.orgId, orgId));
    const vendors = await db.select().from(schema.vendors).where(eq(schema.vendors.orgId, orgId));
    for (const c of companies) {
      assert.ok(!c.gstin || trnRe.test(c.gstin), `company TRN ${c.gstin}`);
      assert.ok(!indian.has(c.state ?? "") && !indian.has(c.country ?? ""), `company region ${c.state}`);
      if (c.country === "United Arab Emirates") assert.ok(pack.regions.includes(c.state!) && c.phone?.startsWith("+971"), c.name);
    }
    for (const v of vendors) assert.ok(v.gstin && trnRe.test(v.gstin) && !gstinRe.test(v.gstin) && v.phone?.startsWith("+971"), `vendor ${v.name}`);
    const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.orgId, orgId));
    for (const i of invoices) {
      assert.ok(!i.placeOfSupply || pack.regions.includes(i.placeOfSupply), `pos ${i.placeOfSupply}`);
      assert.ok(!i.customerGstin || trnRe.test(i.customerGstin), `inv trn ${i.customerGstin}`);
    }
    const lines = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.orgId, orgId));
    const codes = new Set(pack.tax.rates.map((r) => r.code));
    for (const l of lines) assert.ok(l.taxCode && codes.has(l.taxCode) && [0, 5].includes(l.taxRate), `line code ${l.taxCode} ${l.taxRate}`);
    assert.ok(lines.some((l) => l.taxCode === "ZR"), "has a zero-rated line");
    const products = await db.select().from(schema.products).where(eq(schema.products.orgId, orgId));
    for (const p of products) assert.ok(p.taxRate === 5 && p.sellingPrice < 200_000, `product ${p.name}`);
    const emps = await db.select().from(schema.employees).where(eq(schema.employees.orgId, orgId));
    assert.ok(emps.filter((e) => e.nationality === "AE").length >= 1);
    const soon = addDaysYmd(todayYmd(), 60);
    assert.ok(emps.some((e) => e.visaExpiry && e.visaExpiry <= soon), "a visa expiring within 60 days");
    for (const e of emps) {
      assert.ok(e.phone?.startsWith("+971") && !e.pan && !e.ifsc && !e.uan && !e.pfEnrolled, `emp india fields ${e.name}`);
      assert.ok(e.emiratesId && new RegExp(pack.hr.employeeFields.find((f) => f.key === "emiratesId")!.pattern!).test(e.emiratesId), `eid ${e.emiratesId}`);
      assert.ok(e.iban && /^AE\d{21}$/.test(e.iban) && e.bankName && /^\d{9}$/.test(e.bankRoutingCode ?? ""), `bank ${e.iban}`);
      assert.ok(!e.wpsPersonId || /^\d{14}$/.test(e.wpsPersonId), `wps ${e.wpsPersonId}`);
      assert.ok(e.passportNumber && e.passportExpiry, "passport");
      const comp = JSON.parse(e.salaryComponents ?? "{}");
      const sum = comp.basic + comp.housing + comp.transport + comp.other;
      assert.equal(sum * 12, e.annualCtc, `ctc ${e.name}`);
      if (e.nationality !== "AE" && e.employmentType !== "contract") assert.ok(e.visaNumber && e.visaExpiry && e.labourCardNumber && e.wpsPersonId, `permit ${e.name}`);
    }
    const slips = await db.select().from(schema.payslips).where(eq(schema.payslips.orgId, orgId));
    assert.ok(slips.length > 0);
    for (const s of slips) assert.ok(s.pfEmployee === 0 && s.pfEmployer === 0 && s.tds === 0 && s.professionalTax === 0, "no PF/TDS/PT");
    assert.ok(slips.some((s) => s.pensionEmployee > 0) && slips.some((s) => s.gratuityAccrual > 0), "GPSSA + gratuity");
    const tickets = await db.select().from(schema.tickets).where(eq(schema.tickets.orgId, orgId));
    assert.ok(!tickets.some((t) => /GST/.test(t.subject + t.description)), "no GST in tickets");
    const acct = await db.select().from(schema.accounts).where(eq(schema.accounts.orgId, orgId));
    const dump = JSON.stringify({ companies, vendors, invoices, lines, emps: emps.map((e) => [e.address, e.workLocation, e.phone]) });
    for (const w of ["₹", "Karnataka", "Maharashtra", "Bengaluru", "+91 ", "NEFT", "GSTIN"]) assert.ok(!dump.includes(w), `found ${w}`);
    console.log("AE sample:", { emp: emps[3].name, nat: emps[3].nationality, eid: emps[3].emiratesId, iban: emps[3].iban, comp: emps[3].salaryComponents, ctc: emps[3].annualCtc, accounts: acct.length });
  }
  console.log(`✔ ${country} assertions passed`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
