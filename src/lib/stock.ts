import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "./activity";

export async function defaultWarehouseId(orgId: number) {
  const [wh] = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.orgId, orgId))
    .orderBy(sql`${schema.warehouses.isDefault} desc`, schema.warehouses.id)
    .limit(1);
  if (wh) return wh.id;
  const [created] = await db
    .insert(schema.warehouses)
    .values({ orgId, name: "Main warehouse", code: "MAIN", isDefault: true })
    .returning({ id: schema.warehouses.id });
  return created.id;
}

/** Total on-hand quantity across all warehouses. */
export async function onHand(productId: number) {
  const [r] = await db
    .select({ q: sql<number>`coalesce(sum(${schema.stockLevels.quantity}), 0)` })
    .from(schema.stockLevels)
    .where(eq(schema.stockLevels.productId, productId));
  return Number(r?.q ?? 0);
}

type Movement = {
  productId: number;
  warehouseId: number;
  quantity: number; // signed
  type: (typeof schema.MOVEMENT_TYPES)[number];
  unitCost?: number;
  reference?: string | null;
  sourceType?: string | null;
  sourceId?: number | null;
  note?: string | null;
};

/**
 * Apply a signed stock movement: updates the warehouse level and appends to the movement ledger.
 * Positive `receipt`/`opening` movements with a unitCost re-average the product cost.
 * Negative stock is allowed (flagged in the UI).
 */
export async function moveStock(ctx: Ctx, m: Movement) {
  if (!m.quantity) return;
  const [product] = await db
    .select({ costPrice: schema.products.costPrice })
    .from(schema.products)
    .where(and(eq(schema.products.id, m.productId), eq(schema.products.orgId, ctx.orgId)))
    .limit(1);
  if (!product) throw new Error("Product not found");

  if (m.quantity > 0 && m.unitCost !== undefined && (m.type === "receipt" || m.type === "opening")) {
    const before = Math.max(0, await onHand(m.productId));
    const newCost = before + m.quantity > 0 ? Math.round((before * product.costPrice + m.quantity * m.unitCost) / (before + m.quantity)) : m.unitCost;
    await db.update(schema.products).set({ costPrice: newCost }).where(eq(schema.products.id, m.productId));
  }

  await db
    .insert(schema.stockLevels)
    .values({ orgId: ctx.orgId, productId: m.productId, warehouseId: m.warehouseId, quantity: m.quantity })
    .onConflictDoUpdate({
      target: [schema.stockLevels.productId, schema.stockLevels.warehouseId],
      set: { quantity: sql`${schema.stockLevels.quantity} + ${m.quantity}` },
    });

  await db.insert(schema.stockMovements).values({
    orgId: ctx.orgId,
    productId: m.productId,
    warehouseId: m.warehouseId,
    type: m.type,
    quantity: m.quantity,
    unitCost: m.unitCost ?? product.costPrice,
    reference: m.reference ?? null,
    sourceType: m.sourceType ?? null,
    sourceId: m.sourceId ?? null,
    note: m.note ?? null,
    createdBy: ctx.userId,
  });
}
