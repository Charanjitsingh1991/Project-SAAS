import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/app/ui";
import { fromMinor, todayYmd } from "@/lib/format";
import { getProductsWithStock, getVendors, getWarehouses } from "@/lib/inventory-data";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { createPurchaseOrder } from "../../actions";
import { PoForm } from "../../_components/po-form";
import { inventoryTax } from "../../_components/tax";
import { INVENTORY_TABS } from "../../tabs";

export const metadata: Metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ vendor?: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const { vendor } = await searchParams;
  const [vendors, warehouses, products] = await Promise.all([getVendors(ws.org.id), getWarehouses(ws.org.id), getProductsWithStock(ws.org.id)]);
  const vendorId = vendors.find((v) => String(v.id) === vendor)?.id;

  return (
    <>
      <PageHeader title="New purchase order" description="Draft a PO, then mark it ordered and receive it to add stock and create the bill." tabs={INVENTORY_TABS("purchase-orders")} />
      {vendors.length === 0 || products.length === 0 ? (
        <EmptyState title="Add a vendor and a product first">Purchase orders need at least one vendor and one product.</EmptyState>
      ) : (
        <Card>
          <PoForm
            action={createPurchaseOrder}
            vendors={vendors}
            warehouses={warehouses}
            products={products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, sku: p.sku, cost: fromMinor(p.costPrice), taxRate: p.taxRate }))}
            currency={ws.org.currency}
            initial={{ vendorId, warehouseId: warehouses[0]?.id, orderDate: todayYmd() }}
            submitLabel="Create draft PO"
            tax={inventoryTax(packFor(ws))}
          />
        </Card>
      )}
    </>
  );
}
