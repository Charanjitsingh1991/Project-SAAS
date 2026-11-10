import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { adjustStock, createProduct, deleteProduct } from "./actions";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const ws = await requireWorkspace({ module: "inventory" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;

  const [products, movements] = await Promise.all([
    db.select().from(schema.products).where(eq(schema.products.orgId, orgId)).orderBy(schema.products.name),
    db
      .select({ m: schema.stockMovements, name: schema.products.name })
      .from(schema.stockMovements)
      .innerJoin(schema.products, eq(schema.stockMovements.productId, schema.products.id))
      .where(eq(schema.stockMovements.orgId, orgId))
      .orderBy(desc(schema.stockMovements.createdAt), desc(schema.stockMovements.id))
      .limit(10),
  ]);

  const units = products.reduce((s, p) => s + p.quantity, 0);
  const value = products.reduce((s, p) => s + p.quantity * p.unitCost, 0);
  const low = products.filter((p) => p.quantity <= p.reorderLevel);

  return (
    <>
      <PageHeader title="Inventory" description="Track products, stock levels and movements." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="SKUs" value={products.length} tone="sky" />
        <Stat label="Units in stock" value={units.toLocaleString("en-IN")} tone="mint" />
        <Stat label="Stock value" value={formatMoney(value, cur)} tone="lilac" />
        <Stat label="Low stock" value={low.length} tone={low.length ? "rose" : "butter"} />
      </div>

      {low.length > 0 && (
        <Card title="Low stock" className="mb-6">
          <ul className="divide-y divide-line/70 text-sm">
            {low.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-medium">{p.name}</span> <span className="font-mono text-xs text-ink-mute">{p.sku}</span>
                </span>
                <span className="text-ink-soft">
                  {p.quantity} left (reorder at {p.reorderLevel}) · <span className="font-medium text-signal">Reorder</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title={`Products (${products.length})`}>
            {products.length === 0 ? (
              <EmptyState title="No products yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Product</Th>
                    <Th>Category</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Reorder</Th>
                    <Th className="text-right">Unit cost</Th>
                    <Th className="text-right">Value</Th>
                    <Th>Adjust stock</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <Td>
                        <p className="font-medium">{p.name}</p>
                        <p className="font-mono text-xs text-ink-mute">{p.sku}</p>
                      </Td>
                      <Td className="text-ink-soft">{p.category ?? "—"}</Td>
                      <Td className={`text-right font-bold tabular-nums ${p.quantity <= p.reorderLevel ? "text-signal" : ""}`}>{p.quantity}</Td>
                      <Td className="text-right tabular-nums text-ink-soft">{p.reorderLevel}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(p.unitCost, cur)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(p.quantity * p.unitCost, cur)}</Td>
                      <Td>
                        <form action={adjustStock} className="flex items-center gap-2">
                          <input type="hidden" name="productId" value={p.id} />
                          <input
                            name="change"
                            type="number"
                            step={1}
                            required
                            placeholder="±"
                            aria-label={`Adjust ${p.name} stock`}
                            className="h-8 w-20 rounded-lg border border-line bg-paper px-2 text-sm"
                          />
                          <SubmitButton variant="outline" className="h-8 px-3 text-xs">
                            Apply
                          </SubmitButton>
                        </form>
                      </Td>
                      <Td className="text-right">
                        <ActionButton action={deleteProduct} fields={{ id: p.id }} confirm={`Delete ${p.name} and its history?`} className="text-xs text-signal hover:underline">
                          Delete
                        </ActionButton>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title="Recent movements">
            {movements.length === 0 ? (
              <EmptyState title="No stock movements yet" />
            ) : (
              <ul className="divide-y divide-line/70 text-sm">
                {movements.map(({ m, name }) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <span className="font-medium">{name}</span>
                      <span className="ml-2 text-ink-soft">{m.note ?? "—"}</span>
                    </span>
                    <span className="flex items-center gap-4">
                      <span className={`font-medium tabular-nums ${m.change > 0 ? "text-green-700" : "text-signal"}`}>
                        {m.change > 0 ? "+" : "−"}
                        {Math.abs(m.change)}
                      </span>
                      <span className="text-xs text-ink-mute">{formatDateTime(m.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Add product" className="h-fit">
          <ActionForm action={createProduct} className="space-y-3">
            <Input label="Name" name="name" />
            <Input label="SKU" name="sku" />
            <Input label="Category (optional)" name="category" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Opening qty" name="quantity" type="number" min={0} step={1} defaultValue={0} />
              <Input label="Reorder level" name="reorderLevel" type="number" min={0} step={1} defaultValue={0} />
            </div>
            <Input label={`Unit cost (${cur})`} name="unitCost" type="number" min={0} step={1} defaultValue={0} />
            <SubmitButton className="w-full">Add product</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
