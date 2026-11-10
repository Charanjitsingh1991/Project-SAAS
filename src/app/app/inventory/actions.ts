"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { UNITS } from "@/db/schema";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { formObject, todayYmd, toMinor } from "@/lib/format";
import { computePoTotals, isLowStock, suggestedQty } from "@/lib/inventory";
import { getProductsWithStock } from "@/lib/inventory-data";
import { taxOf } from "@/lib/money";
import { completeStockCount, receivePurchaseOrder } from "@/lib/posting";
import { nextNumber } from "@/lib/sequence";
import { defaultWarehouseId, moveStock } from "@/lib/stock";
import { defaultTaxRate } from "@/lib/countries";
import { packFor, planOf, requireWorkspace } from "@/lib/tenancy";
import { normalizeTaxId, taxIdError } from "@/app/app/crm/_components/tax-id";
import { parseCounted } from "./stock-counts/utils";

type Ws = Awaited<ReturnType<typeof requireWorkspace>>;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");
const optId = z.coerce.number().int().positive().optional();
const qtyNum = z.coerce.number().refine((n) => Number.isFinite(n) && n !== 0, "Enter a non-zero quantity.");
const posQty = z.coerce.number().positive("Enter a quantity above zero.");
const fail = (e: z.ZodError): FormState => ({ errors: z.flattenError(e).fieldErrors, message: "Please fix the highlighted fields." });
const bool = (v: string | undefined) => v === "on" || v === "true";

const BASE = "/app/inventory";

async function ownsWarehouse(orgId: number, id: number) {
  const [r] = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.orgId, orgId))).limit(1);
  return !!r;
}
async function ownsVendor(orgId: number, id: number) {
  const [r] = await db.select({ id: schema.vendors.id }).from(schema.vendors).where(and(eq(schema.vendors.id, id), eq(schema.vendors.orgId, orgId))).limit(1);
  return !!r;
}
async function loadProduct(orgId: number, id: number) {
  const [r] = await db.select().from(schema.products).where(and(eq(schema.products.id, id), eq(schema.products.orgId, orgId))).limit(1);
  return r;
}
async function stockIn(productId: number, warehouseId: number) {
  const [r] = await db
    .select({ q: schema.stockLevels.quantity })
    .from(schema.stockLevels)
    .where(and(eq(schema.stockLevels.productId, productId), eq(schema.stockLevels.warehouseId, warehouseId)))
    .limit(1);
  return r?.q ?? 0;
}

/* ───────────── Products ───────────── */

const ProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  sku: z.string().trim().min(1, "SKU is required.").max(60),
  barcode: z.string().trim().max(60).optional(),
  category: z.string().trim().max(60).optional(),
  unit: z.enum(UNITS),
  costPrice: z.string().optional(),
  sellingPrice: z.string().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  reorderLevel: z.coerce.number().min(0).default(0),
  reorderQty: z.coerce.number().min(0).default(0),
  preferredVendorId: optId,
  openingQty: z.coerce.number().min(0).optional(),
  openingWarehouseId: optId,
});

async function skuTaken(orgId: number, sku: string, exceptId?: number) {
  const conds = [eq(schema.products.orgId, orgId), eq(schema.products.sku, sku)];
  if (exceptId) conds.push(ne(schema.products.id, exceptId));
  const [r] = await db.select({ id: schema.products.id }).from(schema.products).where(and(...conds)).limit(1);
  return !!r;
}

