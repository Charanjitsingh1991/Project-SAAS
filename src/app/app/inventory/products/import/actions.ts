"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import { defaultTaxRate } from "@/lib/countries";
import { asDuplicateMode, parseProducts, readCsvInput, type ImportSummary } from "@/lib/imports";
import { packFor, requireWorkspace } from "@/lib/tenancy";

const fail = (message: string): ImportSummary => ({ ok: false, message, created: 0, updated: 0, skipped: 0, errors: [] });

export async function importProducts(_: ImportSummary | undefined, fd: FormData): Promise<ImportSummary> {
  const ws = await requireWorkspace({ module: "inventory" });
  const orgId = ws.org.id;
  const pack = packFor(ws);
  const mode = asDuplicateMode(fd.get("onDuplicate"));

  const input = await readCsvInput(fd);
  if ("error" in input) return fail(input.error);
  const parsed = parseProducts(input.text, { allowedRates: pack.tax.rates.map((r) => r.rate), taxName: pack.tax.name });
  if (parsed.fatal) return fail(parsed.fatal);

  const existing = await db.select({ id: schema.products.id, sku: schema.products.sku }).from(schema.products).where(eq(schema.products.orgId, orgId));
  const bySku = new Map(existing.map((p) => [p.sku, p.id]));
  const fallbackRate = defaultTaxRate(pack);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [...parsed.errors];
  const inserts: (typeof schema.products.$inferInsert)[] = [];

  for (const { row, data } of parsed.rows) {
    const id = bySku.get(data.sku);
    if (id === undefined) {
      inserts.push({
        orgId,
        sku: data.sku,
        name: data.name,
        barcode: data.barcode ?? null,
        category: data.category ?? null,
        unit: data.unit ?? "pcs",
        costPrice: data.cost_price ?? 0,
        sellingPrice: data.selling_price ?? 0,
        taxRate: data.gst_rate ?? fallbackRate,
        reorderLevel: data.reorder_level ?? 0,
        active: data.active ?? true,
      });
    } else if (mode === "skip") {
      skipped++;
    } else {
      const set = Object.fromEntries(
        Object.entries({
          name: data.name,
          barcode: data.barcode,
          category: data.category,
          unit: data.unit,
          costPrice: data.cost_price,
          sellingPrice: data.selling_price,
          taxRate: data.gst_rate,
          reorderLevel: data.reorder_level,
          active: data.active,
        }).filter(([, v]) => v !== undefined),
      );
      try {
        await db.update(schema.products).set(set).where(and(eq(schema.products.id, id), eq(schema.products.orgId, orgId)));
        updated++;
      } catch {
        errors.push({ row, message: "Could not update this product." });
      }
    }
  }
  for (let i = 0; i < inserts.length; i += 100) {
    const chunk = inserts.slice(i, i + 100);
    await db.insert(schema.products).values(chunk);
    created += chunk.length;
  }

  errors.sort((a, b) => a.row - b.row);
  if (created + updated) {
    await logActivity(ctxOf(ws), {
      module: "inventory",
      entityType: "product",
      action: "imported",
      summary: `Imported products from CSV: ${created} created, ${updated} updated, ${skipped} skipped, ${errors.length} rejected`,
    });
    refresh();
  }
  return { ok: true, message: "Import finished.", created, updated, skipped: skipped + errors.length, errors };
}
