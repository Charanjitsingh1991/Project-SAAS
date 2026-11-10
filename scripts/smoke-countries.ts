/**
 * End-to-end smoke test for India and UAE workspaces against a throwaway database.
 *   cp local.db /tmp/smoke.db && DATABASE_URL=file:/tmp/smoke.db npx tsx --conditions=react-server scripts/smoke-countries.ts
 * Creates a workspace per country, checks country defaults, then runs payroll (with a claim and a loan) through payment
 * and verifies the ledger stays balanced and the payables match the payslips.
 */
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { COUNTRIES } from "@/lib/countries";
import { createOrganization } from "@/lib/org";
import { approvePayrollRun, createPayrollRun, payPayrollRun } from "@/lib/payroll-data";
import { approveClaim, disburseLoan } from "@/lib/posting";
import { parseBreakdown } from "@/lib/payroll-types";

const R = 100;
const PERIOD = "2026-10";

async function balances(orgId: number) {
  const rows = await db
    .select({ key: schema.accounts.systemKey, dr: sql<number>`coalesce(sum(${schema.journalLines.debit}),0)`, cr: sql<number>`coalesce(sum(${schema.journalLines.credit}),0)` })
    .from(schema.journalLines)
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(eq(schema.journalLines.orgId, orgId))
    .groupBy(schema.accounts.systemKey);
  return new Map(rows.map((r) => [r.key ?? "", Number(r.dr) - Number(r.cr)]));
}

