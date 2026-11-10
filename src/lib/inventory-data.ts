import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { COVER_WINDOW_DAYS } from "./inventory";

/** On-hand (all warehouses) and 30-day outflow (sale + issue) per product. */
export async function stockStats(orgId: number) {
  const since = new Date(Date.now() - COVER_WINDOW_DAYS * 86_400_000);
  const [levels, outflow] = await Promise.all([
    db
      .select({ productId: schema.stockLevels.productId, q: sql<number>`coalesce(sum(${schema.stockLevels.quantity}), 0)` })
      .from(schema.stockLevels)
      .where(eq(schema.stockLevels.orgId, orgId))
      .groupBy(schema.stockLevels.productId),
    db
      .select({ productId: schema.stockMovements.productId, q: sql<number>`coalesce(sum(-${schema.stockMovements.quantity}), 0)` })
      .from(schema.stockMovements)
      .where(and(eq(schema.stockMovements.orgId, orgId), inArray(schema.stockMovements.type, ["sale", "issue"]), gte(schema.stockMovements.createdAt, since)))
      .groupBy(schema.stockMovements.productId),
  ]);
  const onHand = new Map(levels.map((l) => [l.productId, Number(l.q)]));
  const out = new Map(outflow.map((l) => [l.productId, Math.max(0, Number(l.q))]));
  return { onHand, outflow: out };
}

export async function getProductsWithStock(orgId: number) {
  const [products, stats] = await Promise.all([
    db.select().from(schema.products).where(eq(schema.products.orgId, orgId)).orderBy(schema.products.sku),
    stockStats(orgId),
  ]);
  return products.map((p) => ({ ...p, onHand: stats.onHand.get(p.id) ?? 0, outflow30: stats.outflow.get(p.id) ?? 0 }));
}

export async function getWarehouses(orgId: number) {
  return db.select().from(schema.warehouses).where(eq(schema.warehouses.orgId, orgId)).orderBy(sql`${schema.warehouses.isDefault} desc`, schema.warehouses.name);
}

export async function getVendors(orgId: number) {
  return db.select().from(schema.vendors).where(eq(schema.vendors.orgId, orgId)).orderBy(schema.vendors.name);
}
