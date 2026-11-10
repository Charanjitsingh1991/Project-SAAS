import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { getWarehouses } from "@/lib/inventory-data";
import { requireWorkspace } from "@/lib/tenancy";
import { createStockCount } from "../actions";
import { INVENTORY_TABS } from "../tabs";

export const metadata: Metadata = { title: "Stock counts" };

export default async function StockCountsPage() {
  const ws = await requireWorkspace({ module: "inventory" });
  const orgId = ws.org.id;
  const [warehouses, counts, progress, categories] = await Promise.all([
    getWarehouses(orgId),
    db
      .select({ sc: schema.stockCounts, warehouse: schema.warehouses.name })
      .from(schema.stockCounts)
      .innerJoin(schema.warehouses, eq(schema.stockCounts.warehouseId, schema.warehouses.id))
      .where(eq(schema.stockCounts.orgId, orgId))
      .orderBy(desc(schema.stockCounts.createdAt), desc(schema.stockCounts.id)),
    db
      .select({
        countId: schema.stockCountLines.countId,
        total: sql<number>`count(*)`,
        counted: sql<number>`sum(case when ${schema.stockCountLines.countedQty} is not null then 1 else 0 end)`,
        variances: sql<number>`sum(case when ${schema.stockCountLines.countedQty} is not null and abs(${schema.stockCountLines.countedQty} - ${schema.stockCountLines.expectedQty}) > 1e-9 then 1 else 0 end)`,
      })
      .from(schema.stockCountLines)
      .where(eq(schema.stockCountLines.orgId, orgId))
      .groupBy(schema.stockCountLines.countId),
    db.selectDistinct({ c: schema.products.category }).from(schema.products).where(and(eq(schema.products.orgId, orgId), isNotNull(schema.products.category))),
  ]);
  const prog = new Map(progress.map((p) => [p.countId, p]));

  return (
    <>
      <PageHeader title="Inventory" description="Cycle counts: snapshot a warehouse, record what's on the shelf, post the variances." tabs={INVENTORY_TABS("stock-counts")} />

      <Card title={`Counts (${counts.length})`} className="mb-6">
        {counts.length === 0 ? (
          <EmptyState title="No stock counts yet">Start your first count below.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Warehouse</Th>
                <Th>Started</Th>
                <Th>Progress</Th>
                <Th>Variances</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {counts.map(({ sc, warehouse }) => {
                const p = prog.get(sc.id);
                return (
                  <tr key={sc.id}>
                    <Td>
                      <Link href={`/app/inventory/stock-counts/${sc.id}`} className="font-mono font-medium hover:underline">
                        {sc.number}
                      </Link>
                      {sc.note && <p className="text-xs text-ink-mute">{sc.note}</p>}
                    </Td>
                    <Td>{warehouse}</Td>
                    <Td className="text-ink-soft">{formatDate(sc.createdAt)}</Td>
                    <Td className="tabular-nums">
                      {Number(p?.counted ?? 0)} / {Number(p?.total ?? 0)}
                    </Td>
                    <Td className="tabular-nums">{Number(p?.variances ?? 0)}</Td>
                    <Td>
                      <StatusBadge value={sc.status} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Start a count">
        <ActionForm action={createStockCount} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Warehouse" name="warehouseId" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} defaultValue={warehouses[0]?.id} />
            <Select label="Category (optional)" name="category" placeholder="All products" options={categories.map((c) => c.c!).sort().map((c) => ({ value: c, label: c }))} />
            <Input label="Note" name="note" placeholder="e.g. Quarter-end count" />
          </div>
          <SubmitButton>Start count</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
