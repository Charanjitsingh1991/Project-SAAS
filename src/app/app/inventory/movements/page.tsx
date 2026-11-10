import type { Metadata } from "next";
import { and, desc, eq, gte, like, lt, or } from "drizzle-orm";
import { Card, EmptyState, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { MOVEMENT_TYPES } from "@/db/schema";
import { addDaysYmd } from "@/lib/format";
import { getWarehouses } from "@/lib/inventory-data";
import { requireWorkspace } from "@/lib/tenancy";
import { MovementTable } from "../_components/movement-table";
import { ExportLink, filterInput } from "../_components/parts";
import { INVENTORY_TABS } from "../tabs";

export const metadata: Metadata = { title: "Stock movements" };

const LIMIT = 300;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
// Dates are calendar days in the app timezone (IST by default).
const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);

export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ type?: string; warehouse?: string; q?: string; from?: string; to?: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const sp = await searchParams;
  const orgId = ws.org.id;
  const type = MOVEMENT_TYPES.find((t) => t === sp.type);
  const q = (sp.q ?? "").trim();
  const from = sp.from && YMD.test(sp.from) ? sp.from : "";
  const to = sp.to && YMD.test(sp.to) ? sp.to : "";
  const warehouseId = Number(sp.warehouse) || 0;

  const conds = [eq(schema.stockMovements.orgId, orgId)];
  if (type) conds.push(eq(schema.stockMovements.type, type));
  if (warehouseId) conds.push(eq(schema.stockMovements.warehouseId, warehouseId));
  if (q) conds.push(or(like(schema.products.name, `%${q}%`), like(schema.products.sku, `%${q}%`))!);
  if (from) conds.push(gte(schema.stockMovements.createdAt, dayStart(from)));
  if (to) conds.push(lt(schema.stockMovements.createdAt, dayStart(addDaysYmd(to, 1))));

  const [rows, warehouses] = await Promise.all([
    db
      .select({
        id: schema.stockMovements.id,
        createdAt: schema.stockMovements.createdAt,
        type: schema.stockMovements.type,
        quantity: schema.stockMovements.quantity,
        reference: schema.stockMovements.reference,
        note: schema.stockMovements.note,
        productId: schema.stockMovements.productId,
        product: schema.products.name,
        sku: schema.products.sku,
        warehouse: schema.warehouses.name,
      })
      .from(schema.stockMovements)
      .innerJoin(schema.products, eq(schema.stockMovements.productId, schema.products.id))
      .innerJoin(schema.warehouses, eq(schema.stockMovements.warehouseId, schema.warehouses.id))
      .where(and(...conds))
      .orderBy(desc(schema.stockMovements.id))
      .limit(LIMIT),
    getWarehouses(orgId),
  ]);

  return (
    <>
      <PageHeader title="Inventory" description="Every signed stock movement, newest first." tabs={INVENTORY_TABS("movements")} actions={<ExportLink href="/api/export/stock_movements" />} />

      <form className="mb-5 flex flex-wrap items-end gap-2">
        <input name="q" defaultValue={q} placeholder="Product name or SKU" aria-label="Product" className={`${filterInput} w-56`} />
        <select name="type" defaultValue={type ?? ""} aria-label="Type" className={`${filterInput} capitalize`}>
          <option value="">All types</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select name="warehouse" defaultValue={warehouseId || ""} aria-label="Warehouse" className={filterInput}>
          <option value="">All warehouses</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={from} aria-label="From date" className={filterInput} />
        <input type="date" name="to" defaultValue={to} aria-label="To date" className={filterInput} />
        <button className="h-10 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">Filter</button>
      </form>

      <Card title={`Movements (${rows.length}${rows.length === LIMIT ? "+" : ""})`}>
        {rows.length === 0 ? <EmptyState title="No movements match">Adjust the filters or record stock activity.</EmptyState> : <MovementTable rows={rows} />}
      </Card>
    </>
  );
}
