import assert from "node:assert/strict";
import { test } from "node:test";
import { countSummary, lineVariance, parseCounted } from "../../app/app/inventory/stock-counts/utils";
import { COUNTRIES } from "../countries";
import { canConvertQuote, canMoveQuote, computeQuoteLines, quoteDisplayStatus, quoteTaxLines } from "../quotes";
import { isBot, isLoosePhone, leadDealTitle, webFormEmbed, WebLeadSchema } from "../webforms";

const IN = COUNTRIES.IN;
const AE = COUNTRIES.AE;

test("quote lines: India GST with discount, exempt line carries no tax", () => {
  const r = computeQuoteLines(IN.tax.rates, [
    { description: "Licence", quantity: 2, unitPrice: 100_000, discountPercent: 10, taxCode: "GST18" },
    { description: "Training", quantity: 1, unitPrice: 50_000, discountPercent: 0, taxCode: "EXEMPT" },
  ]);
  assert.equal(r.lines[0].amount, 180_000);
  assert.equal(r.lines[0].taxRate, 18);
  assert.equal(r.lines[0].taxAmount, 32_400);
  assert.equal(r.lines[1].taxRate, 0);
  assert.equal(r.lines[1].taxAmount, 0);
  assert.deepEqual([r.subtotal, r.taxTotal, r.total], [230_000, 32_400, 262_400]);
});

test("quote lines: UAE VAT 5% standard, zero-rated and unknown code fallback", () => {
  const r = computeQuoteLines(AE.tax.rates, [
    { description: "Consulting", quantity: 3, unitPrice: 1_000_00, discountPercent: 0, taxCode: "SR" },
    { description: "Export", quantity: 1, unitPrice: 500_00, discountPercent: 0, taxCode: "ZR" },
    { description: "Bad code", quantity: 1, unitPrice: 100_00, discountPercent: 0, taxCode: "GST18" },
  ]);
  assert.equal(r.lines[0].taxAmount, 15_000);
  assert.equal(r.lines[1].taxAmount, 0);
  assert.equal(r.lines[2].taxCode, "SR");
  assert.equal(r.taxTotal, 15_000 + 500);
});

test("quote tax lines split per country", () => {
  const lines = [{ taxRate: 18, taxAmount: 1801 }];
  assert.deepEqual(
    quoteTaxLines(IN, lines, "Karnataka", "Karnataka").map((l) => [l.label, l.amount]),
    [
      ["CGST 9%", 900],
      ["SGST 9%", 901],
    ],
  );
  assert.deepEqual(quoteTaxLines(IN, lines, "Delhi", "Karnataka").map((l) => l.label), ["IGST 18%"]);
  assert.deepEqual(quoteTaxLines(AE, [{ taxRate: 5, taxAmount: 500 }], "Dubai", "Abu Dhabi").map((l) => l.label), ["VAT 5%"]);
});

test("quote status: expiry display and transitions", () => {
  assert.equal(quoteDisplayStatus({ status: "sent", validUntil: "2026-01-01" }, "2026-01-02"), "expired");
  assert.equal(quoteDisplayStatus({ status: "sent", validUntil: "2026-01-02" }, "2026-01-02"), "sent");
  assert.equal(quoteDisplayStatus({ status: "accepted", validUntil: "2025-01-01" }, "2026-01-02"), "accepted");
  assert.ok(canMoveQuote("draft", "sent"));
  assert.ok(!canMoveQuote("draft", "accepted"));
  assert.ok(!canMoveQuote("expired", "accepted"));
  assert.ok(canMoveQuote("expired", "draft"));
  assert.ok(!canMoveQuote("invoiced", "draft"));
  assert.ok(canConvertQuote("accepted") && canConvertQuote("sent"));
  assert.ok(!canConvertQuote("expired") && !canConvertQuote("draft") && !canConvertQuote("invoiced"));
});

test("web lead validation: loose phones for IN/AE/intl, honeypot", () => {
  assert.ok(isLoosePhone("+91 98765 43210"));
  assert.ok(isLoosePhone("00971 50 123 4567"));
  assert.ok(isLoosePhone("(020) 1234-5678"));
  assert.ok(!isLoosePhone("12ab"));
  const ok = WebLeadSchema.safeParse({ slug: "acme", name: "Asha", email: "ASHA@Example.com ", phone: "+971 50 123 4567" });
  assert.ok(ok.success);
  assert.equal(ok.data.email, "asha@example.com");
  assert.equal(ok.data.phone, "+971501234567");
  assert.ok(!WebLeadSchema.safeParse({ slug: "acme", name: "A", email: "nope" }).success);
  assert.ok(!WebLeadSchema.safeParse({ slug: "../x", name: "Asha", email: "a@b.co" }).success);
  assert.ok(isBot({ website: "http://spam" }));
  assert.ok(!isBot({}));
  assert.equal(leadDealTitle({ name: "Asha", company: "Acme" }), "Acme — web enquiry");
  assert.match(webFormEmbed("https://x.test/forms/acme"), /<iframe src="https:\/\/x.test\/forms\/acme"/);
});

test("stock count: variance, valuation and parsing", () => {
  assert.equal(lineVariance({ expectedQty: 10, countedQty: null }), null);
  assert.equal(lineVariance({ expectedQty: 10, countedQty: 7 }), -3);
  const s = countSummary([
    { expectedQty: 10, countedQty: 7, cost: 1_000 },
    { expectedQty: 5, countedQty: 6, cost: 250 },
    { expectedQty: 2, countedQty: 2, cost: 999 },
    { expectedQty: 1, countedQty: null, cost: 999 },
  ]);
  assert.deepEqual(s, { total: 4, counted: 3, withVariance: 2, gain: 250, loss: -3_000, net: -2_750 });
  assert.equal(parseCounted(""), null);
  assert.equal(parseCounted("1,200.5"), 1200.5);
  assert.equal(parseCounted("-1"), "invalid");
  assert.equal(parseCounted("abc"), "invalid");
});
