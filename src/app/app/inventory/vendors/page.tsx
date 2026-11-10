import type { Metadata } from "next";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoney } from "@/lib/format";
import { getVendors } from "@/lib/inventory-data";
import { requireWorkspace } from "@/lib/tenancy";
import { ErrorBanner } from "../_components/parts";
import { VendorForm } from "../_components/vendor-form";
import { INVENTORY_TABS } from "../tabs";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const { error } = await searchParams;
  const orgId = ws.org.id;
  const [vendors, pos, unpaid] = await Promise.all([
    getVendors(orgId),
    db.select({ vendorId: schema.purchaseOrders.vendorId, n: sql<number>`count(*)` }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.orgId, orgId)).groupBy(schema.purchaseOrders.vendorId),
    db
      .select({ vendorId: schema.expenses.vendorId, t: sql<number>`coalesce(sum(${schema.expenses.total}), 0)` })
      .from(schema.expenses)
      .where(sql`${schema.expenses.orgId} = ${orgId} and ${schema.expenses.status} = 'unpaid'`)
      .groupBy(schema.expenses.vendorId),
  ]);
  const poCount = new Map(pos.map((p) => [p.vendorId, Number(p.n)]));
  const owed = new Map(unpaid.map((u) => [u.vendorId, Number(u.t)]));

  return (
    <>
      <PageHeader title="Inventory" description="Suppliers you buy from, with their purchase orders and unpaid bills." tabs={INVENTORY_TABS("vendors")} />
      <ErrorBanner message={error} />

      <Card title={`Vendors (${vendors.length})`}>
        {vendors.length === 0 ? (
          <EmptyState title="No vendors yet">Add your first supplier below.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Vendor</Th>
                <Th>Contact</Th>
                <Th>GSTIN</Th>
                <Th className="text-right">POs</Th>
                <Th className="text-right">Unpaid</Th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id}>
                  <Td>
                    <Link href={`/app/inventory/vendors/${v.id}`} className="font-medium hover:underline">
                      {v.name}
                    </Link>
                  </Td>
                  <Td className="text-ink-soft">{[v.email, v.phone].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td className="font-mono text-xs">{v.gstin ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{poCount.get(v.id) ?? 0}</Td>
                  <Td className={`text-right tabular-nums ${(owed.get(v.id) ?? 0) > 0 ? "font-medium text-signal" : "text-ink-soft"}`}>{formatMoney(owed.get(v.id) ?? 0, ws.org.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="New vendor" className="mt-6">
        <VendorForm />
      </Card>
    </>
  );
}