export async function createProduct(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const raw = formObject(formData);
  const parsed = ProductSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  const orgId = ws.org.id;

  const cost = toMinor(d.costPrice);
  const price = toMinor(d.sellingPrice);
  const errors: Record<string, string[]> = {};
  if (Number.isNaN(cost) || cost < 0) errors.costPrice = ["Enter a valid cost."];
  if (Number.isNaN(price) || price < 0) errors.sellingPrice = ["Enter a valid price."];
  if (await skuTaken(orgId, d.sku)) errors.sku = ["This SKU already exists."];
  if (d.preferredVendorId && !(await ownsVendor(orgId, d.preferredVendorId))) errors.preferredVendorId = ["Choose a valid vendor."];
  if (d.openingWarehouseId && !(await ownsWarehouse(orgId, d.openingWarehouseId))) errors.openingWarehouseId = ["Choose a valid warehouse."];
  if (Object.keys(errors).length) return { errors, message: "Please fix the highlighted fields." };

  const [p] = await db
    .insert(schema.products)
    .values({
      orgId,
      name: d.name,
      sku: d.sku,
      barcode: d.barcode ?? null,
      category: d.category ?? null,
      unit: d.unit,
      costPrice: cost,
      sellingPrice: price,
      taxRate: d.taxRate,
      reorderLevel: d.reorderLevel,
      reorderQty: d.reorderQty,
      preferredVendorId: d.preferredVendorId ?? null,
      trackStock: bool(raw.trackStock),
      active: true,
    })
    .returning({ id: schema.products.id });

  const ctx = ctxOf(ws);
  if (d.openingQty && d.openingQty > 0) {
    const warehouseId = d.openingWarehouseId ?? (await defaultWarehouseId(orgId));
    await moveStock(ctx, { productId: p.id, warehouseId, quantity: d.openingQty, type: "opening", unitCost: cost, reference: "Opening stock", sourceType: "manual" });
  }
  await logActivity(ctx, { module: "inventory", entityType: "product", entityId: p.id, action: "created", summary: `Added product ${d.name} (${d.sku})` });
  refresh();
  return { ok: true, message: `Added ${d.name}.` };
}

export async function updateProduct(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const raw = formObject(formData);
  const id = Number(raw.id);
  const product = await loadProduct(ws.org.id, id);
  if (!product) return { message: "Product not found." };
  const parsed = ProductSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  const orgId = ws.org.id;

  const errors: Record<string, string[]> = {};
  const price = toMinor(d.sellingPrice);
  if (Number.isNaN(price) || price < 0) errors.sellingPrice = ["Enter a valid price."];
  if (await skuTaken(orgId, d.sku, id)) errors.sku = ["This SKU already exists."];
  if (d.preferredVendorId && !(await ownsVendor(orgId, d.preferredVendorId))) errors.preferredVendorId = ["Choose a valid vendor."];

  // Cost is a weighted average once stock has been received — never editable then.
  const [receipt] = await db
    .select({ id: schema.stockMovements.id })
    .from(schema.stockMovements)
    .where(and(eq(schema.stockMovements.productId, id), eq(schema.stockMovements.type, "receipt")))
    .limit(1);
  let cost = product.costPrice;
  if (!receipt) {
    cost = toMinor(d.costPrice);
    if (Number.isNaN(cost) || cost < 0) errors.costPrice = ["Enter a valid cost."];
  }
  if (Object.keys(errors).length) return { errors, message: "Please fix the highlighted fields." };

  await db
    .update(schema.products)
    .set({
      name: d.name,
      sku: d.sku,
      barcode: d.barcode ?? null,
      category: d.category ?? null,
      unit: d.unit,
      costPrice: cost,
      sellingPrice: price,
      taxRate: d.taxRate,
      reorderLevel: d.reorderLevel,
      reorderQty: d.reorderQty,
      preferredVendorId: d.preferredVendorId ?? null,
      trackStock: bool(raw.trackStock),
      active: bool(raw.active),
    })
    .where(and(eq(schema.products.id, id), eq(schema.products.orgId, orgId)));
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "product", entityId: id, action: "updated", summary: `Updated product ${d.name}` });
  refresh();
  return { ok: true, message: "Product saved." };
}

/* ───────────── Stock actions (adjust / issue / transfer) ───────────── */

export async function adjustStock(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const parsed = z
    .object({ productId: z.coerce.number().int().positive(), warehouseId: z.coerce.number().int().positive(), quantity: qtyNum, reason: z.string().trim().min(1, "Give a reason.").max(300) })
    .safeParse(formObject(formData));
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  const product = await loadProduct(ws.org.id, d.productId);
  if (!product) return { message: "Product not found." };
  if (!(await ownsWarehouse(ws.org.id, d.warehouseId))) return { errors: { warehouseId: ["Choose a valid warehouse."] }, message: "Please fix the highlighted fields." };

  await moveStock(ctxOf(ws), { productId: d.productId, warehouseId: d.warehouseId, quantity: d.quantity, type: "adjustment", reference: "Adjustment", sourceType: "manual", note: d.reason });
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "product", entityId: d.productId, action: "adjusted", summary: `Adjusted ${product.name} by ${d.quantity > 0 ? "+" : ""}${d.quantity} (${d.reason})` });
  refresh();
  return { ok: true, message: "Stock adjusted." };
}

