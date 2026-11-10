import assert from "node:assert/strict";
import { test } from "node:test";
import { annualTax, computeIndiaPayslip, indiaGratuity, lopAndPaidDays } from "../payroll";
import { computeUaePayroll, gpssaContribution, uaeComponents, uaeGratuity } from "../payroll-ae";
import { sumLines } from "../payroll-types";

const R = 100; // rupee / dirham in minor units
const split = { basic: 0.6, housing: 0.25, transport: 0.1, other: 0.05 };

function balanced(b: { earnings: { amount: number }[]; deductions: { amount: number }[] }, net: number) {
  assert.equal(sumLines(b.earnings) - sumLines(b.deductions), net);
}

test("India: ₹12L CTC, metro, PF — no TDS under 87A rebate", () => {
  const p = computeIndiaPayslip({ annualCtc: 12_00_000 * R, pfEnrolled: true, metro: true, daysInMonth: 30, paidDays: 30 });
  assert.equal(p.basic, 50_000 * R);
  assert.equal(p.hra, 25_000 * R);
  assert.equal(p.gross, 1_00_000 * R);
  assert.equal(p.pfEmployee, 1_800 * R);
  assert.equal(p.esiEmployee, 0);
  assert.equal(p.professionalTax, 200 * R);
  assert.equal(p.tds, 0);
  assert.equal(p.net, 98_000 * R);
  balanced(p.breakdown, p.net);
});

test("India: claims and loan recovery flow through net but not gross/TDS", () => {
  const p = computeIndiaPayslip({ annualCtc: 24_00_000 * R, pfEnrolled: true, metro: false, daysInMonth: 30, paidDays: 30, reimbursements: 5_000 * R, loanDeduction: 3_000 * R });
  const plain = computeIndiaPayslip({ annualCtc: 24_00_000 * R, pfEnrolled: true, metro: false, daysInMonth: 30, paidDays: 30 });
  assert.equal(p.gross, plain.gross);
  assert.equal(p.tds, plain.tds);
  assert.equal(p.net, plain.net + 2_000 * R);
  balanced(p.breakdown, p.net);
});

test("India: new-regime tax on ₹24L gross", () => {
  // taxable 23.25L: 0 + 20k + 40k + 60k + 80k + 25%×3.25L = 2,81,250 → +4% cess
  assert.equal(annualTax(24_00_000 * R), Math.round(2_81_250 * R * 1.04));
});

test("India: LOP from absences and unpaid leave", () => {
  const d = lopAndPaidDays({
    period: "2026-06",
    joinDate: "2025-01-01",
    attendance: [
      { date: "2026-06-02", status: "absent" },
      { date: "2026-06-03", status: "half_day" },
      { date: "2026-06-04", status: "leave", unpaidLeave: true },
      { date: "2026-06-05", status: "leave", unpaidLeave: true, halfLeave: true },
    ],
  });
  assert.deepEqual(d, { paidDays: 27, lopDays: 3, daysInMonth: 30 });
});

test("India gratuity: 5 yrs 7 months rounds to 6 years; under 5 years is nil", () => {
  assert.equal(indiaGratuity(50_000 * R, 5 * 365 + 213).amount, Math.round((50_000 * R * 15 * 6) / 26));
  assert.equal(indiaGratuity(50_000 * R, 4 * 365 + 300).amount, 0);
  assert.equal(indiaGratuity(10_00_000 * R, 30 * 365).amount, 20_00_000 * R);
});

test("UAE: expat — no tax, no pension, gratuity accrues 21 days/yr", () => {
  const c = uaeComponents(120_000 * R, null, split);
  assert.deepEqual(c, { basic: 6_000 * R, housing: 2_500 * R, transport: 1_000 * R, other: 500 * R });
  const p = computeUaePayroll({ components: c, uaeNational: false, daysInMonth: 30, paidDays: 30, serviceDaysAtPeriodEnd: 400, employedDays: 30 });
  assert.equal(p.gross, 10_000 * R);
  assert.equal(p.totalDeductions, 0);
  assert.equal(p.net, 10_000 * R);
  assert.equal(p.gratuityAccrual, 350 * R); // 6000/30 × 21 / 12
  assert.equal(p.employerCost, 10_350 * R);
  balanced(p.breakdown, p.net);
});

test("UAE: expat beyond 5 years accrues 30 days/yr", () => {
  const c = uaeComponents(120_000 * R, null, split);
  const p = computeUaePayroll({ components: c, uaeNational: false, daysInMonth: 30, paidDays: 30, serviceDaysAtPeriodEnd: 6 * 365, employedDays: 30 });
  assert.equal(p.gratuityAccrual, 500 * R);
});

test("UAE: national — GPSSA 11% / 12.5%, 15% at AED 20k+, floor 3k, cap 70k", () => {
  assert.deepEqual(gpssaContribution(10_000 * R), { base: 10_000 * R, employee: 1_100 * R, employer: 1_250 * R });
  assert.deepEqual(gpssaContribution(25_000 * R), { base: 25_000 * R, employee: 2_750 * R, employer: 3_750 * R });
  assert.equal(gpssaContribution(2_000 * R).base, 3_000 * R);
  assert.equal(gpssaContribution(90_000 * R).base, 70_000 * R);
  const p = computeUaePayroll({ components: uaeComponents(120_000 * R, null, split), uaeNational: true, daysInMonth: 30, paidDays: 15, serviceDaysAtPeriodEnd: 400, employedDays: 30 });
  assert.equal(p.gross, 5_000 * R); // half month unpaid
  assert.equal(p.pensionEmployee, 1_100 * R); // contribution salary isn't prorated
  assert.equal(p.gratuityAccrual, 0);
  balanced(p.breakdown, p.net);
});

test("UAE: explicit component override wins over the default split", () => {
  assert.deepEqual(uaeComponents(0, { basic: 9_000 * R, housing: 3_000 * R }, split), { basic: 9_000 * R, housing: 3_000 * R, transport: 0, other: 0 });
});

test("UAE gratuity: <1yr nil; 21 days ×5 + 30 days after; capped at 2 years' basic", () => {
  assert.equal(uaeGratuity(6_000 * R, 300).amount, 0);
  assert.equal(uaeGratuity(6_000 * R, 3 * 365).amount, 12_600 * R);
  assert.equal(uaeGratuity(6_000 * R, 7 * 365).amount, 33_000 * R);
  assert.equal(uaeGratuity(6_000 * R, 30 * 365).amount, 144_000 * R);
});
