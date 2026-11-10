import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COUNTRIES } from "../countries";
import {
  claimTotals,
  countLeaveDays,
  expiryAlerts,
  isWeekend,
  maskId,
  packageFromComponents,
  parseClaim,
  parseEmployeeFields,
  parseSalaryComponents,
  workingDates,
} from "../hrm";
import { uaeComponents } from "../payroll-ae";

const IN = COUNTRIES.IN;
const AE = COUNTRIES.AE;
const NONE = new Set<string>();

describe("weekends", () => {
  // 2026-11-06 is a Friday, 2026-11-07 Saturday, 2026-11-08 Sunday.
  it("defaults to Saturday + Sunday", () => {
    assert.equal(isWeekend("2026-11-07"), true);
    assert.equal(isWeekend("2026-11-08"), true);
    assert.equal(isWeekend("2026-11-06"), false);
  });
  it("honours a custom weekend set", () => {
    const friSat = [5, 6];
    assert.equal(isWeekend("2026-11-06", friSat), true);
    assert.equal(isWeekend("2026-11-08", friSat), false);
    assert.deepEqual(workingDates("2026-11-06", "2026-11-09", NONE, friSat), ["2026-11-08", "2026-11-09"]);
  });
  it("counts leave days against the org weekend", () => {
    // Mon 2026-11-02 → Sun 2026-11-08
    assert.equal(countLeaveDays("2026-11-02", "2026-11-08", false, NONE), 5);
    assert.equal(countLeaveDays("2026-11-02", "2026-11-08", false, NONE, [0]), 6);
    assert.equal(countLeaveDays("2026-11-02", "2026-11-08", false, new Set(["2026-11-03"]), [0]), 5);
    assert.equal(countLeaveDays("2026-11-08", "2026-11-08", true, NONE, [5, 6]), 0.5);
    assert.equal(countLeaveDays("2026-11-08", "2026-11-08", true, NONE), 0);
  });
});

describe("parseEmployeeFields", () => {
  it("validates and upper-cases India fields", () => {
    const r = parseEmployeeFields(IN.hr.employeeFields, { pan: "abcde1234f", ifsc: "hdfc0001234", uan: "100123456789", bankAccount: "" });
    assert.deepEqual(r.errors, {});
    assert.equal(r.values.pan, "ABCDE1234F");
    assert.equal(r.values.ifsc, "HDFC0001234");
    assert.equal(r.values.bankAccount, null);
    assert.ok(!("iban" in r.values), "only the pack's fields are touched");
  });
  it("rejects malformed India values", () => {
    const r = parseEmployeeFields(IN.hr.employeeFields, { pan: "ABC", uan: "12", bankAccount: "12ab" });
    assert.deepEqual(Object.keys(r.errors).sort(), ["bankAccount", "pan", "uan"]);
  });
  it("handles UAE identity, permit and bank fields", () => {
    const r = parseEmployeeFields(AE.hr.employeeFields, {
      nationality: "IN",
      emiratesId: "784-1990-1234567-1",
      emiratesIdExpiry: "2027-01-31",
      iban: "ae07 0331 2345 6789 0123 456",
      wpsPersonId: "10012345678901",
      bankRoutingCode: "302620122",
      passportNumber: "n1234567",
    });
    assert.deepEqual(r.errors, {});
    assert.equal(r.values.iban, "AE070331234567890123456");
    assert.equal(r.values.passportNumber, "N1234567");
    assert.equal(r.values.nationality, "IN");
  });
  it("rejects bad UAE values", () => {
    const r = parseEmployeeFields(AE.hr.employeeFields, { nationality: "XX", emiratesId: "123", iban: "GB00123", wpsPersonId: "1", visaExpiry: "2026-02-30" });
    assert.deepEqual(Object.keys(r.errors).sort(), ["emiratesId", "iban", "nationality", "visaExpiry", "wpsPersonId"]);
  });
});

