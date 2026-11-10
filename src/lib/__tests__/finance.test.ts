import assert from "node:assert/strict";
import { test } from "node:test";
import { autoMatch, parseBankAmount, parseBankDate, parseBankStatement } from "../bank-rec";
import { COUNTRIES } from "../countries";
import { lineTaxOption, normalizeTaxId, taxSummary } from "../finance-utils";
import { corporateTaxEstimate, gstReturn, taxReturn, vatReturn, type ReturnDoc } from "../tax-return";

const R = 100;
const IN = COUNTRIES.IN;
const AE = COUNTRIES.AE;
const line = (taxCode: string, taxRate: number, amount: number) => ({ taxCode, taxRate, amount, taxAmount: Math.round((amount * taxRate) / 100) });

/* ───────────── Invoice tax breakdown ───────────── */

test("India intra-state invoice splits CGST + SGST per rate", () => {
  const s = taxSummary(IN, [line("GST18", 18, 1000 * R), line("GST5", 5, 200 * R), line("EXEMPT", 0, 50 * R)], "Karnataka", "Karnataka");
  assert.deepEqual(s.rows.map((r) => r.code), ["GST18", "GST5", "EXEMPT"]);
  assert.deepEqual(s.totals, [
    { label: "CGST 9%", amount: 90 * R },
    { label: "SGST 9%", amount: 90 * R },
    { label: "CGST 2.5%", amount: 5 * R },
    { label: "SGST 2.5%", amount: 5 * R },
  ]);
});

test("India inter-state invoice uses IGST", () => {
  const s = taxSummary(IN, [line("GST18", 18, 1000 * R)], "Maharashtra", "Karnataka");
  assert.deepEqual(s.totals, [{ label: "IGST 18%", amount: 180 * R }]);
});

test("UAE invoice shows a single VAT 5% line; zero/exempt carry no tax", () => {
  const s = taxSummary(AE, [line("SR", 5, 1000 * R), line("ZR", 0, 300 * R), line("EX", 0, 100 * R)], "Abu Dhabi", "Dubai");
  assert.deepEqual(s.totals, [{ label: "VAT 5%", amount: 50 * R }]);
  assert.equal(s.rows.find((r) => r.code === "ZR")?.taxable, 300 * R);
});

test("legacy lines keep their own rate; tax IDs normalise", () => {
  assert.equal(lineTaxOption(IN, null, 12).rate, 12);
  assert.equal(lineTaxOption(IN, null, 18).code, "GST18");
  assert.equal(lineTaxOption(AE, null, 0).code, "ZR");
  assert.equal(normalizeTaxId("100 1234-5670 0003"), "100123456700003");
  assert.match(normalizeTaxId("100 1234-5670 0003"), new RegExp(AE.tax.idPattern));
  assert.match(normalizeTaxId("29abcde1234f1z5"), new RegExp(IN.tax.idPattern));
});

/* ───────────── Tax returns ───────────── */

test("GST return: rates, CGST/SGST vs IGST, nil/exempt, credit notes and ITC", () => {
  const invoices: ReturnDoc[] = [
    { placeOfSupply: "Karnataka", lines: [line("GST18", 18, 1000 * R), line("GST0", 0, 100 * R)] },
    { placeOfSupply: "Delhi", lines: [line("GST18", 18, 500 * R), line("EXEMPT", 0, 40 * R)] },
    { placeOfSupply: null, lines: [line("GST5", 5, 200 * R)] },
  ];
  const creditNotes: ReturnDoc[] = [{ placeOfSupply: "Delhi", lines: [line("GST18", 18, 100 * R)] }];
  const g = gstReturn(IN, { orgRegion: "Karnataka", invoices, creditNotes, expenses: [{ amount: 300 * R, taxAmount: 54 * R }, { amount: 99 * R, taxAmount: 0 }] });
  const r18 = g.byRate.find((r) => r.code === "GST18")!;
  assert.equal(r18.taxable, 1400 * R);
  assert.equal(r18.cgst, 90 * R);
  assert.equal(r18.sgst, 90 * R);
  assert.equal(r18.igst, 72 * R); // 90 − 18 credited
  const r5 = g.byRate.find((r) => r.code === "GST5")!;
  assert.deepEqual([r5.cgst, r5.sgst, r5.igst], [5 * R, 5 * R, 0]);
  assert.equal(g.outward.tax, 90 * R + 90 * R + 72 * R + 10 * R);
  assert.equal(g.interState.taxable, 400 * R);
  assert.equal(g.nilRated, 100 * R);
  assert.equal(g.exempt, 40 * R);
  assert.deepEqual(g.creditNotes, { taxable: 100 * R, tax: 18 * R });
  assert.deepEqual(g.itc, { taxable: 300 * R, tax: 54 * R });
  assert.equal(g.net, g.outward.tax - 54 * R);
});

