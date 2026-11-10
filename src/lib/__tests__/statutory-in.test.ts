import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEcr, buildEsi, buildTaxStatement, ecrLine, fyOf, fyPeriods, type EcrInput, type EsiInput } from "../statutory-in";
import type { PayslipBreakdown } from "../payroll-types";

const bd = (basic: number, pf: number, pfEr: number, esi = 0, tds = 0, pt = 0): PayslipBreakdown => ({
  earnings: [
    { code: "basic", label: "Basic", amount: basic },
    { code: "hra", label: "HRA", amount: basic / 2 },
    { code: "reimbursement", label: "Reimb", amount: 99_900 },
  ],
  deductions: [
    { code: "pf", label: "PF", amount: pf, account: "pf_payable" },
    { code: "esi", label: "ESI", amount: esi, account: "esi_payable" },
    { code: "pt", label: "PT", amount: pt, account: "pt_payable" },
    { code: "tds", label: "TDS", amount: tds, account: "tds_payable" },
  ],
  employer: [{ code: "pf_employer", label: "PF", amount: pfEr, expenseAccount: "employer_contrib", liabilityAccount: "pf_payable" }],
});

const slip = (over: Partial<EcrInput> = {}): EcrInput => ({
  employeeId: 1,
  code: "EMP-1",
  name: "Asha K. Rao",
  uan: "100123456789",
  gross: 5_000_050,
  paidDays: 28,
  lopDays: 2,
  breakdown: bd(2_500_000, 180_000, 180_000),
  ...over,
});

test("ECR line: field order, EPS cap, difference, NCP, whole rupees", () => {
  // basic ₹25,000 → EPF wages capped ₹15,000; EPS = 15000×8.33% = 1250; PF 1800; diff 550
  const l = ecrLine(slip());
  assert.equal(l.text, "100123456789#~#ASHA K RAO#~#50001#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#2#~#0");
});

test("ECR line: wages below cap use actual basic", () => {
  const l = ecrLine(slip({ breakdown: bd(1_000_000, 120_000, 120_000) }));
  assert.deepEqual(l.fields.slice(3, 9), ["10000", "10000", "10000", "1200", "833", "367"]);
});

test("ECR excludes missing/invalid UAN and non-PF employees", () => {
  const r = buildEcr([slip(), slip({ code: "EMP-2", uan: null }), slip({ code: "EMP-3", uan: "12" }), slip({ code: "EMP-4", breakdown: bd(2_500_000, 0, 0) })]);
  assert.equal(r.count, 1);
  assert.deepEqual(r.missingUan.map((m) => m.code), ["EMP-2", "EMP-3"]);
  assert.equal(r.content.split("\n").length, 1);
});

test("ESI rows: only ESI deducted, flags missing IP, exit handling", () => {
  const a = slip({ breakdown: bd(1_000_000, 120_000, 120_000, 9_000), gross: 1_800_000, paidDays: 30 });
  const b: EsiInput = { ...slip({ code: "EMP-2", name: 'Bo, "B"', breakdown: bd(1_000_000, 0, 0, 9_000), paidDays: 10 }), exitDate: "2026-04-10" };
  const c = slip({ code: "EMP-3" });
  const r = buildEsi([{ ...a, ipNumber: "1234567890" }, b, c], "2026-04");
  assert.equal(r.count, 2);
  assert.deepEqual(r.missingIp.map((m) => m.code), ["EMP-2"]);
  const lines = r.content.trim().split("\r\n");
  assert.equal(lines[1], "1234567890,Asha K. Rao" + ",30,18000,0,");
  assert.equal(lines[2], ',"Bo, ""B""",10,50001,2,10/04/2026');
});

test("tax statement: components, TDS by month, engine tax, reimbursements excluded", () => {
  const month = (period: string, tds: number) => ({ period, gross: 15_000_000, breakdown: bd(5_000_000, 0, 0, 0, tds, 20_000) });
  const slips = Array.from({ length: 12 }, (_, i) => month(fyPeriods(2026)[i], 100_000));
  const s = buildTaxStatement(slips.reverse());
  assert.equal(s.months[0].period, "2026-04");
  assert.equal(s.gross, 180_000_000);
  assert.equal(s.components.find((c) => c.code === "basic")?.amount, 60_000_000);
  assert.equal(s.components.some((c) => c.code === "reimbursement"), false);
  assert.equal(s.professionalTax, 240_000);
  assert.equal(s.taxableIncome, 180_000_000 - 7_500_000);
  assert.equal(s.tdsDeducted, 1_200_000);
  assert.equal(s.balance, s.taxComputed - s.tdsDeducted);
  assert.ok(s.taxComputed > 0);
});

test("fiscal year helpers", () => {
  assert.equal(fyOf("2026-03-31"), 2025);
  assert.equal(fyOf("2026-04-01"), 2026);
  assert.deepEqual([fyPeriods(2026)[0], fyPeriods(2026)[11]], ["2026-04", "2027-03"]);
});
