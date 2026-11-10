import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ActionButton } from "@/components/app/forms";
import { PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { amountInWords } from "@/lib/money";
import { canConvertQuote, canMoveQuote, quoteDisplayStatus, quoteTaxLines, type QuoteStatus } from "@/lib/quotes";
import { canUseModule, packFor, planModules, requireWorkspace } from "@/lib/tenancy";
import { PrintButton } from "../../../inventory/_components/print-button";
import { QuoteStatusBadge } from "../../_components/quote-status";
import { CRM_TABS } from "../../tabs";
import { convertQuote, deleteQuote, setQuoteStatus } from "../actions";

export const metadata: Metadata = { title: "Quote" };

const btn = "h-10 px-4";
const primary = "h-10 bg-ink px-5 text-paper hover:bg-ink/85";
const LABEL: Partial<Record<QuoteStatus, string>> = { sent: "Mark sent", accepted: "Mark accepted", declined: "Mark declined", draft: "Revise (back to draft)" };

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; invoiced?: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const sp = await searchParams;
  const orgId = ws.org.id;
  const [q] = await db.select().from(schema.quotes).where(and(eq(schema.quotes.id, id), eq(schema.quotes.orgId, orgId))).limit(1);
  if (!q) notFound();

  const [lines, company, deal, invoice] = await Promise.all([
    db.select().from(schema.quoteLines).where(and(eq(schema.quoteLines.quoteId, id), eq(schema.quoteLines.orgId, orgId))).orderBy(schema.quoteLines.sortOrder),
    q.companyId ? db.select().from(schema.companies).where(and(eq(schema.companies.id, q.companyId), eq(schema.companies.orgId, orgId))).limit(1).then((r) => r[0]) : undefined,
    q.dealId ? db.select({ id: schema.deals.id, title: schema.deals.title }).from(schema.deals).where(and(eq(schema.deals.id, q.dealId), eq(schema.deals.orgId, orgId))).limit(1).then((r) => r[0]) : undefined,
    q.invoiceId ? db.select({ id: schema.invoices.id, number: schema.invoices.number }).from(schema.invoices).where(and(eq(schema.invoices.id, q.invoiceId), eq(schema.invoices.orgId, orgId))).limit(1).then((r) => r[0]) : undefined,
  ]);

  const pack = packFor(ws);
  const cur = ws.org.currency;
  const display = quoteDisplayStatus(q, todayYmd());
  const financeOn = planModules(ws).includes("finance");
  const moves = (["sent", "accepted", "declined", "draft"] as const).filter((s) => canMoveQuote(display, s));
  const taxLines = quoteTaxLines(pack, lines, q.placeOfSupply, ws.org.state);
  const hasDiscount = lines.some((l) => l.discountPercent > 0);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={q.number}
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              <QuoteStatusBadge status={display} /> {q.customerName}
              {deal && (
                <Link href={`/app/crm/deals/${deal.id}`} className="text-ink-mute underline-offset-2 hover:underline">
                  · Deal: {deal.title}
                </Link>
              )}
            </span>
          }
          tabs={CRM_TABS("quotes")}
          actions={
            <>
              <PrintButton />
              {q.status === "draft" && (
                <Link href={`/app/crm/quotes/${id}/edit`} className="inline-flex h-10 items-center rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
                  Edit
                </Link>
              )}
              {moves.map((s) => (
                <form key={s} action={setQuoteStatus}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value={s} />
                  <button className={`inline-flex items-center rounded-full border border-line text-sm font-medium transition hover:border-ink ${s === "sent" || s === "accepted" ? primary : btn}`}>{LABEL[s]}</button>
                </form>
              ))}
              {canConvertQuote(display) && financeOn && (
                <ActionButton action={convertQuote} fields={{ id }} confirm={`Create a draft invoice from ${q.number}?`} className={primary}>
                  Convert to invoice
                </ActionButton>
              )}
              {q.status !== "invoiced" && (
                <ActionButton action={deleteQuote} fields={{ id }} confirm={`Delete ${q.number}?`} className={`${btn} text-signal`}>
                  Delete
                </ActionButton>
              )}
            </>
          }
        />
        {sp.error && (
          <p role="alert" className="mb-5 rounded-xl bg-signal/10 px-4 py-2.5 text-sm text-signal">
            {sp.error}
          </p>
        )}
        {canConvertQuote(display) && !financeOn && (
          <p className="mb-5 rounded-xl bg-butter/60 px-4 py-2.5 text-sm">
            Converting quotes into invoices needs the Finance module, which isn&apos;t active in this workspace.{" "}
            <Link href="/app/settings" className="font-medium underline">
              Enable it in settings
            </Link>{" "}
            or{" "}
            <Link href="/app/billing" className="font-medium underline">
              upgrade your plan
            </Link>
            .
          </p>
        )}
        {display === "expired" && <p className="mb-5 rounded-xl bg-butter/60 px-4 py-2.5 text-sm">This quote passed its validity date. Revise it to draft to extend the date and resend.</p>}
        {invoice && (
          <p className="mb-5 rounded-xl bg-mint/60 px-4 py-2.5 text-sm">
            {sp.invoiced ? "Converted into draft invoice " : "Invoiced as "}
            {canUseModule(ws, "finance") ? (
              <Link href={`/app/finance/invoices/${invoice.id}`} className="font-medium underline">
                {invoice.number}
              </Link>
            ) : (
              <strong>{invoice.number}</strong>
            )}
            .
          </p>
        )}
      </div>

      <article className="rounded-[20px] border border-line bg-card p-6 md:p-10 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Quotation</p>
            <h2 className="font-display text-3xl font-bold">{q.number}</h2>
          </div>
          <dl className="text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Date</dt>
              <dd>{formatDate(q.issueDate)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Valid until</dt>
              <dd>{formatDate(q.validUntil)}</dd>
            </div>
            {q.placeOfSupply && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Place of supply</dt>
                <dd>{q.placeOfSupply}</dd>
              </div>
            )}
          </dl>
        </header>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">From</p>
            <p className="font-medium">{ws.org.name}</p>
            {ws.org.gstin && (
              <p className="font-mono text-xs">
                {pack.tax.idLabel} {ws.org.gstin}
              </p>
            )}
            {ws.org.address && <p className="whitespace-pre-line text-sm text-ink-soft">{ws.org.address}</p>}
          </div>
          <div>
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Quote for</p>
            <p className="font-medium">{q.customerName}</p>
            {company?.gstin && (
              <p className="font-mono text-xs">
                {pack.tax.idLabel} {company.gstin}
              </p>
            )}
            {company?.billingAddress && <p className="whitespace-pre-line text-sm text-ink-soft">{company.billingAddress}</p>}
            {q.customerEmail && <p className="text-sm text-ink-soft">{q.customerEmail}</p>}
          </div>
        </div>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-ink text-left font-mono text-[11px] tracking-widest text-ink-mute uppercase">
                <th className="py-2 pr-3 font-normal">#</th>
                <th className="py-2 pr-3 font-normal">Item</th>
                <th className="py-2 pr-3 text-right font-normal">Qty</th>
                <th className="py-2 pr-3 text-right font-normal">Unit price</th>
                {hasDiscount && <th className="py-2 pr-3 text-right font-normal">Disc.</th>}
                <th className="py-2 pr-3 text-right font-normal">{pack.tax.name}</th>
                <th className="py-2 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id} className="border-b border-line">
                  <td className="py-2.5 pr-3 text-ink-mute">{i + 1}</td>
                  <td className="py-2.5 pr-3">{l.description}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatMoney(l.unitPrice, cur)}</td>
                  {hasDiscount && <td className="py-2.5 pr-3 text-right tabular-nums">{l.discountPercent ? `${l.discountPercent}%` : "—"}</td>}
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {pack.tax.rates.find((r) => r.code === l.taxCode)?.label ?? `${l.taxRate}%`}
                    {l.taxAmount > 0 && <span className="text-ink-mute"> ({formatMoney(l.taxAmount, cur)})</span>}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{formatMoney(l.amount, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
          <p className="max-w-sm text-sm text-ink-soft">
            <span className="font-medium text-ink">Amount in words:</span> {amountInWords(q.total, cur)}
          </p>
          <dl className="min-w-60 space-y-1 text-sm">
            <div className="flex justify-between gap-6">
              <dt className="text-ink-soft">Subtotal</dt>
              <dd className="tabular-nums">{formatMoney(q.subtotal, cur)}</dd>
            </div>
            {taxLines.length ? (
              taxLines.map((t, i) => (
                <div key={i} className="flex justify-between gap-6">
                  <dt className="text-ink-soft">{t.label}</dt>
                  <dd className="tabular-nums">{formatMoney(t.amount, cur)}</dd>
                </div>
              ))
            ) : (
              <div className="flex justify-between gap-6">
                <dt className="text-ink-soft">{pack.tax.name}</dt>
                <dd className="tabular-nums">{formatMoney(q.taxTotal, cur)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-6 border-t border-ink pt-1 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatMoney(q.total, cur)}</dd>
            </div>
          </dl>
        </div>

        {q.terms && (
          <p className="mt-8 border-t border-line pt-4 text-sm whitespace-pre-line text-ink-soft">
            <span className="font-medium text-ink">Terms:</span> {q.terms}
          </p>
        )}
        <p className="mt-6 text-xs text-ink-mute">This quotation is not a {pack.tax.invoiceTitle.toLowerCase()}. Prices are valid until {formatDate(q.validUntil)}.</p>
      </article>
    </>
  );
}