test("VAT 201: supplies by emirate, zero-rated, exempt, recoverable input VAT", () => {
  const invoices: ReturnDoc[] = [
    { placeOfSupply: "Dubai", lines: [line("SR", 5, 10_000 * R), line("ZR", 0, 2_000 * R)] },
    { placeOfSupply: "Abu Dhabi", lines: [line("SR", 5, 4_000 * R), line("EX", 0, 500 * R)] },
    { placeOfSupply: null, lines: [line("SR", 5, 1_000 * R)] },
  ];
  const creditNotes: ReturnDoc[] = [{ placeOfSupply: "Abu Dhabi", lines: [line("SR", 5, 1_000 * R)] }];
  const v = vatReturn(AE, { orgRegion: "Dubai", invoices, creditNotes, expenses: [{ amount: 3_000 * R, taxAmount: 150 * R }] });
  assert.equal(v.byEmirate.length, 7);
  const by = Object.fromEntries(v.byEmirate.map((e) => [e.emirate, e]));
  assert.deepEqual([by.Dubai.taxable, by.Dubai.vat], [11_000 * R, 550 * R]);
  assert.deepEqual([by["Abu Dhabi"].taxable, by["Abu Dhabi"].vat], [3_000 * R, 150 * R]);
  assert.equal(by.Sharjah.taxable, 0);
  assert.deepEqual(v.standard, { taxable: 14_000 * R, vat: 700 * R });
  assert.equal(v.zeroRated, 2_000 * R);
  assert.equal(v.exempt, 500 * R);
  assert.deepEqual(v.totalSupplies, { taxable: 16_500 * R, vat: 700 * R });
  assert.deepEqual(v.expenses, { taxable: 3_000 * R, vat: 150 * R });
  assert.equal(v.net, 550 * R);
  // Refundable when input exceeds output.
  assert.equal(vatReturn(AE, { orgRegion: "Dubai", invoices: [], creditNotes: [], expenses: [{ amount: 100 * R, taxAmount: 5 * R }] }).net, -5 * R);
  assert.equal(taxReturn(AE, { orgRegion: "Dubai", invoices, creditNotes, expenses: [] }).kind, "VAT");
  assert.equal(taxReturn(IN, { orgRegion: "Delhi", invoices: [], creditNotes: [], expenses: [] }).kind, "GST");
});

test("UAE corporate tax: 0% to AED 375,000, 9% above, none on a loss", () => {
  const ct = AE.corporateTax!;
  assert.equal(corporateTaxEstimate(300_000 * R, ct).tax, 0);
  const e = corporateTaxEstimate(1_000_000 * R, ct);
  assert.equal(e.chargeable, 625_000 * R);
  assert.equal(e.tax, 56_250 * R);
  assert.equal(corporateTaxEstimate(-50_000 * R, ct).tax, 0);
});

/* ───────────── Bank statements ───────────── */

