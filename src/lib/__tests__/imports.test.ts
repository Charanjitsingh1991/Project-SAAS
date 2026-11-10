import assert from "node:assert/strict";
import { test } from "node:test";
import { CSV_MAX_ROWS, parseCompanies, parseContacts, parseProducts, templateCsv, PRODUCT_COLUMNS } from "../imports";

test("companies: case-insensitive headers, aliases, row numbers and in-file dupes", () => {
  const r = parseCompanies("Name,Industry,TRN,Emirate\nAcme,Retail,,Dubai\n,Bad,,\nacme,Dup,,\n");
  assert.equal(r.fatal, undefined);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].row, 2);
  assert.equal(r.rows[0].data.state, "Dubai");
  assert.deepEqual(r.errors.map((e) => e.row), [3, 4]);
  assert.match(r.errors[1].message, /Duplicate of row 2/);
});

test("companies: tax id normalised and validated via injected validator", () => {
  const r = parseCompanies("name,gstin\nA,27 aapfu0939f1zv\nB,bad\n", { validateTaxId: (id) => (id.length === 15 ? null : "Invalid tax ID") });
  assert.equal(r.rows[0].data.gstin, "27AAPFU0939F1ZV");
  assert.equal(r.errors[0].row, 3);
});

test("missing required column and empty file are fatal", () => {
  assert.match(parseCompanies("industry\nx\n").fatal!, /Missing required column: name/);
  assert.match(parseCompanies("").fatal!, /empty/);
  assert.match(parseCompanies("name\n").fatal!, /no data rows/);
});

test("row cap is enforced", () => {
  const csv = "name\n" + Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `C${i}`).join("\n");
  assert.match(parseCompanies(csv).fatal!, /Too many rows/);
  const ok = "name\n" + Array.from({ length: CSV_MAX_ROWS }, (_, i) => `C${i}`).join("\n");
  assert.equal(parseCompanies(ok).rows.length, CSV_MAX_ROWS);
});

test("contacts: email lowercased/deduped, enums validated", () => {
  const r = parseContacts("name,email,company,lifecycle,source\nAnn,ANN@X.COM,Acme,Customer,referral\nBob,nope,,,\nAnn2,ann@x.com,,,\nCy,,,weird,\nDi,,Acme,,\nEd,,,,\n");
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].data.email, "ann@x.com");
  assert.equal(r.rows[0].data.lifecycle, "customer");
  assert.deepEqual(r.errors.map((e) => e.row), [3, 4, 5]);
  assert.match(r.errors[0].message, /email/);
});

test("products: money via toMinor, flags, blanks stay undefined, rate allow-list", () => {
  const r = parseProducts("SKU,Name,Unit,Cost Price,Selling Price,GST Rate,Active\nA1,Widget,KG,\"1,234.50\",99,18,no\nA2,Gadget,,,,,\nA3,Bad,,-5,,,\nA4,Odd,,,,7,\nA1,Dup,,,,,\nA5,U,lightyear,,,,\n", {
    allowedRates: [0, 5, 18],
    taxName: "GST",
  });
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0].data, { sku: "A1", name: "Widget", unit: "kg", cost_price: 123450, selling_price: 9900, gst_rate: 18, active: false });
  assert.equal(r.rows[1].data.cost_price, undefined);
  assert.deepEqual(r.errors.map((e) => e.row), [4, 5, 6, 7]);
  assert.match(r.errors[1].message, /not a valid GST rate/);
});

test("exported-style CSV with quotes and BOM re-imports", () => {
  const r = parseProducts('\uFEFFsku,name,barcode,category,unit,on_hand,cost_price,selling_price,gst_rate,reorder_level,stock_value,active\nS-1,"Cable, 2m",,Acc,pcs,5,10.00,15.00,18,2,50.00,true\n');
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows[0].data.name, "Cable, 2m");
  assert.equal(r.rows[0].data.selling_price, 1500);
  assert.equal(r.rows[0].data.active, true);
});

test("templateCsv emits header and sample line", () => {
  assert.equal(templateCsv(["a", "b"], { a: "1" }), "a,b\n1,\n");
  assert.equal(templateCsv(PRODUCT_COLUMNS, {}).split("\n")[0], PRODUCT_COLUMNS.join(","));
});
