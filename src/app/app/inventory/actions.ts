"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";

const ProductSchema = z.object({
  name: z.string().min(2, "Enter a name."),
  sku: z.string().min(1, "Required.").max(40),
  category: z.string().max(60).optional(),
  quantity: z.coerce.number().int().min(0, "Must be 0 or more."),
  reorderLevel: z.coerce.number().int().min(0, "Must be 0 or more."),
  unitCost: z.coerce.number().int().min(0, "Must be 0 or more."),
});

export async function createProduct(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "inventory" });
  const parsed = ProductSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };

  const [dup] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(eq(schema.products.orgId, ws.org.id), eq(schema.products.sku, parsed.data.sku)))
    .limit(1);
  if (dup) return { errors: { sku: ["SKU already exists."] }, message: "Please fix the highlighted fields." };

  const [product] = await db.insert(schema.products).values({ ...parsed.data, orgId: ws.org.id }).returning({ id: schema.products.id });
  if (parsed.data.quantity > 0) {
    await db.insert(schema.stockMovements).values({ orgId: ws.org.id, productId: product.id, change: parsed.data.quantity, note: "Opening stock" });
  }
  refresh();
  return { ok: true, message: `${parsed.data.name} added.` };
}

const AdjustSchema = z.object({
  productId: z.coerce.number().int().positive(),
  change: z.coerce.number().int().refine((n) => n !== 0),
});

export async function adjustStock(fd: FormData) {
  const ws = await requireWorkspace({ module: "inventory" });
  const parsed = AdjustSchema.safeParse(formObject(fd));
  if (!parsed.success) return;

  const [product] = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.id, parsed.data.productId), eq(schema.products.orgId, ws.org.id)))
    .limit(1);
  if (!product) return;

  const next = product.quantity + parsed.data.change;
  if (next < 0) return;

  await db
    .update(schema.products)
    .set({ quantity: next })
    .where(and(eq(schema.products.id, product.id), eq(schema.products.orgId, ws.org.id)));
  await db.insert(schema.stockMovements).values({ orgId: ws.org.id, productId: product.id, change: parsed.data.change, note: "Manual adjustment" });
  refresh();
}

export async function deleteProduct(fd: FormData) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = z.coerce.number().int().positive().parse(fd.get("id"));
  await db.delete(schema.stockMovements).where(and(eq(schema.stockMovements.productId, id), eq(schema.stockMovements.orgId, ws.org.id)));
  await db.delete(schema.products).where(and(eq(schema.products.id, id), eq(schema.products.orgId, ws.org.id)));
  refresh();
}