async function run(country: "IN" | "AE") {
  const email = `smoke-${country.toLowerCase()}-${Date.now()}@example.com`;
  const [u] = await db.insert(schema.users).values({ name: `Smoke ${country}`, email, passwordHash: "x" }).returning({ id: schema.users.id });
  const orgId = await createOrganization(u.id, `Smoke ${country} ${Date.now()}`, { country, phone: country === "AE" ? "+971501234567" : "+919876543210" });
  const ctx = { orgId, userId: u.id };
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));

  // Country defaults
  assert.equal(org.currency, country === "AE" ? "AED" : "INR");
  assert.equal(org.fiscalYearStart, country === "AE" ? 1 : 4);
  assert.deepEqual(JSON.parse(org.weekendDays ?? "[]"), COUNTRIES[country].weekendDays);
  const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.orgId, orgId));
  const names = new Map(accounts.map((a) => [a.systemKey, a.name]));
  assert.equal(names.get("gst_out"), country === "AE" ? "VAT payable" : "GST payable");
  assert.equal(names.has("pension_payable"), country === "AE");
  assert.equal(names.has("tds_payable"), country === "IN");
  const leave = await db.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.orgId, orgId));
  const hols = await db.$count(schema.holidays, eq(schema.holidays.orgId, orgId));
  assert.ok(leave.length >= 4 && hols > 0);

  // Employees
  const base = { orgId, designation: "Engineer", joinDate: "2024-01-15", gender: "female" as const };
  const emps =
    country === "AE"
      ? [
          { ...base, code: "EMP-0001", name: "Expat One", annualCtc: 120_000 * R, nationality: "IN", wpsPersonId: "10012345678901", iban: "AE070331234567890123456", bankRoutingCode: "302620122" },
          { ...base, code: "EMP-0002", name: "National Two", annualCtc: 300_000 * R, nationality: "AE", wpsPersonId: "10012345678902", iban: "AE070331234567890123457", bankRoutingCode: "302620122" },
        ]
      : [{ ...base, code: "EMP-0001", name: "India One", annualCtc: 12_00_000 * R, pfEnrolled: true, metro: true }];
  const ids = await db.insert(schema.employees).values(emps).returning({ id: schema.employees.id });

  // A payroll-route claim and a salary advance for the first employee
  const [claim] = await db
    .insert(schema.expenseClaims)
    .values({ orgId, employeeId: ids[0].id, date: `${PERIOD}-05`, category: "travel", description: "Taxi", amount: 1_000 * R, taxAmount: 50 * R, total: 1_050 * R })
    .returning({ id: schema.expenseClaims.id });
  assert.equal(await approveClaim(ctx, claim.id, `${PERIOD}-06`), null);
  const [loan] = await db
    .insert(schema.employeeLoans)
    .values({ orgId, employeeId: ids[0].id, type: "advance", principal: 3_000 * R, monthlyInstallment: 1_000 * R, balance: 3_000 * R, disbursedOn: `${PERIOD}-01`, startPeriod: PERIOD })
    .returning({ id: schema.employeeLoans.id });
  assert.equal(await disburseLoan(ctx, loan.id), null);

  // Payroll
  const res = await createPayrollRun(ctx, PERIOD);
  assert.ok("runId" in res, JSON.stringify(res));
  const slips = await db.select().from(schema.payslips).where(eq(schema.payslips.runId, res.runId));
  for (const s of slips) assert.ok(parseBreakdown(s.breakdown), "breakdown stored");
  const first = slips.find((s) => s.employeeId === ids[0].id)!;
  assert.equal(first.reimbursements, 1_050 * R);
  assert.equal(first.loanDeduction, 1_000 * R);
  const [claimRow] = await db.select().from(schema.expenseClaims).where(eq(schema.expenseClaims.id, claim.id));
  assert.equal(claimRow.payslipId, first.id);

  if (country === "AE") {
    const national = slips.find((s) => s.employeeId === ids[1].id)!;
    assert.equal(first.tds, 0);
    assert.equal(first.pensionEmployee, 0);
    assert.ok(first.gratuityAccrual > 0, "expat gratuity accrues");
    assert.equal(national.pensionEmployee, 2_750 * R); // 11% of AED 25,000
    assert.equal(national.pensionEmployer, 3_750 * R); // 15% at ≥ AED 20,000
    assert.equal(national.gratuityAccrual, 0);
  } else {
    assert.equal(first.pfEmployee, 1_800 * R);
    assert.equal(first.professionalTax, 200 * R);
  }

  assert.equal(await approvePayrollRun(ctx, res.runId), null);
  assert.equal(await payPayrollRun(ctx, res.runId, `${PERIOD}-28`), null);

  // Ledger: balanced, payables match payslips
  const bal = await balances(orgId);
  const total = [...bal.values()].reduce((s, v) => s + v, 0);
  assert.equal(total, 0, "trial balance nets to zero");
  assert.equal(bal.get("reimb_payable") ?? 0, 0, "claim payable cleared by payroll");
  assert.equal(bal.get("advances"), 2_000 * R, "advance reduced by one installment");
  const sum = (f: (s: (typeof slips)[number]) => number) => slips.reduce((t, s) => t + f(s), 0);
  if (country === "AE") {
    assert.equal(-(bal.get("pension_payable") ?? 0), sum((s) => s.pensionEmployee + s.pensionEmployer));
    assert.equal(-(bal.get("gratuity_provision") ?? 0), sum((s) => s.gratuityAccrual));
  } else {
    assert.equal(-(bal.get("pf_payable") ?? 0), sum((s) => s.pfEmployee + s.pfEmployer + s.esiEmployee + s.esiEmployer));
    assert.equal(-(bal.get("pt_payable") ?? 0), sum((s) => s.professionalTax));
  }
  const [loanRow] = await db.select().from(schema.employeeLoans).where(and(eq(schema.employeeLoans.id, loan.id)));
  assert.equal(loanRow.balance, 2_000 * R);
  const [claimAfter] = await db.select().from(schema.expenseClaims).where(eq(schema.expenseClaims.id, claim.id));
  assert.equal(claimAfter.status, "reimbursed");

  console.log(`✔ ${country}: defaults, payroll (${slips.length} slips), claim, advance, ledger balanced`);
}

run("IN")
  .then(() => run("AE"))
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
