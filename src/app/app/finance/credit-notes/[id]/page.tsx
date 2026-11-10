import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { PageHeader, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { lineTaxOption, taxSummary } from "@/lib/finance-utils";
import { formatDate, formatMoney } from "@/lib/format";
import { amountInWords } from "@/lib/money";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { PrintButton } from "../../_components/print-button";
import { TaxBreakdown } from "../../_components/tax-breakdown";
import { FINANCE_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Credit note" };

export default async function CreditNotePage({ params }: PageProps<"/app/finance/credit-notes/[id]">) {
  const ws = await requireWorkspace({ module: "finance" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const pack = packFor(ws);
  const cur = ws.org.currency;
  const [row] = await db
    .select({ n: schema.creditNotes, inv: schema.invoices })
    .from(schema.creditNotes)
    .innerJoin(schema.invoices, eq(schema.creditNotes.invoiceId, schema.invoices.id))
    .where(and(eq(schema.creditNotes.id, id), eq(schema.creditNotes.orgId, ws.org.id)))
    .limit(1);
  if (!row) notFound();
  const { n, inv } = row;
  const lines = await db.select().from(schema.creditNoteLines).where(eq(schema.creditNoteLines.creditNoteId, n.id)).orderBy(schema.creditNoteLines.id);
  const tax = taxSummary(pack, lines, inv.placeOfSupply, ws.org.state);

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={n.number} description={`Against ${inv.number} · ${inv.customerName}`} tabs={FINANCE_TABS("credit-notes")} actions={<PrintButton />} />
      </div>
      <article className="max-w-4xl rounded-[20px] border border-line bg-card p-6 md:p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
          <div>
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">{pack.tax.name === "VAT" ? "Tax credit note" : "Credit note"}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">{ws.org.name}</h2>
            {ws.org.address && <p className="mt-1 max-w-xs text-sm whitespace-pre-line text-ink-soft">{ws.org.address}</p>}
            {ws.org.gstin && (
              <p className="mt-1 text-sm text-ink-soft">
                {pack.tax.idLabel} {ws.org.gstin}
              </p>
            )}
          </div>
          <dl className="text-sm">
            <div className="flex justify-between gap-8">
              <dt className="text-ink-soft">Credit note no.</dt>
              <dd className="font-medium">{n.number}</dd>
            </div>
            <div className="flex justify-between gap-8">
              <dt className="text-ink-soft">Date</dt>
              <dd>{formatDate(n.date)}</dd>
            </div>
            <div className="flex justify-between gap-8">
              <dt className="text-ink-soft">Original invoice</dt>
              <dd>
                <Link href={`/app/finance/invoices/${inv.id}`} className="hover:underline">
                  {inv.number}
                </Link>{" "}
                ({formatDate(inv.issueDate)})
              </dd>
            </div>
            <div className="flex justify-between gap-8">
              <dt className="text-ink-soft">Place of supply</dt>
              <dd>{inv.placeOfSupply ?? ws.org.state ?? "—"}</dd>
            </div>
          </dl>
        </header>
        <section className="border-b border-line py-6">
          <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Customer</p>
          <p className="mt-1 font-medium">{inv.customerName}</p>
          {inv.billingAddress && <p className="text-sm whitespace-pre-line text-ink-soft">{inv.billingAddress}</p>}
          {inv.customerGstin && (
            <p className="text-sm text-ink-soft">
              {pack.tax.idLabel} {inv.customerGstin}
            </p>
          )}
          <p className="mt-2 text-sm">
            <span className="text-ink-soft">Reason: </span>
            {n.reason}
            {n.restock ? " · goods returned to stock" : ""}
          </p>
        </section>
        <div className="py-6">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <Th className="px-0">Description</Th>
                <Th className="px-2 text-right">Qty</Th>
                <Th className="px-2 text-right">Rate</Th>
                <Th className="px-2 text-right">Taxable value</Th>
                <Th className="px-2 text-right">{pack.tax.name}</Th>
                <Th className="px-2 text-right">Tax amount</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td className="px-0">{l.description}</Td>
                  <Td className="px-2 text-right tabular-nums">{l.quantity}</Td>
                  <Td className="px-2 text-right tabular-nums">{formatMoney(l.unitPrice, cur)}</Td>
                  <Td className="px-2 text-right tabular-nums">{formatMoney(l.amount, cur)}</Td>
                  <Td className="px-2 text-right tabular-nums">{lineTaxOption(pack, l.taxCode, l.taxRate).kind === "exempt" ? "Exempt" : `${l.taxRate}%`}</Td>
                  <Td className="px-2 text-right tabular-nums">{formatMoney(l.taxAmount, cur)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_260px]">
            <div className="text-sm">
              <TaxBreakdown rows={tax.rows} taxName={pack.tax.name} currency={cur} />
              <p className="mt-4 text-ink-soft">
                <span className="font-medium text-ink">Amount in words: </span>
                {amountInWords(n.total, cur)}
              </p>
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(n.subtotal, cur)}</dd>
              </div>
              {tax.totals.map((t) => (
                <div key={t.label} className="flex justify-between">
                  <dt className="text-ink-soft">{t.label}</dt>
                  <dd className="tabular-nums">{formatMoney(t.amount, cur)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-line pt-1.5 font-display text-lg font-bold">
                <dt>Total credit</dt>
                <dd className="tabular-nums">{formatMoney(n.total, cur)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </article>
    </>
  );
}