export async function issueStock(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const parsed = z
    .object({ productId: z.coerce.number().int().positive(), warehouseId: z.coerce.number().int().positive(), quantity: posQty, note: z.string().trim().max(300).optional() })
    .safeParse(formObject(formData));
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  const product = await loadProduct(ws.org.id, d.productId);
  if (!product) return { message: "Product not found." };
  if (!(await ownsWarehouse(ws.org.id, d.warehouseId))) return { errors: { warehouseId: ["Choose a valid warehouse."] }, message: "Please fix the highlighted fields." };

  await moveStock(ctxOf(ws), { productId: d.productId, warehouseId: d.warehouseId, quantity: -d.quantity, type: "issue", reference: "Issue", sourceType: "manual", note: d.note ?? null });
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "product", entityId: d.productId, action: "issued", summary: `Issued ${d.quantity} × ${product.name}` });
  refresh();
  return { ok: true, message: "Stock issued." };
}

export async function transferStock(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const parsed = z
    .object({ productId: z.coerce.number().int().positive(), fromId: z.coerce.number().int().positive(), toId: z.coerce.number().int().positive(), quantity: posQty })
    .safeParse(formObject(formData));
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  const orgId = ws.org.id;
  const product = await loadProduct(orgId, d.productId);
  if (!product) return { message: "Product not found." };
  if (d.fromId === d.toId) return { errors: { toId: ["Choose a different destination."] }, message: "Source and destination must differ." };
  if (!(await ownsWarehouse(orgId, d.fromId))) return { errors: { fromId: ["Choose a valid warehouse."] }, message: "Please fix the highlighted fields." };
  if (!(await ownsWarehouse(orgId, d.toId))) return { errors: { toId: ["Choose a valid warehouse."] }, message: "Please fix the highlighted fields." };
  const available = await stockIn(d.productId, d.fromId);
  if (d.quantity > available) return { errors: { quantity: [`Only ${available} available in the source warehouse.`] }, message: "Not enough stock to transfer." };

  const ref = `TRF-${Date.now()}`;
  const ctx = ctxOf(ws);
  await moveStock(ctx, { productId: d.productId, warehouseId: d.fromId, quantity: -d.quantity, type: "transfer_out", reference: ref, sourceType: "transfer" });
  await moveStock(ctx, { productId: d.productId, warehouseId: d.toId, quantity: d.quantity, type: "transfer_in", reference: ref, sourceType: "transfer" });
  await logActivity(ctx, { module: "inventory", entityType: "product", entityId: d.productId, action: "transferred", summary: `Transferred ${d.quantity} × ${product.name} (${ref})` });
  refresh();
  return { ok: true, message: `Transferred (${ref}).` };
}

/* ───────────── Warehouses ───────────── */

const WarehouseSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  code: z.string().trim().min(1, "Code is required.").max(20),
  address: z.string().trim().max(300).optional(),
});

async function codeTaken(orgId: number, code: string, exceptId?: number) {
  const conds = [eq(schema.warehouses.orgId, orgId), eq(schema.warehouses.code, code)];
  if (exceptId) conds.push(ne(schema.warehouses.id, exceptId));
  const [r] = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(and(...conds)).limit(1);
  return !!r;
}

async function makeDefault(orgId: number, id: number) {
  await db.update(schema.warehouses).set({ isDefault: false }).where(eq(schema.warehouses.orgId, orgId));
  await db.update(schema.warehouses).set({ isDefault: true }).where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.orgId, orgId)));
}

export async function createWarehouse(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const raw = formObject(formData);
  const parsed = WarehouseSchema.safeParse({ ...raw, code: raw.code?.toUpperCase() });
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  const orgId = ws.org.id;
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.warehouses).where(eq(schema.warehouses.orgId, orgId));
  const plan = planOf(ws);
  if (plan.maxWarehouses !== null && Number(n) >= plan.maxWarehouses) {
    return { message: `Your ${plan.name} plan includes ${plan.maxWarehouses} warehouse${plan.maxWarehouses === 1 ? "" : "s"}. Upgrade your plan to add more locations.` };
  }
  if (await codeTaken(orgId, d.code)) return { errors: { code: ["This code is already used."] }, message: "Please fix the highlighted fields." };

  const [w] = await db.insert(schema.warehouses).values({ orgId, name: d.name, code: d.code, address: d.address ?? null, isDefault: false }).returning({ id: schema.warehouses.id });
  if (bool(raw.isDefault) || Number(n) === 0) await makeDefault(orgId, w.id);
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "warehouse", entityId: w.id, action: "created", summary: `Added warehouse ${d.name}` });
  refresh();
  return { ok: true, message: `Added ${d.name}.` };
}

