import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ActionButton } from "@/components/app/forms";
import { PageHeader, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney } from "@/lib/format";
import { fmtQty } from "@/lib/inventory";
import { amountInWords } from "@/lib/money";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { cancelPo, deletePo, markPoOrdered, receivePo } from "../../actions";
import { PrintButton } from "../../_components/print-button";
import { ErrorBanner } from "../../_components/parts";
import { INVENTORY_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; received?: string }> }) {
  const ws = await requireWorkspace({ module: "inventory" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const sp = await searchParams;
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const pack = packFor(ws);

  const [row] = await db
    .select({ po: schema.purchaseOrders, vendor: schema.vendors, warehouse: schema.warehouses })
    .from(schema.purchaseOrders)
    .innerJoin(schema.vendors, eq(schema.purchaseOrders.vendorId, schema.vendors.id))
    .innerJoin(schema.warehouses, eq(schema.purchaseOrders.warehouseId, schema.warehouses.id))
    .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.orgId, orgId)))
    .limit(1);
  if (!row) notFound();
  const { po, vendor, warehouse } = row;

  const lines = await db
    .select({ line: schema.purchaseOrderLines, name: schema.products.name, sku: schema.products.sku, unit: schema.products.unit })
    .from(schema.purchaseOrderLines)
    .innerJoin(schema.products, eq(schema.purchaseOrderLines.productId, schema.products.id))
    .where(eq(schema.purchaseOrderLines.poId, id))
    .orderBy(schema.purchaseOrderLines.id);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={po.number}
          description={
            <span className="inline-flex items-center gap-2">
              <StatusBadge value={po.status} /> {vendor.name}
            </span>
          }
          tabs={INVENTORY_TABS("purchase-orders")}
          actions={
            <>
              <PrintButton />
              {po.status === "draft" && (
                <>
                  <Link href={`/app/inventory/purchase-orders/${id}/edit`} className="inline-flex h-10 items-center rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
                    Edit
                  </Link>
                  <ActionButton action={markPoOrdered} fields={{ id }} className="h-10 bg-ink px-5 text-paper hover:bg-ink/85">
                    Mark ordered
                  </ActionButton>
                </>
              )}
              {po.status === "ordered" && (
                <ActionButton action={receivePo} fields={{ id }} confirm={`Receive ${po.number} into ${warehouse.name}? Stock is added and a bill is created.`} className="h-10 bg-ink px-5 text-paper hover:bg-ink/85">
                  Receive
                </ActionButton>
              )}
              {(po.status === "draft" || po.status === "ordered") && (
                <ActionButton action={cancelPo} fields={{ id }} confirm={`Cancel ${po.number}?`} className="h-10 px-4">
                  Cancel PO
                </ActionButton>
              )}
              {po.status === "draft" && (
                <ActionButton action={deletePo} fields={{ id }} confirm={`Delete ${po.number}?`} className="h-10 px-4 text-signal">
                  Delete
                </ActionButton>
              )}
            </>
          }
        />
        <ErrorBanner message={sp.error} />
        {(sp.received || po.status === "received") && (
          <p className="mb-5 rounded-xl bg-mint/60 px-4 py-2.5 text-sm">
            {sp.received ? "Received — stock was updated in " : "Received into "}
            {warehouse.name}.{" "}
            {po.expenseId ? (
              <Link href="/app/finance/expenses" className="font-medium underline">
                View the unpaid bill in Finance → Expenses
              </Link>
            ) : (
              "No bill was created (the PO-received bill automation is off)."
            )}
          </p>
        )}
      </div>

      <article className="rounded-[20px] border border-line bg-card p-6 md:p-10 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Purchase order</p>
            <h2 className="font-display text-3xl font-bold">{po.number}</h2>
            <p className="mt-1 text-sm capitalize text-ink-soft">Status: {po.status}</p>
          </div>
          <dl className="text-sm">
            <div className="flex gap-4">
              <dt className="text-ink-soft">Order date</dt>
              <dd>{formatDate(po.orderDate)}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-ink-soft">Expected</dt>
              <dd>{po.expectedDate ? formatDate(po.expectedDate) : "—"}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-ink-soft">Deliver to</dt>
              <dd>{warehouse.name}</dd>
            </div>
          </dl>
        </header>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Buyer</p>
            <p className="font-medium">{ws.org.name}</p>
            {ws.org.gstin && (
              <p className="font-mono text-xs">
                {pack.tax.idLabel} {ws.org.gstin}
              </p>
            )}
            {ws.org.address && <p className="whitespace-pre-line text-sm text-ink-soft">{ws.org.address}</p>}
          </div>
          <div>
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Vendor</p>
            <p className="font-medium">{vendor.name}</p>
            {vendor.gstin && (
              <p className="font-mono text-xs">
                {pack.tax.idLabel} {vendor.gstin}
              </p>
            )}
            {vendor.address && <p className="whitespace-pre-line text-sm text-ink-soft">{vendor.address}</p>}
            {[vendor.email, vendor.phone].filter(Boolean).length > 0 && <p className="text-sm text-ink-soft">{[vendor.email, vendor.phone].filter(Boolean).join(" · ")}</p>}
          </div>
        </div>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink font-mono text-[11px] tracking-widest text-ink-mute uppercase">
                <th className="py-2 pr-3 font-normal">#</th>
                <th className="py-2 pr-3 font-normal">Item</th>
                <th className="py-2 pr-3 text-right font-normal">Qty</th>
                <th className="py-2 pr-3 text-right font-normal">Unit cost</th>
                <th className="py-2 pr-3 text-right font-normal">{pack.tax.name}</th>
                <th className="py-2 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ line, name, sku, unit }, i) => (
                <tr key={line.id} className="border-b border-line">
                  <td className="py-2.5 pr-3 text-ink-mute">{i + 1}</td>
                  <td className="py-2.5 pr-3">
                    {name}
                    <p className="font-mono text-xs text-ink-mute">{sku}</p>
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {fmtQty(line.quantity)} {unit}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatMoney(line.unitCost, cur)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {line.taxRate}% <span className="text-ink-mute">({formatMoney(line.taxAmount, cur)})</span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{formatMoney(line.amount, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
          <p className="max-w-sm text-sm text-ink-soft">
            <span className="font-medium text-ink">Amount in words:</span> {amountInWords(po.total, cur)}
          </p>
          <dl className="min-w-60 space-y-1 text-sm">
            <div className="flex justify-between gap-6">
              <dt className="text-ink-soft">Subtotal</dt>
              <dd className="tabular-nums">{formatMoney(po.subtotal, cur)}</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="text-ink-soft">{pack.tax.name}</dt>
              <dd className="tabular-nums">{formatMoney(po.taxTotal, cur)}</dd>
            </div>
            <div className="flex justify-between gap-6 border-t border-ink pt-1 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatMoney(po.total, cur)}</dd>
            </div>
          </dl>
        </div>

        {po.notes && (
          <p className="mt-8 border-t border-line pt-4 text-sm text-ink-soft">
            <span className="font-medium text-ink">Notes:</span> {po.notes}
          </p>
        )}
      </article>
    </>
  );
}
