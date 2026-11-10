import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, SubmitButton } from "@/components/app/forms";
import { PageHeader, Stat, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney } from "@/lib/format";
import { fmtQty } from "@/lib/inventory";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { cancelStockCount, saveStockCount } from "../../actions";
import { ErrorBanner } from "../../_components/parts";
import { INVENTORY_TABS } from "../../tabs";
import { CompleteCountButton } from "../complete-button";
import { countSummary, lineVariance } from "../utils";

export const metadata: Metadata = { title: "Stock count" };

const cell = "h-9 w-28 rounded-lg border border-line bg-paper/60 px-2 text-right text-sm tabular-nums outline-none focus:border-ink focus:bg-card";

export default async function StockCountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; completed?: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const sp = await searchParams;
  const orgId = ws.org.id;
  const cur = ws.org.currency;

  const [row] = await db
    .select({ sc: schema.stockCounts, warehouse: schema.warehouses.name })
    .from(schema.stockCounts)
    .innerJoin(schema.warehouses, eq(schema.stockCounts.warehouseId, schema.warehouses.id))
    .where(and(eq(schema.stockCounts.id, id), eq(schema.stockCounts.orgId, orgId)))
    .limit(1);
  if (!row) notFound();
  const { sc, warehouse } = row;

  const lines = await db
    .select({ line: schema.stockCountLines, name: schema.products.name, sku: schema.products.sku, unit: schema.products.unit, cost: schema.products.costPrice, live: schema.stockLevels.quantity })
    .from(schema.stockCountLines)
    .innerJoin(schema.products, eq(schema.stockCountLines.productId, schema.products.id))
    .leftJoin(schema.stockLevels, and(eq(schema.stockLevels.productId, schema.stockCountLines.productId), eq(schema.stockLevels.warehouseId, sc.warehouseId)))
    .where(and(eq(schema.stockCountLines.countId, id), eq(schema.stockCountLines.orgId, orgId)))
    .orderBy(asc(schema.products.sku));

  const open = sc.status === "in_progress";
  const summary = countSummary(lines.map((l) => ({ expectedQty: l.line.expectedQty, countedQty: l.line.countedQty, cost: l.cost })));
  const drifted = open && lines.some((l) => Math.abs((l.live ?? 0) - l.line.expectedQty) > 1e-9);

  const table = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[11px] tracking-widest text-ink-mute uppercase">
            <th className="py-2 pr-3 font-normal">Product</th>
            <th className="py-2 pr-3 text-right font-normal">Expected</th>
            <th className="py-2 pr-3 text-right font-normal">Counted</th>
            <th className="py-2 pr-3 text-right font-normal">Variance</th>
            <th className="py-2 text-right font-normal">Value</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ line, name, sku, unit, cost, live }) => {
            const v = lineVariance(line);
            const moved = open && Math.abs((live ?? 0) - line.expectedQty) > 1e-9;
            return (
              <tr key={line.id} className="border-b border-line/70">
                <td className="py-2 pr-3">
                  {name}
                  <p className="font-mono text-xs text-ink-mute">
                    {sku} · {unit}
                  </p>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {fmtQty(line.expectedQty)}
                  {moved && <span className="block text-[11px] text-signal">now {fmtQty(live ?? 0)}</span>}
                </td>
                <td className="py-2 pr-3 text-right">
                  {open ? (
                    <input name={`c_${line.id}`} inputMode="decimal" defaultValue={line.countedQty ?? ""} aria-label={`Counted ${name}`} placeholder="—" className={cell} />
                  ) : (
                    <span className="tabular-nums">{line.countedQty === null ? "—" : fmtQty(line.countedQty)}</span>
                  )}
                </td>
                <td className={cn("py-2 pr-3 text-right tabular-nums", v !== null && v < 0 && "text-signal", v !== null && v > 0 && "text-ink")}>
                  {v === null ? "—" : `${v > 0 ? "+" : ""}${fmtQty(v)}`}
                </td>
                <td className="py-2 text-right tabular-nums">{v === null || !v ? "—" : formatMoney(Math.round(v * cost), cur)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader
        title={sc.number}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge value={sc.status} /> {warehouse} · started {formatDate(sc.createdAt)}
            {sc.completedAt && ` · completed ${formatDate(sc.completedAt)}`}
          </span>
        }
        tabs={INVENTORY_TABS("stock-counts")}
        actions={
          open && (
            <ActionButton action={cancelStockCount} fields={{ id: sc.id }} confirm={`Cancel ${sc.number}? Nothing is posted.`} className="h-10 px-4">
              Cancel count
            </ActionButton>
          )
        }
      />
      <ErrorBanner message={sp.error} />
      {sp.completed && <p className="mb-5 rounded-xl bg-mint/60 px-4 py-2.5 text-sm">Count completed — variances were posted as stock adjustments (see Movements).</p>}
      {sc.note && <p className="mb-5 text-sm text-ink-soft">{sc.note}</p>}

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Counted" value={`${summary.counted} / ${summary.total}`} tone="sky" />
        <Stat label="Lines with variance" value={summary.withVariance} tone="butter" />
        <Stat label="Shortage" value={formatMoney(summary.loss, cur)} tone="rose" />
        <Stat label="Net variance" value={formatMoney(summary.net, cur)} hint={`Surplus ${formatMoney(summary.gain, cur)}`} tone="mint" />
      </div>

      <section className="rounded-[20px] border border-line bg-card p-5">
        {open ? (
          <ActionForm action={saveStockCount} resetOnSuccess={false} className="space-y-4">
            <input type="hidden" name="id" value={sc.id} />
            {drifted && (
              <p className="rounded-xl bg-butter/60 px-3 py-2 text-sm">Stock moved since this count started. On completion, adjustments are posted against the live quantity so the counted figure becomes the new on-hand.</p>
            )}
            {table}
            <p className="text-xs text-ink-mute">Leave a line blank to skip it — only counted lines are adjusted.</p>
            <div className="flex flex-wrap gap-2">
              <SubmitButton variant="outline">Save counts</SubmitButton>
              <CompleteCountButton number={sc.number} />
            </div>
          </ActionForm>
        ) : (
          table
        )}
      </section>
    </>
  );
}
