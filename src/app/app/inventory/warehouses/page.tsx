import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoney } from "@/lib/format";
import { fmtQty } from "@/lib/inventory";
import { getWarehouses } from "@/lib/inventory-data";
import { requireWorkspace } from "@/lib/tenancy";
import { createWarehouse, deleteWarehouse, setDefaultWarehouse, updateWarehouse } from "../actions";
import { ErrorBanner } from "../_components/parts";
import { INVENTORY_TABS } from "../tabs";

export const metadata: Metadata = { title: "Warehouses" };

const check = "size-4 rounded border-line accent-ink";

export default async function WarehousesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const { error } = await searchParams;
  const orgId = ws.org.id;
  const [warehouses, levels] = await Promise.all([
    getWarehouses(orgId),
    db
      .select({ warehouseId: schema.stockLevels.warehouseId, qty: schema.stockLevels.quantity, cost: schema.products.costPrice })
      .from(schema.stockLevels)
      .innerJoin(schema.products, eq(schema.stockLevels.productId, schema.products.id))
      .where(eq(schema.stockLevels.orgId, orgId)),
  ]);
  const stats = new Map<number, { value: number; units: number; skus: number }>();
  for (const l of levels) {
    const s = stats.get(l.warehouseId) ?? { value: 0, units: 0, skus: 0 };
    s.value += Math.round(l.qty * l.cost);
    s.units += l.qty;
    if (l.qty !== 0) s.skus++;
    stats.set(l.warehouseId, s);
  }

  return (
    <>
      <PageHeader title="Inventory" description="Locations that hold stock. Exactly one is the default for receipts and new POs." tabs={INVENTORY_TABS("warehouses")} />
      <ErrorBanner message={error} />

      {warehouses.length === 0 ? (
        <EmptyState title="No warehouses yet">Add your first location below.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {warehouses.map((w) => {
            const s = stats.get(w.id);
            return (
              <Card
                key={w.id}
                title={
                  <span className="flex items-center gap-2">
                    {w.name} <span className="font-mono text-xs font-normal text-ink-mute">{w.code}</span>
                    {w.isDefault && <Badge tone="mint">default</Badge>}
                  </span>
                }
              >
                <p className="font-display text-2xl font-bold">{formatMoney(s?.value ?? 0, ws.org.currency)}</p>
                <p className="text-sm text-ink-soft">
                  {fmtQty(s?.units ?? 0)} units across {s?.skus ?? 0} SKUs
                </p>
                {w.address && <p className="mt-2 text-sm text-ink-soft">{w.address}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  {!w.isDefault && (
                    <ActionButton action={setDefaultWarehouse} fields={{ id: w.id }}>
                      Make default
                    </ActionButton>
                  )}
                  {!w.isDefault && (
                    <ActionButton action={deleteWarehouse} fields={{ id: w.id }} confirm={`Delete ${w.name}?`} className="text-signal">
                      Delete
                    </ActionButton>
                  )}
                </div>
                <details className="mt-4 border-t border-line pt-3">
                  <summary className="cursor-pointer text-sm font-medium">Edit</summary>
                  <ActionForm action={updateWarehouse} resetOnSuccess={false} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={w.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input label="Name" name="name" defaultValue={w.name} />
                      <Input label="Code" name="code" defaultValue={w.code} />
                    </div>
                    <Input label="Address" name="address" defaultValue={w.address ?? ""} />
                    {!w.isDefault && (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="isDefault" className={check} /> Set as default
                      </label>
                    )}
                    <SubmitButton variant="outline">Save</SubmitButton>
                  </ActionForm>
                </details>
              </Card>
            );
          })}
        </div>
      )}

      <Card title="New warehouse" className="mt-6">
        <ActionForm action={createWarehouse} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Name" name="name" placeholder="Bengaluru WH" />
            <Input label="Code" name="code" placeholder="BLR" />
            <Input label="Address" name="address" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isDefault" className={check} /> Set as default
          </label>
          <SubmitButton>Add warehouse</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