test("bank dates and amounts in common formats", () => {
  assert.equal(parseBankDate("2026-11-05"), "2026-11-05");
  assert.equal(parseBankDate("05/11/2026"), "2026-11-05");
  assert.equal(parseBankDate("05-11-26"), "2026-11-05");
  assert.equal(parseBankDate("11/25/2026"), "2026-11-25");
  assert.equal(parseBankDate("5 Nov 2026"), "2026-11-05");
  assert.equal(parseBankDate("05-Nov-2026"), "2026-11-05");
  assert.equal(parseBankDate("Nov 5, 2026"), "2026-11-05");
  assert.equal(parseBankDate("31/02/2026"), null);
  assert.equal(parseBankAmount("1,234.50"), 123450);
  assert.equal(parseBankAmount("(1,234.50)"), -123450);
  assert.equal(parseBankAmount("-99"), -9900);
  assert.equal(parseBankAmount("1,000.00 DR"), -100000);
  assert.equal(parseBankAmount("AED 2,500.00 Cr"), 250000);
  assert.equal(parseBankAmount("₹ 1,00,000"), 10000000);
  assert.equal(parseBankAmount(""), null);
  assert.equal(parseBankAmount("abc"), null);
});

test("parse signed-amount statement with balance column", () => {
  const csv = 'Date,Description,Reference,Amount,Balance\n2026-11-01,"Payment from Acme, Inc",UTR1,"1,180.00","11,180.00"\n2026-11-03,Office rent,,-500,"10,680.00"\n,Closing balance,,,\n';
  const p = parseBankStatement(csv);
  assert.deepEqual(p.errors, []);
  assert.equal(p.lines.length, 2);
  assert.deepEqual(p.lines[0], { date: "2026-11-01", description: "Payment from Acme, Inc", reference: "UTR1", amount: 118000, balance: 1118000 });
  assert.equal(p.lines[1].amount, -50000);
  assert.equal(p.closingBalance, 1068000);
});

test("parse debit/credit statement (Indian bank export, newest first)", () => {
  const csv = "Txn Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance\n06/11/2026,NEFT-ACME,N123,,2000.00,5000.00\n04/11/2026,ATM WDL,,1000.00,,3000.00\nbad,row,,1,,\n";
  const p = parseBankStatement(csv);
  assert.equal(p.lines.length, 2);
  assert.deepEqual(p.lines.map((l) => [l.date, l.amount, l.reference]), [["2026-11-06", 200000, "N123"], ["2026-11-04", -100000, null]]);
  assert.equal(p.closingBalance, 500000);
  assert.equal(p.errors.length, 1);
});

test("parse amount + Dr/Cr type columns and report missing columns", () => {
  const p = parseBankStatement("Value Date,Details,Amount (AED),Dr/Cr\n01-Nov-2026,Salary WPS,15000,DR\n02-Nov-2026,Client receipt,525,CR\n");
  assert.deepEqual(p.lines.map((l) => l.amount), [-1500000, 52500]);
  assert.match(parseBankStatement("Foo,Bar\n1,2\n").errors[0], /date column/);
  assert.match(parseBankStatement("Date,Memo\n2026-01-01,x\n").errors[0], /amount column/);
});

test("auto-match pairs exact amounts within ±3 days, closest first, each side once", () => {
  const lines = [
    { id: 1, date: "2026-11-05", amount: 118000 },
    { id: 2, date: "2026-11-06", amount: 118000 },
    { id: 3, date: "2026-11-10", amount: -50000 },
    { id: 4, date: "2026-11-20", amount: 777 },
  ];
  const items = [
    { entryId: 10, date: "2026-11-01", amount: 118000 }, // 4 days from line 1 — outside window
    { entryId: 11, date: "2026-11-06", amount: 118000 },
    { entryId: 12, date: "2026-11-04", amount: 118000 },
    { entryId: 13, date: "2026-11-08", amount: -50000 },
    { entryId: 14, date: "2026-11-10", amount: 50000 }, // wrong sign
  ];
  const m = autoMatch(lines, items);
  assert.deepEqual(m, [
    { lineId: 1, entryId: 12 },
    { lineId: 2, entryId: 11 },
    { lineId: 3, entryId: 13 },
  ]);
  assert.deepEqual(autoMatch(lines, items, 0), [{ lineId: 2, entryId: 11 }]);
});
