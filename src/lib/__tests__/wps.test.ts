import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSif, validateSif, type SifInput } from "../wps";

const input: SifInput = {
  employerId: "0000000123456",
  employerRouting: "802420101",
  period: "2026-01",
  createdAt: new Date(Date.UTC(2026, 0, 26, 11, 30, 5)),
  reference: "Acme, LLC payroll",
  employees: [
    { name: "A", personId: "00915012345663", routingCode: "802420101", iban: "AE160240043520123456701", net: 650_000, variable: 250_000, leaveDays: 0 },
    { name: "B", personId: "00915012345664", routingCode: "602620101", iban: "AE070331234567890123456", net: 400_000, variable: 0, leaveDays: 2 },
  ],
};

test("SIF: EDR per employee, SCR control totals, file name", () => {
  const { content, fileName } = buildSif(input);
  assert.equal(
    content,
    [
      "EDR,00915012345663,802420101,AE160240043520123456701,2026-01-01,2026-01-31,31,4000.00,2500.00,0",
      "EDR,00915012345664,602620101,AE070331234567890123456,2026-01-01,2026-01-31,31,4000.00,0.00,2",
      "SCR,0000000123456,802420101,2026-01-26,1130,012026,2,10500.00,AED,Acme  LLC payroll",
      "",
    ].join("\r\n"),
  );
  assert.equal(fileName, "0000000123456260126113005.SIF");
  assert.deepEqual(validateSif(input), []);
});

test("SIF: validation reports missing identifiers", () => {
  const errors = validateSif({ ...input, employerId: "123", employees: [{ ...input.employees[0], iban: "GB00", personId: null }] });
  assert.equal(errors.length, 3);
});
