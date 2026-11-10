import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "@/lib/activity";
import { addDaysYmd, todayYmd } from "@/lib/format";
import { computePoTotals } from "@/lib/inventory";
import { taxOf } from "@/lib/money";
import { receivePurchaseOrder } from "@/lib/posting";
import { nextNumber } from "@/lib/sequence";
import { defaultWarehouseId, moveStock } from "@/lib/stock";

const DAY = 86_400_000;
const minor = (n: number) => Math.round(n * 100);

type VendorSeed = { name: string; email: string; phone: string; gstin: string; address: string };

const LOCAL: Record<
  CountryCode,
  { warehouse: { name: string; code: string; address: string }; vendors: VendorSeed[]; barcodePrefix: string; fitOutNote: string; prices?: Record<string, [cost: number, price: number]> }
> = {
  IN: {
    warehouse: { name: "Bengaluru WH", code: "BLR", address: "Plot 14, Peenya Industrial Area, Bengaluru 560058" },
    vendors: [
      { name: "TechSource Distribution", email: "orders@techsource.example", phone: "+91 98100 11001", gstin: "07AAACT1234F1Z5", address: "Nehru Place, New Delhi 110019" },
      { name: "Urban Workspace Furnishings", email: "sales@urbanworkspace.example", phone: "+91 98450 22002", gstin: "29AABCU5678K1Z2", address: "Whitefield, Bengaluru 560066" },
      { name: "OfficeMart Supplies", email: "bulk@officemart.example", phone: "+91 98200 33003", gstin: "27AAECO9012L1ZP", address: "Andheri East, Mumbai 400093" },
      { name: "PackRight Industries", email: "care@packright.example", phone: "+91 98400 44004", gstin: "33AAFCP3456M1ZV", address: "Ambattur, Chennai 600058" },
      { name: "Gadget Wholesale Co.", email: "hello@gadgetwholesale.example", phone: "+91 98760 55005", gstin: "06AAHCG7890N1ZQ", address: "Sector 18, Gurugram 122015" },
    ],
    barcodePrefix: "89012",
    fitOutNote: "Bengaluru office fit-out.",
  },
  AE: {
    warehouse: { name: "Abu Dhabi WH", code: "AUH", address: "Plot 22, Mussafah Industrial Area M-14, Abu Dhabi" },
    vendors: [
      { name: "TechSource Distribution FZE", email: "orders@techsource.example", phone: "+971 4 299 1001", gstin: "100112233400003", address: "Warehouse 7, Jebel Ali Free Zone, Dubai" },
      { name: "Urban Workspace Furnishings LLC", email: "sales@urbanworkspace.example", phone: "+971 4 340 2002", gstin: "100223344500003", address: "Al Quoz Industrial Area 3, Dubai" },
      { name: "OfficeMart Supplies Trading", email: "bulk@officemart.example", phone: "+971 4 266 3003", gstin: "100334455600003", address: "Al Qusais Industrial Area 2, Dubai" },
      { name: "PackRight Industries LLC", email: "care@packright.example", phone: "+971 6 534 4004", gstin: "100445566700003", address: "Industrial Area 13, Sharjah" },
      { name: "Gadget Wholesale Co. LLC", email: "hello@gadgetwholesale.example", phone: "+971 4 225 5005", gstin: "100556677800003", address: "Al Fahidi Street, Bur Dubai, Dubai" },
    ],
    barcodePrefix: "62912",
    fitOutNote: "Abu Dhabi office fit-out.",
    // AED [cost, selling price]
    prices: {
      "ELEC-001": [25, 45],
      "ELEC-002": [140, 229],
      "ELEC-003": [650, 899],
      "ELEC-004": [55, 99],
      "ELEC-005": [90, 149],
      "FURN-001": [380, 599],
      "FURN-002": [950, 1450],
      "FURN-003": [420, 690],
      "CONS-001": [14, 22],
      "CONS-002": [18, 29],
      "CONS-003": [210, 320],
      "CONS-004": [9, 15],
      "PACK-001": [2.5, 4.5],
      "PACK-002": [35, 55],
      "PACK-003": [4, 7.5],
    },
  },
};