export async function updateWarehouse(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const raw = formObject(formData);
  const id = Number(raw.id);
  const orgId = ws.org.id;
  if (!(await ownsWarehouse(orgId, id))) return { message: "Warehouse not found." };
  const parsed = WarehouseSchema.safeParse({ ...raw, code: raw.code?.toUpperCase() });
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  if (await codeTaken(orgId, d.code, id)) return { errors: { code: ["This code is already used."] }, message: "Please fix the highlighted fields." };

  await db.update(schema.warehouses).set({ name: d.name, code: d.code, address: d.address ?? null }).where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.orgId, orgId)));
  if (bool(raw.isDefault)) await makeDefault(orgId, id);
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "warehouse", entityId: id, action: "updated", summary: `Updated warehouse ${d.name}` });
  refresh();
  return { ok: true, message: "Warehouse saved." };
}

export async function setDefaultWarehouse(formData: FormData) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number(formData.get("id"));
  if (!(await ownsWarehouse(ws.org.id, id))) return;
  await makeDefault(ws.org.id, id);
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "warehouse", entityId: id, action: "default", summary: "Changed the default warehouse" });
  refresh();
}

export async function deleteWarehouse(formData: FormData) {
  const ws = await requireWorkspace({ module: "inventory" });
  const orgId = ws.org.id;
  const id = Number(formData.get("id"));
  const [w] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.orgId, orgId))).limit(1);
  if (!w) return;
  const [mv] = await db.select({ id: schema.stockMovements.id }).from(schema.stockMovements).where(eq(schema.stockMovements.warehouseId, id)).limit(1);
  const [po] = await db.select({ id: schema.purchaseOrders.id }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.warehouseId, id)).limit(1);
  if (w.isDefault || mv || po) redirect(`${BASE}/warehouses?error=${encodeURIComponent(w.isDefault ? "The default warehouse can't be deleted." : "This warehouse has stock history or purchase orders and can't be deleted.")}`);
  await db.delete(schema.warehouses).where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.orgId, orgId)));
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "warehouse", entityId: id, action: "deleted", summary: `Deleted warehouse ${w.name}` });
  refresh();
}

/* ───────────── Vendors ───────────── */

const VendorSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(160),
  email: z.union([z.literal(""), z.email("Enter a valid email.")]).optional(),
  phone: z.string().trim().max(40).optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 characters.")
    .optional(),
  address: z.string().trim().max(300).optional(),
});

export async function createVendor(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const parsed = VendorSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  const [v] = await db
    .insert(schema.vendors)
    .values({ orgId: ws.org.id, name: d.name, email: d.email || null, phone: d.phone ?? null, gstin: d.gstin ?? null, address: d.address ?? null })
    .returning({ id: schema.vendors.id });
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "vendor", entityId: v.id, action: "created", summary: `Added vendor ${d.name}` });
  refresh();
  return { ok: true, message: `Added ${d.name}.` };
}

export async function updateVendor(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const raw = formObject(formData);
  const id = Number(raw.id);
  if (!(await ownsVendor(ws.org.id, id))) return { message: "Vendor not found." };
  const parsed = VendorSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error);
  const d = parsed.data;
  await db
    .update(schema.vendors)
    .set({ name: d.name, email: d.email || null, phone: d.phone ?? null, gstin: d.gstin ?? null, address: d.address ?? null })
    .where(and(eq(schema.vendors.id, id), eq(schema.vendors.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "vendor", entityId: id, action: "updated", summary: `Updated vendor ${d.name}` });
  refresh();
  return { ok: true, message: "Vendor saved." };
}

export async function deleteVendor(formData: FormData) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number(formData.get("id"));
  const [v] = await db.select().from(schema.vendors).where(and(eq(schema.vendors.id, id), eq(schema.vendors.orgId, ws.org.id))).limit(1);
  if (!v) return;
  const [po] = await db.select({ id: schema.purchaseOrders.id }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.vendorId, id)).limit(1);
  if (po) redirect(`${BASE}/vendors?error=${encodeURIComponent("This vendor has purchase orders and can't be deleted.")}`);
  await db.delete(schema.vendors).where(and(eq(schema.vendors.id, id), eq(schema.vendors.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "vendor", entityId: id, action: "deleted", summary: `Deleted vendor ${v.name}` });
  redirect(`${BASE}/vendors`);
}

/* ───────────── Purchase orders ───────────── */

