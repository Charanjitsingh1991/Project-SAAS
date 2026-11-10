import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { formatMoney } from "@/lib/format";
import { fmtQty, isLowStock, marginPct } from "@/lib/inventory";
import { getProductsWithStock, getVendors, getWarehouses } from "@/lib/inventory-data";
import { requireWorkspace } from "@/lib/tenancy";
import { ExportLink, Qty, filterInput } from "../_components/parts";
import { ProductForm } from "../_components/product-form";
import { INVENTORY_TABS } from "../tabs";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; status?: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const category = sp.category ?? "";
  const status = sp.status === "inactive" || sp.status === "all" ? sp.status : "active";
  const cur = ws.org.currency;

  const [all, vendors, warehouses] = await Promise.all([getProductsWithStock(ws.org.id), getVendors(ws.org.id), getWarehouses(ws.org.id)]);
  const categories = [...new Set(all.map((p) => p.category).filter((c): c is string => !!c))].sort();
  const rows = all.filter(
    (p) =>
      (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? "").toLowerCase().includes(q)) &&
      (!category || p.category === category) &&
      (status === "all" || (status === "active" ? p.active : !p.active)),
  );

  return (
    <>
      <PageHeader title="Inventory" description="Every SKU with live stock, weighted-average cost and margin." tabs={INVENTORY_TABS("products")} actions={<ExportLink href="/api/export/products" />} />

      <form className="mb-5 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, SKU or barcode" className={`${filterInput} w-72 max-w-full`} />
        <select name="category" defaultValue={category} aria-label="Category" className={filterInput}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} aria-label="Status" className={filterInput}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <button className="h-10 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">Filter</button>
      </form>

      <Card title={`Products (${rows.length})`}>
        {rows.length === 0 ? (
          <EmptyState title={all.length ? "No products match" : "No products yet"}>{all.length ? "Try different filters." : "Add your first product below."}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Name</Th>
                <Th>Category</Th>
                <Th className="text-right">On hand</Th>
                <Th className="text-right">Reorder</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Price</Th>
                <Th className="text-right">Margin</Th>
                <Th className="text-right">Value</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const m = marginPct(p.costPrice, p.sellingPrice);
                return (
                  <tr key={p.id}>
                    <Td className="font-mono text-xs">{p.sku}</Td>
                    <Td>
                      <Link href={`/app/inventory/products/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      {!p.active && <span className="ml-2"><StatusBadge value="inactive" /></span>}
                    </Td>
                    <Td className="text-ink-soft">{p.category ?? "—"}</Td>
                    <Td className="text-right">
                      <Qty value={p.onHand} low={p.trackStock && isLowStock(p.onHand, p.reorderLevel)} />
                    </Td>
                    <Td className="text-right tabular-nums text-ink-soft">{fmtQty(p.reorderLevel)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p.costPrice, cur)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p.sellingPrice, cur)}</Td>
                    <Td className="text-right tabular-nums text-ink-soft">{m === null ? "—" : `${m.toFixed(1)}%`}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(Math.round(p.onHand * p.costPrice), cur)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="New product" className="mt-6">
        <ProductForm vendors={vendors} warehouses={warehouses} />
      </Card>
    </>
  );
}
