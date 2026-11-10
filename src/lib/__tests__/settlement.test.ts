import assert from "node:assert/strict";
import { test } from "node:test";
import { uaeGratuity } from "../payroll-ae";
import { computeSettlement, serviceDaysBetween } from "../settlement";

const R = 100;
const split = { basic: 0.6, housing: 0.25, transport: 0.1, other: 0.05 };

function consistent(r: ReturnType<typeof computeSettlement>) {
  const e = r.lines.filter((l) => l.kind === "earning").reduce((a, l) => a + l.amount, 0);
  const d = r.lines.filter((l) => l.kind === "deduction").reduce((a, l) => a + l.amount, 0);
  assert.equal(e, r.totalEarnings);
  assert.equal(d, r.totalDeductions);
  assert.equal(r.netPayable, e - d);
}

test("service days are inclusive", () => {
  assert.equal(serviceDaysBetween("2024-01-01", "2024-01-01"), 1);
  assert.equal(serviceDaysBetween("2020-01-01", "2024-12-31"), 1827);
});

test("India: 5 years — gratuity 15/26, leave ÷ 26, full final month", () => {
  const r = computeSettlement({ country: "IN", joinDate: "2020-01-01", exitDate: "2024-12-31", annualCtc: 12_00_000 * R, unpaidDays: 31, leaveDays: 10 });
  assert.equal(r.serviceDays, 1827);
  assert.equal(r.monthlyBasic, 50_000 * R);
  assert.equal(r.pendingSalary, 1_00_000 * R);
  assert.equal(r.leaveEncashment, Math.round((50_000 * R * 10) / 26));
  assert.equal(r.gratuity, Math.round((50_000 * R * 15 * 5) / 26));
  assert.equal(r.loanRecovery, 0);
  consistent(r);
});

test("India: under 5 years — no gratuity", () => {
  const r = computeSettlement({ country: "IN", joinDate: "2022-01-01", exitDate: "2026-06-15", annualCtc: 6_00_000 * R, unpaidDays: 15, leaveDays: 0 });
  assert.equal(r.gratuity, 0);
  assert.match(r.lines.find((l) => l.code === "gratuity")!.note, /less than 5 years/);
  assert.equal(r.pendingSalary, 25_000 * R); // ₹50,000 ÷ 30 days (June) × 15
  consistent(r);
});

test("India: gratuity capped at ₹20 lakh", () => {
  const r = computeSettlement({ country: "IN", joinDate: "1990-01-01", exitDate: "2025-12-31", annualCtc: 1_20_00_000 * R, unpaidDays: 0, leaveDays: 0 });
  assert.equal(r.gratuity, 20_00_000 * R);
});

test("UAE: under 1 year — no gratuity, leave ÷ 30", () => {
  const r = computeSettlement({ country: "AE", joinDate: "2026-01-01", exitDate: "2026-10-31", annualCtc: 120_000 * R, defaultSplit: split, nationality: "IN", unpaidDays: 31, leaveDays: 10 });
  assert.equal(r.monthlyGross, 10_000 * R);
  assert.equal(r.monthlyBasic, 6_000 * R);
  assert.equal(r.gratuity, 0);
  assert.equal(r.leaveEncashment, 2_000 * R);
  assert.equal(r.pendingSalary, 10_000 * R);
  consistent(r);
});

test("UAE: 3 years expat — Art. 51 gratuity on basic", () => {
  const r = computeSettlement({ country: "AE", joinDate: "2023-01-01", exitDate: "2025-12-31", annualCtc: 120_000 * R, defaultSplit: split, nationality: "IN", unpaidDays: 0, leaveDays: 0 });
  assert.equal(r.serviceDays, 1096);
  assert.equal(r.gratuity, uaeGratuity(6_000 * R, 1096).amount);
  assert.ok(Math.abs(r.gratuity - Math.round((1096 / 365) * 21 * 200 * R)) <= 1);
  consistent(r);
});

test("UAE: component override drives basic", () => {
  const r = computeSettlement({
    country: "AE",
    joinDate: "2020-01-01",
    exitDate: "2025-12-31",
    annualCtc: 0,
    salaryComponents: JSON.stringify({ basic: 9_000 * R, housing: 3_750 * R, transport: 1_500 * R, other: 750 * R }),
    defaultSplit: split,
    nationality: "PK",
    unpaidDays: 0,
    leaveDays: 30,
  });
  assert.equal(r.monthlyGross, 15_000 * R);
  assert.equal(r.leaveEncashment, 9_000 * R);
  assert.equal(r.gratuity, uaeGratuity(9_000 * R, r.serviceDays).amount);
});

test("UAE national — no gratuity (GPSSA)", () => {
  const r = computeSettlement({ country: "AE", joinDate: "2015-01-01", exitDate: "2025-12-31", annualCtc: 300_000 * R, defaultSplit: split, nationality: "AE", unpaidDays: 0, leaveDays: 5 });
  assert.equal(r.gratuity, 0);
  assert.match(r.lines.find((l) => l.code === "gratuity")!.note, /GPSSA/);
  assert.ok(r.leaveEncashment > 0);
});

test("loan recovery exceeding dues → negative net, recoverable from employee", () => {
  const r = computeSettlement({ country: "AE", joinDate: "2026-06-01", exitDate: "2026-10-05", annualCtc: 120_000 * R, defaultSplit: split, unpaidDays: 5, leaveDays: 0, loanBalance: 5_000 * R, otherDeductions: 100 * R });
  assert.equal(r.pendingSalary, Math.round(((10_000 * R) / 31) * 5));
  assert.equal(r.loanRecovery, 5_000 * R);
  assert.equal(r.netPayable, r.pendingSalary - 5_100 * R);
  assert.ok(r.netPayable < 0);
  assert.ok(r.notes.some((n) => /recoverable from the employee/.test(n)));
  consistent(r);
});

test("unpaid days clamp to the exit month; negative inputs ignored", () => {
  const r = computeSettlement({ country: "IN", joinDate: "2024-01-01", exitDate: "2025-02-10", annualCtc: 12_00_000 * R, unpaidDays: 40, leaveDays: -3, otherEarnings: -5 });
  assert.equal(r.pendingSalary, 1_00_000 * R);
  assert.equal(r.leaveEncashment, 0);
  assert.equal(r.otherEarnings, 0);
});
