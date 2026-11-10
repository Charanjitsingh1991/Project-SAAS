import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { PO_STATUSES } from "@/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { PrimaryLink } from "../_components/parts";
import { INVENTORY_TABS } from "../tabs";

export const metadata: Metadata = { title: "Purchase orders" };

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const { status } = await searchParams;
  const active = PO_STATUSES.find((s) => s === status);
  const orgId = ws.org.id;

  const all = await db
    .select({ po: schema.purchaseOrders, vendor: schema.vendors.name, warehouse: schema.warehouses.name })
    .from(schema.purchaseOrders)
    .innerJoin(schema.vendors, eq(schema.purchaseOrders.vendorId, schema.vendors.id))
    .innerJoin(schema.warehouses, eq(schema.purchaseOrders.warehouseId, schema.warehouses.id))
    .where(eq(schema.purchaseOrders.orgId, orgId))
    .orderBy(desc(schema.purchaseOrders.id));
  const rows = active ? all.filter((r) => r.po.status === active) : all;
  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.po.status, (counts.get(r.po.status) ?? 0) + 1);

  const pill = (on: boolean) => cn("rounded-full border px-3.5 py-1.5 text-sm capitalize transition", on ? "border-ink bg-ink text-paper" : "border-line hover:border-ink");

  return (
    <>
      <PageHeader title="Inventory" description="Order from vendors, receive into a warehouse, and the bill is created for you." tabs={INVENTORY_TABS("purchase-orders")} actions={<PrimaryLink href="/app/inventory/purchase-orders/new">New purchase order</PrimaryLink>} />

      <nav className="mb-5 flex flex-wrap gap-2">
        <Link href="/app/inventory/purchase-orders" className={pill(!active)}>
          All ({all.length})
        </Link>
        {PO_STATUSES.map((s) => (
          <Link key={s} href={`/app/inventory/purchase-orders?status=${s}`} className={pill(active === s)}>
            {s} ({counts.get(s) ?? 0})
          </Link>
        ))}
      </nav>

      <Card title={`Purchase orders (${rows.length})`}>
        {rows.length === 0 ? (
          <EmptyState title="No purchase orders">{active ? "Nothing with this status." : "Create your first PO to start restocking."}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>PO</Th>
                <Th>Vendor</Th>
                <Th>Deliver to</Th>
                <Th>Ordered</Th>
                <Th>Expected</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ po, vendor, warehouse }) => (
                <tr key={po.id}>
                  <Td>
                    <Link href={`/app/inventory/purchase-orders/${po.id}`} className="font-medium hover:underline">
                      {po.number}
                    </Link>
                  </Td>
                  <Td>{vendor}</Td>
                  <Td className="text-ink-soft">{warehouse}</Td>
                  <Td className="text-ink-soft">{formatDate(po.orderDate)}</Td>
                  <Td className="text-ink-soft">{po.expectedDate ? formatDate(po.expectedDate) : "—"}</Td>
                  <Td>
                    <StatusBadge value={po.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(po.total, ws.org.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
