import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStatement } from "../statements";

const inv = (id: number, issueDate: string, dueDate: string, total: number, status = "sent") => ({ id, number: `INV-${id}`, issueDate, dueDate, status, total });
const pay = (id: number, invoiceId: number, date: string, amount: number) => ({ id, invoiceId, date, amount });
const cn = (id: number, invoiceId: number, date: string, total: number) => ({ id, invoiceId, number: `CN-${id}`, date, total });

test("opening balance, running balance and closing balance", () => {
  const s = buildStatement(
    {
      invoices: [inv(1, "2026-01-10", "2026-02-09", 1000), inv(2, "2026-03-05", "2026-04-04", 500)],
      payments: [pay(1, 1, "2026-01-20", 400), pay(2, 1, "2026-03-10", 200)],
      creditNotes: [cn(1, 2, "2026-03-20", 100)],
    },
    "2026-03-01",
    "2026-03-31",
  );
  assert.equal(s.openingBalance, 600);
  assert.deepEqual(s.rows.map((r) => [r.kind, r.balance]), [["invoice", 1100], ["payment", 900], ["credit_note", 800]]);
  assert.equal(s.totalDebit, 500);
  assert.equal(s.totalCredit, 300);
  assert.equal(s.closingBalance, 800);
});

test("excludes drafts and voided documents; refunds are debits", () => {
  const s = buildStatement(
    {
      invoices: [inv(1, "2026-01-01", "2026-01-31", 1000, "paid"), inv(2, "2026-01-02", "2026-02-01", 999, "void"), inv(3, "2026-01-03", "2026-02-02", 777, "draft")],
      payments: [pay(1, 1, "2026-01-15", 1000), pay(2, 1, "2026-01-20", -300), pay(3, 2, "2026-01-05", 50)],
      creditNotes: [cn(1, 2, "2026-01-06", 10)],
    },
    "2026-01-01",
    "2026-01-31",
  );
  assert.equal(s.openingBalance, 0);
  assert.deepEqual(s.rows.map((r) => r.kind), ["invoice", "payment", "refund"]);
  assert.equal(s.closingBalance, 300);
});

test("aging buckets as of the end date", () => {
  const s = buildStatement(
    {
      invoices: [
        inv(1, "2026-01-01", "2026-06-30", 100), // current
        inv(2, "2026-01-01", "2026-06-15", 200), // 15 days
        inv(3, "2026-01-01", "2026-05-20", 300), // 41 days
        inv(4, "2026-01-01", "2026-04-20", 400), // 71 days
        inv(5, "2026-01-01", "2026-01-31", 500), // 90+
        inv(6, "2026-01-01", "2026-01-31", 600), // fully paid
        inv(7, "2026-07-05", "2026-07-30", 700), // issued after `to`
      ],
      payments: [pay(1, 6, "2026-02-01", 600), pay(2, 5, "2026-07-10", 500), pay(3, 4, "2026-06-01", 150)],
      creditNotes: [],
    },
    "2026-06-01",
    "2026-06-30",
  );
  assert.deepEqual(s.aging, { current: 100, "1-30": 200, "31-60": 300, "61-90": 250, "90+": 500 });
  assert.equal(s.agingTotal, 1350);
});
