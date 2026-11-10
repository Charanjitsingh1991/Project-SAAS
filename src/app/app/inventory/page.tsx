import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { daysOfCover, fmtQty, isLowStock, isStockOutRisk } from "@/lib/inventory";
import { getProductsWithStock } from "@/lib/inventory-data";
import { formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { MovementTable } from "./_components/movement-table";
import { PrimaryLink, Qty } from "./_components/parts";
import { INVENTORY_TABS } from "./tabs";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const ws = await requireWorkspace({ module: "inventory" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;

  const [all, recent] = await Promise.all([
    getProductsWithStock(orgId),
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
      .where(eq(schema.stockMovements.orgId, orgId))
      .orderBy(desc(schema.stockMovements.id))
      .limit(10),
  ]);

  const active = all.filter((p) => p.active);
  const tracked = active.filter((p) => p.trackStock);
  const value = tracked.reduce((s, p) => s + Math.round(p.onHand * p.costPrice), 0);
  const low = tracked.filter((p) => isLowStock(p.onHand, p.reorderLevel));
  const negative = tracked.filter((p) => p.onHand < 0);
  const risk = tracked.filter((p) => isStockOutRisk(p.onHand, p.outflow30));
  const watch = [...new Map([...risk, ...low].map((p) => [p.id, p])).values()].sort((a, b) => (daysOfCover(a.onHand, a.outflow30) ?? 9999) - (daysOfCover(b.onHand, b.outflow30) ?? 9999));

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock across every warehouse, what to reorder, and what's about to run out."
        tabs={INVENTORY_TABS("overview")}
        actions={<PrimaryLink href="/app/inventory/purchase-orders/new">New purchase order</PrimaryLink>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Active SKUs" value={active.length} tone="sky" />
        <Stat label="Inventory value" value={formatMoney(value, cur)} hint="Qty × avg. cost" tone="mint" />
        <Stat label="Low stock" value={low.length} hint="At / below reorder level" tone={low.length ? "butter" : "card"} />
        <Stat label="Negative stock" value={negative.length} hint="Oversold or unreceived" tone={negative.length ? "rose" : "card"} />
        <Stat label="Stock-out risk" value={risk.length} hint="< 14 days of cover" tone={risk.length ? "peach" : "card"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Needs attention" actions={<Link href="/app/inventory/reorder" className="text-sm text-ink-soft hover:text-ink">Reorder planner →</Link>}>
          {watch.length === 0 ? (
            <EmptyState title="All stocked up">No low-stock or stock-out risks right now.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th className="text-right">On hand</Th>
                  <Th className="text-right">Reorder at</Th>
                  <Th className="text-right">Cover</Th>
                </tr>
              </thead>
              <tbody>
                {watch.map((p) => {
                  const cover = daysOfCover(p.onHand, p.outflow30);
                  return (
                    <tr key={p.id}>
                      <Td>
                        <Link href={`/app/inventory/products/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        <p className="font-mono text-xs text-ink-mute">{p.sku}</p>
                      </Td>
                      <Td className="text-right">
                        <Qty value={p.onHand} low={isLowStock(p.onHand, p.reorderLevel)} />
                      </Td>
                      <Td className="text-right tabular-nums text-ink-soft">{fmtQty(p.reorderLevel)}</Td>
                      <Td className={`text-right tabular-nums ${cover !== null && cover < 14 ? "font-medium text-signal" : "text-ink-soft"}`}>{cover === null ? "—" : `${Math.floor(cover)}d`}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Recent movements" actions={<Link href="/app/inventory/movements" className="text-sm text-ink-soft hover:text-ink">All movements →</Link>}>
          {recent.length === 0 ? <EmptyState title="No movements yet">Receive a purchase order or add opening stock.</EmptyState> : <MovementTable rows={recent} />}
        </Card>
      </div>
    </>
  );
}
