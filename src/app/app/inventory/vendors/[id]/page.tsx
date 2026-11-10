import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ActionButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { deleteVendor } from "../../actions";
import { VendorForm } from "../../_components/vendor-form";
import { INVENTORY_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Vendor" };

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const orgId = ws.org.id;
  const cur = ws.org.currency;

  const [vendor] = await db.select().from(schema.vendors).where(and(eq(schema.vendors.id, id), eq(schema.vendors.orgId, orgId))).limit(1);
  if (!vendor) notFound();

  const [pos, bills] = await Promise.all([
    db.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.vendorId, id), eq(schema.purchaseOrders.orgId, orgId))).orderBy(desc(schema.purchaseOrders.id)),
    db.select().from(schema.expenses).where(and(eq(schema.expenses.vendorId, id), eq(schema.expenses.orgId, orgId))).orderBy(desc(schema.expenses.date), desc(schema.expenses.id)),
  ]);
  const unpaid = bills.filter((b) => b.status === "unpaid").reduce((s, b) => s + b.total, 0);
  const spend = pos.filter((p) => p.status === "received").reduce((s, p) => s + p.total, 0);

  return (
    <>
      <PageHeader
        title={vendor.name}
        description={[vendor.email, vendor.phone, vendor.gstin].filter(Boolean).join(" · ") || "Supplier"}
        tabs={INVENTORY_TABS("vendors")}
        actions={
          <>
            <Link href={`/app/inventory/purchase-orders/new?vendor=${id}`} className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink/85">
              New PO
            </Link>
            {pos.length === 0 && (
              <ActionButton action={deleteVendor} fields={{ id }} confirm={`Delete ${vendor.name}?`} className="h-10 px-4 text-signal">
                Delete
              </ActionButton>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Purchase orders" value={pos.length} tone="sky" />
        <Stat label="Received value" value={formatMoney(spend, cur)} tone="mint" />
        <Stat label="Unpaid bills" value={formatMoney(unpaid, cur)} tone={unpaid > 0 ? "peach" : "card"} />
      </div>

      <Card title="Details">
        <VendorForm vendor={vendor} />
      </Card>

      <Card title="Purchase orders" className="mt-6">
        {pos.length === 0 ? (
          <EmptyState title="No purchase orders">Create one from the Purchase orders tab.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>PO</Th>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {pos.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link href={`/app/inventory/purchase-orders/${p.id}`} className="font-medium hover:underline">
                      {p.number}
                    </Link>
                  </Td>
                  <Td className="text-ink-soft">{formatDate(p.orderDate)}</Td>
                  <Td>
                    <StatusBadge value={p.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.total, cur)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Bills" actions={<Link href="/app/finance/expenses" className="text-sm text-ink-soft hover:text-ink">Open expenses →</Link>} className="mt-6">
        {bills.length === 0 ? (
          <EmptyState title="No bills">Receiving a purchase order creates an unpaid bill here.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Status</Th>
                <Th>Due</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <Td className="text-ink-soft">{formatDate(b.date)}</Td>
                  <Td>{b.description}</Td>
                  <Td>
                    <StatusBadge value={b.status} />
                  </Td>
                  <Td className="text-ink-soft">{b.dueDate ? formatDate(b.dueDate) : "—"}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(b.total, cur)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
