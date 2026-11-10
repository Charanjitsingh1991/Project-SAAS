import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney } from "@/lib/format";
import { COVER_WINDOW_DAYS, daysOfCover, fmtQty, isLowStock, marginPct, withRunningBalance } from "@/lib/inventory";
import { getVendors, getWarehouses, stockStats } from "@/lib/inventory-data";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { MovementTable } from "../../_components/movement-table";
import { Qty } from "../../_components/parts";
import { ProductForm } from "../../_components/product-form";
import { inventoryTax } from "../../_components/tax";
import { StockActionForms } from "../../_components/stock-forms";
import { INVENTORY_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const tax = inventoryTax(packFor(ws));

  const [product] = await db.select().from(schema.products).where(and(eq(schema.products.id, id), eq(schema.products.orgId, orgId))).limit(1);
  if (!product) notFound();

  const [warehouses, vendors, levels, moves, poLines] = await Promise.all([
    getWarehouses(orgId),
    getVendors(orgId),
    db.select().from(schema.stockLevels).where(and(eq(schema.stockLevels.productId, id), eq(schema.stockLevels.orgId, orgId))),
    db
      .select({
        id: schema.stockMovements.id,
        createdAt: schema.stockMovements.createdAt,
        type: schema.stockMovements.type,
        quantity: schema.stockMovements.quantity,
        reference: schema.stockMovements.reference,
        note: schema.stockMovements.note,
        productId: schema.stockMovements.productId,
        warehouse: schema.warehouses.name,
      })
      .from(schema.stockMovements)
      .innerJoin(schema.warehouses, eq(schema.stockMovements.warehouseId, schema.warehouses.id))
      .where(and(eq(schema.stockMovements.productId, id), eq(schema.stockMovements.orgId, orgId)))
      .orderBy(schema.stockMovements.id),
    db
      .select({
        poId: schema.purchaseOrders.id,
        number: schema.purchaseOrders.number,
        status: schema.purchaseOrders.status,
        orderDate: schema.purchaseOrders.orderDate,
        vendor: schema.vendors.name,
        quantity: schema.purchaseOrderLines.quantity,
        unitCost: schema.purchaseOrderLines.unitCost,
      })
      .from(schema.purchaseOrderLines)
      .innerJoin(schema.purchaseOrders, eq(schema.purchaseOrderLines.poId, schema.purchaseOrders.id))
      .innerJoin(schema.vendors, eq(schema.purchaseOrders.vendorId, schema.vendors.id))
      .where(and(eq(schema.purchaseOrderLines.productId, id), eq(schema.purchaseOrderLines.orgId, orgId)))
      .orderBy(desc(schema.purchaseOrders.id)),
  ]);

  const levelOf = new Map(levels.map((l) => [l.warehouseId, l.quantity]));
  const onHand = levels.reduce((s, l) => s + l.quantity, 0);
  const outflow = (await stockStats(orgId)).outflow.get(id) ?? 0;
  const cover = daysOfCover(onHand, Math.max(0, outflow));
  const margin = marginPct(product.costPrice, product.sellingPrice);
  const hasReceipt = moves.some((m) => m.type === "receipt");
  const ledger = withRunningBalance(moves)
    .reverse()
    .slice(0, 100)
    .map((m) => ({ ...m, product: product.name, sku: product.sku }));
  const preferred = vendors.find((v) => v.id === product.preferredVendorId);

  return (
    <>
      <PageHeader
        title={product.name}
        description={
          <span className="font-mono text-sm">
            {product.sku}
            {product.category ? ` · ${product.category}` : ""}
            {!product.active && " · inactive"}
          </span>
        }
        tabs={INVENTORY_TABS("products")}
        actions={
          <Link href="/app/inventory/products" className="text-sm text-ink-soft hover:text-ink">
            ← All products
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="On hand" value={<Qty value={onHand} low={product.trackStock && isLowStock(onHand, product.reorderLevel)} />} hint={`Reorder at ${fmtQty(product.reorderLevel)} ${product.unit}`} tone={onHand < 0 ? "rose" : "card"} />
        <Stat label="Stock value" value={formatMoney(Math.round(onHand * product.costPrice), cur)} hint={`Avg. cost ${formatMoney(product.costPrice, cur)}`} tone="mint" />
        <Stat
          label="Days of cover"
          value={cover === null ? "—" : `${Math.floor(cover)}d`}
          hint={outflow > 0 ? `${fmtQty(outflow)} out in last ${COVER_WINDOW_DAYS} days` : "No outflow in last 30 days"}
          tone={cover !== null && cover < 14 ? "peach" : "card"}
        />
        <Stat label="Margin" value={margin === null ? "—" : `${margin.toFixed(1)}%`} hint={`Price ${formatMoney(product.sellingPrice, cur)} · ${tax.name} ${product.taxRate}%`} tone="sky" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Stock by warehouse">
          <ul className="divide-y divide-line/70 text-sm">
            {warehouses.map((w) => (
              <li key={w.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <span>
                  {w.name} {w.isDefault && <span className="text-xs text-ink-mute">(default)</span>}
                </span>
                <Qty value={levelOf.get(w.id) ?? 0} />
              </li>
            ))}
          </ul>
          {preferred && (
            <p className="mt-4 border-t border-line pt-3 text-sm text-ink-soft">
              Preferred vendor:{" "}
              <Link href={`/app/inventory/vendors/${preferred.id}`} className="font-medium text-ink hover:underline">
                {preferred.name}
              </Link>
            </p>
          )}
        </Card>
        <Card title="Details" className="lg:col-span-2">
          <ProductForm vendors={vendors} product={product} costLocked={hasReceipt} tax={tax} />
        </Card>
      </div>

      <Card title="Stock actions" className="mt-6">
        <StockActionForms productId={product.id} warehouses={warehouses} />
      </Card>

      <Card title="Movement ledger" className="mt-6">
        {ledger.length === 0 ? <EmptyState title="No movements yet">Adjust stock or receive a purchase order.</EmptyState> : <MovementTable rows={ledger} showProduct={false} showBalance />}
      </Card>

      <Card title="Purchase history" className="mt-6">
        {poLines.length === 0 ? (
          <EmptyState title="Never purchased">Purchase orders containing this product show up here.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>PO</Th>
                <Th>Vendor</Th>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Unit cost</Th>
              </tr>
            </thead>
            <tbody>
              {poLines.map((l, i) => (
                <tr key={`${l.poId}-${i}`}>
                  <Td>
                    <Link href={`/app/inventory/purchase-orders/${l.poId}`} className="font-medium hover:underline">
                      {l.number}
                    </Link>
                  </Td>
                  <Td className="text-ink-soft">{l.vendor}</Td>
                  <Td className="text-ink-soft">{formatDate(l.orderDate)}</Td>
                  <Td>
                    <StatusBadge value={l.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{fmtQty(l.quantity)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(l.unitCost, cur)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