const PoSchema = z.object({
  vendorId: z.coerce.number().int().positive("Choose a vendor."),
  warehouseId: z.coerce.number().int().positive("Choose a warehouse."),
  orderDate: ymd,
  expectedDate: ymd.optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.string().min(2),
});

const LineSchema = z.object({
  productId: z.number("Select a product on every line.").int().positive("Select a product on every line."),
  quantity: z.number("Enter a quantity on every line.").positive("Quantity must be above zero."),
  unitCost: z.number("Enter a unit cost on every line.").min(0, "Unit cost can't be negative."),
  taxRate: z.number("Pick a GST rate.").min(0).max(100),
});

/** Validate form + lines and resolve org-owned refs. Returns either errors or the computed PO. */
async function buildPo(ws: Ws, formData: FormData) {
  const parsed = PoSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false as const, error: fail(parsed.error) };
  const d = parsed.data;
  const orgId = ws.org.id;

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(d.lines);
  } catch {
    return { error: { errors: { lines: ["Invalid lines."] }, message: "Please fix the highlighted fields." } as FormState };
  }
  const lp = z.array(LineSchema).min(1, "Add at least one line.").safeParse(rawLines);
  if (!lp.success) {
    const message = lp.error.issues[0]?.message ?? "Check the lines.";
    return { ok: false as const, error: { errors: { lines: [message] }, message } as FormState };
  }

  const errors: Record<string, string[]> = {};
  if (!(await ownsVendor(orgId, d.vendorId))) errors.vendorId = ["Choose a valid vendor."];
  if (!(await ownsWarehouse(orgId, d.warehouseId))) errors.warehouseId = ["Choose a valid warehouse."];
  const ids = [...new Set(lp.data.map((l) => l.productId))];
  const owned = await db.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.orgId, orgId), inArray(schema.products.id, ids)));
  if (owned.length !== ids.length) errors.lines = ["One or more products are invalid."];
  if (Object.keys(errors).length) return { ok: false as const, error: { errors, message: errors.lines?.[0] ?? "Please fix the highlighted fields." } as FormState };

  const totals = computePoTotals(
    lp.data.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: toMinor(l.unitCost), taxRate: l.taxRate })),
    taxOf,
  );
  return { ok: true as const, d, totals };
}

export async function createPurchaseOrder(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const built = await buildPo(ws, formData);
  if (!built.ok) return built.error;
  const { d, totals } = built;
  const orgId = ws.org.id;

  const number = await nextNumber(orgId, "po");
  const [po] = await db
    .insert(schema.purchaseOrders)
    .values({
      orgId,
      number,
      vendorId: d.vendorId,
      warehouseId: d.warehouseId,
      status: "draft",
      orderDate: d.orderDate,
      expectedDate: d.expectedDate ?? null,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      notes: d.notes ?? null,
    })
    .returning({ id: schema.purchaseOrders.id });
  await db.insert(schema.purchaseOrderLines).values(
    totals.lines.map((l) => ({ orgId, poId: po.id, productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, taxRate: l.taxRate, amount: l.amount, taxAmount: l.taxAmount })),
  );
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "purchase_order", entityId: po.id, action: "created", summary: `Created ${number}` });
  redirect(`${BASE}/purchase-orders/${po.id}`);
}

export async function updatePurchaseOrder(_: FormState, formData: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const orgId = ws.org.id;
  const id = Number(formData.get("id"));
  const [po] = await db.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.orgId, orgId))).limit(1);
  if (!po) return { message: "Purchase order not found." };
  if (po.status !== "draft") return { message: "Only draft purchase orders can be edited." };
  const built = await buildPo(ws, formData);
  if (!built.ok) return built.error;
  const { d, totals } = built;

  await db
    .update(schema.purchaseOrders)
    .set({
      vendorId: d.vendorId,
      warehouseId: d.warehouseId,
      orderDate: d.orderDate,
      expectedDate: d.expectedDate ?? null,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      notes: d.notes ?? null,
    })
    .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.orgId, orgId)));
  await db.delete(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.poId, id));
  await db.insert(schema.purchaseOrderLines).values(
    totals.lines.map((l) => ({ orgId, poId: id, productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, taxRate: l.taxRate, amount: l.amount, taxAmount: l.taxAmount })),
  );
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "purchase_order", entityId: id, action: "updated", summary: `Updated ${po.number}` });
  redirect(`${BASE}/purchase-orders/${id}`);
}

async function loadPo(orgId: number, id: number) {
  const [po] = await db.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.orgId, orgId))).limit(1);
  return po;
}

