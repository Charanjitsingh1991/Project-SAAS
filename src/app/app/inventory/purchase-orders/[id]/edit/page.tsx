import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { fromMinor } from "@/lib/format";
import { getProductsWithStock, getVendors, getWarehouses } from "@/lib/inventory-data";
import { requireWorkspace } from "@/lib/tenancy";
import { updatePurchaseOrder } from "../../../actions";
import { PoForm } from "../../../_components/po-form";
import { INVENTORY_TABS } from "../../../tabs";

export const metadata: Metadata = { title: "Edit purchase order" };

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const orgId = ws.org.id;
  const [po] = await db.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.orgId, orgId))).limit(1);
  if (!po) notFound();
  if (po.status !== "draft") redirect(`/app/inventory/purchase-orders/${id}`);

  const [lines, vendors, warehouses, products] = await Promise.all([
    db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.poId, id)).orderBy(schema.purchaseOrderLines.id),
    getVendors(orgId),
    getWarehouses(orgId),
    getProductsWithStock(orgId),
  ]);
  const used = new Set(lines.map((l) => l.productId));

  return (
    <>
      <PageHeader title={`Edit ${po.number}`} description="Only draft purchase orders can be edited." tabs={INVENTORY_TABS("purchase-orders")} />
      <Card>
        <PoForm
          action={updatePurchaseOrder}
          id={id}
          vendors={vendors}
          warehouses={warehouses}
          products={products.filter((p) => p.active || used.has(p.id)).map((p) => ({ id: p.id, name: p.name, sku: p.sku, cost: fromMinor(p.costPrice), taxRate: p.taxRate }))}
          currency={ws.org.currency}
          initial={{
            vendorId: po.vendorId,
            warehouseId: po.warehouseId,
            orderDate: po.orderDate,
            expectedDate: po.expectedDate,
            notes: po.notes,
            lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: fromMinor(l.unitCost), taxRate: l.taxRate })),
          }}
          submitLabel="Save changes"
        />
      </Card>
    </>
  );
}
