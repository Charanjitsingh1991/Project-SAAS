import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { formatMoney } from "@/lib/format";
import { fmtQty, groupByVendor, isLowStock, suggestedQty } from "@/lib/inventory";
import { getProductsWithStock, getVendors } from "@/lib/inventory-data";
import { requireWorkspace } from "@/lib/tenancy";
import { SubmitButton } from "@/components/app/forms";
import { createDraftPoFromReorder } from "../actions";
import { ErrorBanner, Qty, filterInput } from "../_components/parts";
import { INVENTORY_TABS } from "../tabs";

export const metadata: Metadata = { title: "Reorder planner" };


export default async function ReorderPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const { error } = await searchParams;
  const cur = ws.org.currency;
  const [products, vendors] = await Promise.all([getProductsWithStock(ws.org.id), getVendors(ws.org.id)]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

  const candidates = products
    .filter((p) => p.active && p.trackStock && isLowStock(p.onHand, p.reorderLevel))
    .map((p) => ({ ...p, productId: p.id, qty: suggestedQty(p.onHand, p.reorderLevel, p.reorderQty) || 1 }));
  const groups = groupByVendor(candidates);

  return (
    <>
      <PageHeader title="Inventory" description="Everything at or below its reorder level, grouped by preferred vendor." tabs={INVENTORY_TABS("reorder")} />
      <ErrorBanner message={error} />

      {groups.length === 0 ? (
        <EmptyState title="Nothing to reorder">Every tracked product is above its reorder level.</EmptyState>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const total = g.rows.reduce((s, r) => s + Math.round(r.qty * r.costPrice), 0);
            return (
              <Card
                key={g.vendorId ?? "none"}
                title={
                  g.vendorId ? (
                    <Link href={`/app/inventory/vendors/${g.vendorId}`} className="hover:underline">
                      {vendorName.get(g.vendorId) ?? "Vendor"}
                    </Link>
                  ) : (
                    "No preferred vendor"
                  )
                }
                actions={
                  <form action={createDraftPoFromReorder} className="flex items-center gap-2">
                    <input type="hidden" name="group" value={g.vendorId ?? "none"} />
                    {g.vendorId === null && (
                      <select name="vendorId" aria-label="Vendor for this PO" required defaultValue="" className={`${filterInput} h-9`}>
                        <option value="" disabled>
                          Choose vendor…
                        </option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <SubmitButton>Create draft PO</SubmitButton>
                  </form>
                }
              >
                <Table>
                  <thead>
                    <tr>
                      <Th>Product</Th>
                      <Th className="text-right">On hand</Th>
                      <Th className="text-right">Reorder level</Th>
                      <Th className="text-right">Suggested qty</Th>
                      <Th className="text-right">Last cost</Th>
                      <Th className="text-right">Est. cost</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <Td>
                          <Link href={`/app/inventory/products/${r.id}`} className="font-medium hover:underline">
                            {r.name}
                          </Link>
                          <p className="font-mono text-xs text-ink-mute">{r.sku}</p>
                        </Td>
                        <Td className="text-right">
                          <Qty value={r.onHand} low />
                        </Td>
                        <Td className="text-right tabular-nums text-ink-soft">{fmtQty(r.reorderLevel)}</Td>
                        <Td className="text-right font-medium tabular-nums">{fmtQty(r.qty)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(r.costPrice, cur)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(Math.round(r.qty * r.costPrice), cur)}</Td>
                      </tr>
                    ))}
                    <tr>
                      <Td className="font-medium" >Total (excl. GST)</Td>
                      <Td /> <Td /> <Td /> <Td />
                      <Td className="text-right font-semibold tabular-nums">{formatMoney(total, cur)}</Td>
                    </tr>
                  </tbody>
                </Table>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