const poUrl = (id: number, q = "") => `${BASE}/purchase-orders/${id}${q}`;

export async function markPoOrdered(formData: FormData) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number(formData.get("id"));
  const po = await loadPo(ws.org.id, id);
  if (!po || po.status !== "draft") redirect(poUrl(id, `?error=${encodeURIComponent("Only draft purchase orders can be marked as ordered.")}`));
  const [line] = await db.select({ id: schema.purchaseOrderLines.id }).from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.poId, id)).limit(1);
  if (!line) redirect(poUrl(id, `?error=${encodeURIComponent("Add at least one line before ordering.")}`));
  await db.update(schema.purchaseOrders).set({ status: "ordered" }).where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "purchase_order", entityId: id, action: "ordered", summary: `Marked ${po.number} as ordered` });
  redirect(poUrl(id));
}

export async function receivePo(formData: FormData) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number(formData.get("id"));
  const po = await loadPo(ws.org.id, id);
  if (!po) redirect(`${BASE}/purchase-orders`);
  const err = await receivePurchaseOrder(ctxOf(ws), id, todayYmd());
  redirect(poUrl(id, err ? `?error=${encodeURIComponent(err)}` : "?received=1"));
}

export async function cancelPo(formData: FormData) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number(formData.get("id"));
  const po = await loadPo(ws.org.id, id);
  if (!po || (po.status !== "draft" && po.status !== "ordered")) redirect(poUrl(id, `?error=${encodeURIComponent("Only draft or ordered purchase orders can be cancelled.")}`));
  await db.update(schema.purchaseOrders).set({ status: "cancelled" }).where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "purchase_order", entityId: id, action: "cancelled", summary: `Cancelled ${po.number}` });
  redirect(poUrl(id));
}

export async function deletePo(formData: FormData) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number(formData.get("id"));
  const po = await loadPo(ws.org.id, id);
  if (!po) redirect(`${BASE}/purchase-orders`);
  if (po.status !== "draft") redirect(poUrl(id, `?error=${encodeURIComponent("Only draft purchase orders can be deleted.")}`));
  await db.delete(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.poId, id));
  await db.delete(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "purchase_order", entityId: id, action: "deleted", summary: `Deleted ${po.number}` });
  redirect(`${BASE}/purchase-orders`);
}

/* ───────────── Reorder planner ───────────── */

/** Create a draft PO for one preferred-vendor group (or the no-vendor group with a chosen vendor). Recomputed server-side. */
export async function createDraftPoFromReorder(formData: FormData) {
  const ws = await requireWorkspace({ module: "inventory" });
  const orgId = ws.org.id;
  const group = String(formData.get("group") ?? "");
  const groupVendor = group === "none" ? null : Number(group);
  const vendorId = groupVendor ?? Number(formData.get("vendorId"));
  if (!vendorId || !(await ownsVendor(orgId, vendorId))) redirect(`${BASE}/reorder?error=${encodeURIComponent("Choose a vendor for this purchase order.")}`);

  const products = (await getProductsWithStock(orgId)).filter(
    (p) => p.active && p.trackStock && isLowStock(p.onHand, p.reorderLevel) && (p.preferredVendorId ?? null) === groupVendor,
  );
  if (!products.length) redirect(`${BASE}/reorder?error=${encodeURIComponent("Nothing to reorder for this vendor.")}`);

  const totals = computePoTotals(
    products.map((p) => ({ productId: p.id, quantity: suggestedQty(p.onHand, p.reorderLevel, p.reorderQty) || 1, unitCost: p.costPrice, taxRate: p.taxRate })),
    taxOf,
  );
  const warehouseId = await defaultWarehouseId(orgId);
  const number = await nextNumber(orgId, "po");
  const [po] = await db
    .insert(schema.purchaseOrders)
    .values({ orgId, number, vendorId, warehouseId, status: "draft", orderDate: todayYmd(), subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, notes: "Created from the reorder planner." })
    .returning({ id: schema.purchaseOrders.id });
  await db.insert(schema.purchaseOrderLines).values(
    totals.lines.map((l) => ({ orgId, poId: po.id, productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, taxRate: l.taxRate, amount: l.amount, taxAmount: l.taxAmount })),
  );
  await logActivity(ctxOf(ws), { module: "inventory", entityType: "purchase_order", entityId: po.id, action: "created", summary: `Created draft ${number} from the reorder planner` });
  redirect(poUrl(po.id));
}