describe("expiryAlerts", () => {
  const today = "2026-11-10";
  it("flags expired and soon-to-expire documents within 60 days", () => {
    const a = expiryAlerts(AE.hr.employeeFields, { passportExpiry: "2026-11-01", visaExpiry: "2026-12-20", emiratesIdExpiry: "2027-06-01" }, today);
    assert.deepEqual(
      a.map((x) => [x.key, x.daysLeft, x.expired]),
      [
        ["passportExpiry", -9, true],
        ["visaExpiry", 40, false],
      ],
    );
    assert.equal(a[1].label, "Visa");
  });
  it("respects the window and ignores blanks", () => {
    assert.equal(expiryAlerts(AE.hr.employeeFields, { visaExpiry: "2027-01-10" }, today).length, 0);
    assert.equal(expiryAlerts(AE.hr.employeeFields, { visaExpiry: "2027-01-09" }, today).length, 1);
    assert.equal(expiryAlerts(AE.hr.employeeFields, {}, today).length, 0);
  });
});

describe("UAE salary components", () => {
  it("stores monthly components and annualises the package", () => {
    const p = packageFromComponents({ basic: 900000, housing: 375000, transport: 150000, other: 75000 });
    assert.equal(p.monthly, 1500000);
    assert.equal(p.annual, 18000000);
    assert.deepEqual(parseSalaryComponents(p.json), { basic: 900000, housing: 375000, transport: 150000, other: 75000 });
    assert.equal(packageFromComponents({ basic: 0, housing: 0, transport: 0, other: 0 }).json, null);
  });
  it("round-trips through the payroll engine", () => {
    const p = packageFromComponents({ basic: 900000, housing: 375000, transport: 150000, other: 75000 });
    const c = uaeComponents(p.annual, parseSalaryComponents(p.json), AE.payroll.defaultSplit);
    assert.deepEqual(c, { basic: 900000, housing: 375000, transport: 150000, other: 75000 });
  });
  it("tolerates junk JSON", () => {
    assert.equal(parseSalaryComponents("nope"), null);
    assert.deepEqual(parseSalaryComponents('{"basic":-5,"housing":1.5,"other":100}'), { other: 100 });
  });
});

describe("expense claims", () => {
  const today = "2026-11-10";
  const base = { date: "2026-11-09", category: "travel", description: "Taxi to client", amount: "250" };
  it("computes tax at the chosen pack rate", () => {
    assert.deepEqual(claimTotals(25000, 5), { amount: 25000, taxAmount: 1250, total: 26250 });
    const ae = parseClaim({ ...base, tax: "SR", reimburseVia: "payroll" }, AE, true, today);
    assert.ok("claim" in ae);
    assert.equal(ae.claim.taxAmount, 1250);
    assert.equal(ae.claim.reimburseVia, "payroll");
    const inn = parseClaim({ ...base, tax: "GST18" }, IN, true, today);
    assert.ok("claim" in inn && inn.claim.total === 29500);
    const none = parseClaim({ ...base, tax: "none" }, IN, true, today);
    assert.ok("claim" in none && none.claim.taxAmount === 0);
  });
  it("only reimburses via payroll when payroll is available", () => {
    const r = parseClaim({ ...base, tax: "none", reimburseVia: "payroll" }, AE, false, today);
    assert.ok("claim" in r && r.claim.reimburseVia === "direct");
  });
  it("rejects invalid input", () => {
    const r = parseClaim({ date: "2026-11-11", category: "bogus", description: "x", amount: "-1", tax: "GST18" }, AE, true, today);
    assert.ok("errors" in r);
    assert.deepEqual(Object.keys(r.errors).sort(), ["amount", "category", "date", "description", "tax"]);
  });
});

it("masks identifiers", () => {
  assert.equal(maskId("AE070331234567890123456"), "••••••••3456");
  assert.equal(maskId(null), "—");
});