/** Sample inventory: warehouses, vendors, products with stock history, three POs and a transfer. */
export async function seedInventory(ctx: Ctx): Promise<void> {
  const orgId = ctx.orgId;
  const [org] = await db.select({ country: schema.organizations.country }).from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  const country = packOf(org ?? {});
  const local = LOCAL[country.code];
  // Authored rates are Indian GST slabs; other countries use their standard rate.
  const rate = (gst: number) => (country.code === "IN" ? gst : defaultTaxRate(country));
  const main = await defaultWarehouseId(orgId);
  const [blr] = await db
    .insert(schema.warehouses)
    .values({ orgId, ...local.warehouse, isDefault: false })
    .returning({ id: schema.warehouses.id });

  const vendorRows = await db
    .insert(schema.vendors)
    .values(local.vendors.map((v) => ({ orgId, ...v })))
    .returning({ id: schema.vendors.id });
  const [tech, furn, office, pack, gadget] = vendorRows.map((v) => v.id);

  type P = { sku: string; name: string; category: string; cost: number; price: number; gst: number; rl: number; rq: number; vendor: number; open: number; openBlr?: number; unit?: "pcs" | "box" | "m" };
  const defs: P[] = [
    { sku: "ELEC-001", name: "Wireless Mouse", category: "Electronics", cost: 450, price: 799, gst: 18, rl: 20, rq: 50, vendor: tech, open: 60, openBlr: 20 },
    { sku: "ELEC-002", name: "Mechanical Keyboard", category: "Electronics", cost: 2200, price: 3499, gst: 18, rl: 10, rq: 25, vendor: tech, open: 30, openBlr: 10 },
    { sku: "ELEC-003", name: '27" Monitor', category: "Electronics", cost: 11500, price: 15999, gst: 18, rl: 5, rq: 10, vendor: gadget, open: 8 },
    { sku: "ELEC-004", name: "USB-C Hub", category: "Electronics", cost: 850, price: 1499, gst: 18, rl: 15, rq: 40, vendor: gadget, open: 45, openBlr: 15 },
    { sku: "ELEC-005", name: "HD Webcam", category: "Electronics", cost: 1400, price: 2399, gst: 18, rl: 8, rq: 20, vendor: tech, open: 22 },
    { sku: "FURN-001", name: "Ergonomic Office Chair", category: "Furniture", cost: 4800, price: 7499, gst: 18, rl: 6, rq: 12, vendor: furn, open: 14, openBlr: 6 },
    { sku: "FURN-002", name: "Height-Adjustable Desk", category: "Furniture", cost: 12500, price: 18999, gst: 18, rl: 4, rq: 8, vendor: furn, open: 6 },
    { sku: "FURN-003", name: "Steel Filing Cabinet", category: "Furniture", cost: 6200, price: 9499, gst: 18, rl: 3, rq: 6, vendor: furn, open: 9 },
    { sku: "CONS-001", name: "A4 Paper Ream (500 sheets)", category: "Consumables", cost: 280, price: 420, gst: 12, rl: 100, rq: 300, vendor: office, open: 400 },
    { sku: "CONS-002", name: "Ballpoint Pens (box of 50)", category: "Consumables", cost: 220, price: 349, gst: 12, rl: 20, rq: 60, vendor: office, open: 80, unit: "box" },
    { sku: "CONS-003", name: "Laser Printer Toner", category: "Consumables", cost: 3100, price: 4599, gst: 18, rl: 6, rq: 15, vendor: office, open: 18 },
    { sku: "CONS-004", name: "Whiteboard Markers (pack of 4)", category: "Consumables", cost: 120, price: 199, gst: 12, rl: 25, rq: 80, vendor: office, open: 90 },
    { sku: "PACK-001", name: "Corrugated Box — Medium", category: "Packaging", cost: 38, price: 65, gst: 18, rl: 200, rq: 600, vendor: pack, open: 700, openBlr: 300 },
    { sku: "PACK-002", name: "Bubble Wrap Roll (50 m)", category: "Packaging", cost: 520, price: 799, gst: 18, rl: 12, rq: 30, vendor: pack, open: 35, unit: "pcs" },
    { sku: "PACK-003", name: "Packing Tape (48 mm)", category: "Packaging", cost: 65, price: 110, gst: 18, rl: 60, rq: 200, vendor: pack, open: 220, openBlr: 80 },
  ];
  const baseCost = Object.fromEntries(defs.map((d) => [d.sku, d.cost]));
  if (local.prices) {
    for (const d of defs) [d.cost, d.price] = local.prices[d.sku];
  }
  /** PO costs are authored against Indian list prices; keep the same relative deviation elsewhere. */
  const poCost = (sku: string, authored: number) => (local.prices ? Math.round((local.prices[sku][0] * authored * 100) / baseCost[sku]) / 100 : authored);

  const ids: Record<string, number> = {};
  for (const d of defs) {
    const [p] = await db
      .insert(schema.products)
      .values({
        orgId,
        name: d.name,
        sku: d.sku,
        barcode: `89012${d.sku.replace(/\D/g, "").padStart(3, "0")}${String(defs.indexOf(d) + 1).padStart(4, "0")}`,
        category: d.category,
        unit: d.unit ?? "pcs",
        costPrice: inr(d.cost),
        sellingPrice: inr(d.price),
        taxRate: d.gst,
        reorderLevel: d.rl,
        reorderQty: d.rq,
        preferredVendorId: d.vendor,
        trackStock: true,
        active: true,
      })
      .returning({ id: schema.products.id });
    ids[d.sku] = p.id;
    await moveStock(ctx, { productId: p.id, warehouseId: main, quantity: d.open, type: "opening", unitCost: inr(d.cost), reference: "Opening stock", sourceType: "manual" });
    if (d.openBlr) await moveStock(ctx, { productId: p.id, warehouseId: blr.id, quantity: d.openBlr, type: "opening", unitCost: inr(d.cost), reference: "Opening stock", sourceType: "manual" });
  }

  // Opening balances predate the 30-day cover window.
  await db
    .update(schema.stockMovements)
    .set({ createdAt: new Date(Date.now() - 60 * DAY) })
    .where(and(eq(schema.stockMovements.orgId, orgId), eq(schema.stockMovements.type, "opening")));

  /** Move stock and back-date the ledger row. */
  const dated = async (daysAgo: number, m: Parameters<typeof moveStock>[1]) => {
    await moveStock(ctx, m);
    const [last] = await db.select({ id: schema.stockMovements.id }).from(schema.stockMovements).where(eq(schema.stockMovements.orgId, orgId)).orderBy(desc(schema.stockMovements.id)).limit(1);
    if (last) await db.update(schema.stockMovements).set({ createdAt: new Date(Date.now() - daysAgo * DAY) }).where(eq(schema.stockMovements.id, last.id));
  };

  const createPo = async (
    status: "draft" | "ordered",
    vendorId: number,
    warehouseId: number,
    daysAgo: number,
    expectedIn: number,
    notes: string,
    lines: { sku: string; qty: number; cost: number; gst: number }[],
  ) => {
    const totals = computePoTotals(lines.map((l) => ({ productId: ids[l.sku], quantity: l.qty, unitCost: inr(l.cost), taxRate: l.gst })), taxOf);
    const orderDate = addDaysYmd(todayYmd(), -daysAgo);
    const [po] = await db
      .insert(schema.purchaseOrders)
      .values({
        orgId,
        number: await nextNumber(orgId, "po"),
        vendorId,
        warehouseId,
        status,
        orderDate,
        expectedDate: addDaysYmd(orderDate, expectedIn),
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        notes,
      })
      .returning({ id: schema.purchaseOrders.id });
    await db.insert(schema.purchaseOrderLines).values(totals.lines.map((l) => ({ orgId, poId: po.id, productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, taxRate: l.taxRate, amount: l.amount, taxAmount: l.taxAmount })));
    return po.id;
  };

  // PO 1 — ordered then received (adds stock, re-averages cost, creates the unpaid bill).
  const received = await createPo("ordered", tech, main, 12, 7, "Quarterly peripherals restock.", [
    { sku: "ELEC-001", qty: 40, cost: 460, gst: 18 },
    { sku: "ELEC-002", qty: 20, cost: 2250, gst: 18 },
    { sku: "ELEC-005", qty: 10, cost: 1380, gst: 18 },
  ]);
  await receivePurchaseOrder(ctx, received, addDaysYmd(todayYmd(), -8));

  // PO 2 — ordered, awaiting delivery. PO 3 — draft.
  await createPo("ordered", furn, blr.id, 4, 10, "Bengaluru office fit-out.", [
    { sku: "FURN-002", qty: 8, cost: 12500, gst: 18 },
    { sku: "FURN-001", qty: 6, cost: 4800, gst: 18 },
  ]);
  await createPo("draft", office, main, 0, 5, "Draft — confirm quantities with accounts.", [
    { sku: "CONS-001", qty: 300, cost: 280, gst: 12 },
    { sku: "CONS-003", qty: 10, cost: 3100, gst: 18 },
  ]);

  // Transfer Main → Bengaluru.
  const trf = `TRF-${Date.now()}`;
  await dated(9, { productId: ids["ELEC-004"], warehouseId: main, quantity: -10, type: "transfer_out", reference: trf, sourceType: "transfer" });
  await dated(9, { productId: ids["ELEC-004"], warehouseId: blr.id, quantity: 10, type: "transfer_in", reference: trf, sourceType: "transfer" });

  // Recent outflow so days-of-cover is meaningful.
  const issue = (daysAgo: number, sku: string, qty: number, note: string) =>
    dated(daysAgo, { productId: ids[sku], warehouseId: main, quantity: -qty, type: "issue", reference: "Issue", sourceType: "manual", note });
  await issue(26, "CONS-001", 90, "Monthly office consumption");
  await issue(18, "CONS-001", 110, "Print run — onboarding kits");
  await issue(7, "CONS-001", 110, "Quarter-end documentation");
  await issue(20, "ELEC-003", 2, "New joiner workstations");
  await issue(6, "ELEC-003", 2, "Design team upgrade");
  await issue(15, "FURN-002", 2, "Sales floor desks");
  await issue(5, "FURN-002", 1, "CEO office");
  await issue(22, "CONS-004", 20, "Meeting rooms");
  await issue(10, "PACK-003", 40, "Dispatch packing");
  await issue(3, "PACK-001", 150, "Dispatch packing");
  await issue(12, "ELEC-001", 15, "Team laptops accessories");
  await issue(2, "CONS-002", 25, "Stationery refill");

  await dated(14, { productId: ids["ELEC-005"], warehouseId: main, quantity: -2, type: "adjustment", reference: "Adjustment", sourceType: "manual", note: "Damaged in handling" });
  await dated(8, { productId: ids["PACK-002"], warehouseId: main, quantity: 3, type: "adjustment", reference: "Adjustment", sourceType: "manual", note: "Cycle count correction" });
}
