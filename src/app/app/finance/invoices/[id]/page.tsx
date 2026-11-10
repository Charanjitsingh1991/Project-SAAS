import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Card, PageHeader, StatusBadge, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { invoiceDisplayStatus, lineTaxOption, taxSummary } from "@/lib/finance-utils";
import { addDaysYmd, daysBetween, formatDate, formatDateTime, formatMoney, todayYmd } from "@/lib/format";
import { amountInWords, fromMinor } from "@/lib/money";
import { hasFeature, packFor, requireWorkspace } from "@/lib/tenancy";
import { deleteDraftInvoice, deletePaymentAction, recordPaymentAction, sendInvoiceAction, voidInvoiceAction } from "../../actions";
import { issueCreditNoteAction, refundAction } from "../../credit-notes/actions";
import { createScheduleAction } from "../../recurring/actions";
import { ConfirmAction } from "../../_components/confirm-action";
import { CreditNoteForm } from "../../_components/credit-note-form";
import { PrintButton } from "../../_components/print-button";
import { TaxBreakdown } from "../../_components/tax-breakdown";
import { FINANCE_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Invoice" };

const MONTHS = { monthly: 1, quarterly: 3, yearly: 12 } as const;
const addMonths = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate())).toISOString().slice(0, 10);
};

export default async function InvoicePage({ params }: PageProps<"/app/finance/invoices/[id]">) {
  const ws = await requireWorkspace({ module: "finance" });
  const invoiceId = Number((await params).id);
  if (!Number.isInteger(invoiceId)) notFound();
  const orgId = ws.org.id;
  const pack = packFor(ws);
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.orgId, orgId))).limit(1);
  if (!inv) notFound();

  const [lines, pays, notes, noteLines, [schedule], [deal], [project]] = await Promise.all([
    db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, inv.id)).orderBy(asc(schema.invoiceLines.sortOrder)),
    db.select().from(schema.payments).where(and(eq(schema.payments.invoiceId, inv.id), eq(schema.payments.orgId, orgId))).orderBy(asc(schema.payments.date), asc(schema.payments.id)),
    db.select().from(schema.creditNotes).where(and(eq(schema.creditNotes.invoiceId, inv.id), eq(schema.creditNotes.orgId, orgId))).orderBy(asc(schema.creditNotes.date), asc(schema.creditNotes.id)),
    db
      .select({ lineId: schema.creditNoteLines.invoiceLineId, qty: schema.creditNoteLines.quantity })
      .from(schema.creditNoteLines)
      .innerJoin(schema.creditNotes, eq(schema.creditNoteLines.creditNoteId, schema.creditNotes.id))
      .where(and(eq(schema.creditNotes.invoiceId, inv.id), eq(schema.creditNotes.orgId, orgId))),
    db.select().from(schema.recurringInvoices).where(and(eq(schema.recurringInvoices.templateInvoiceId, inv.id), eq(schema.recurringInvoices.orgId, orgId))).limit(1),
    inv.dealId ? db.select({ id: schema.deals.id, title: schema.deals.title }).from(schema.deals).where(and(eq(schema.deals.id, inv.dealId), eq(schema.deals.orgId, orgId))).limit(1) : Promise.resolve([]),
    inv.projectId ? db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(and(eq(schema.projects.id, inv.projectId), eq(schema.projects.orgId, orgId))).limit(1) : Promise.resolve([]),
  ]);

  const cur = ws.org.currency;
  const today = todayYmd();
  const balance = inv.total - inv.amountPaid - inv.amountCredited;
  const creditBalance = -balance;
  const tax = taxSummary(pack, lines, inv.placeOfSupply, ws.org.state);
  const display = invoiceDisplayStatus(inv, today);
  const open = inv.status === "sent" || inv.status === "partial";
  const posted = open || inv.status === "paid";
  const late = open ? daysBetween(inv.dueDate, today) : 0;
  const canRecur = hasFeature(ws, "recurringInvoices");

  const creditedQty = new Map<number, number>();
  for (const n of noteLines) if (n.lineId) creditedQty.set(n.lineId, (creditedQty.get(n.lineId) ?? 0) + n.qty);
  const creditable = lines
    .map((l) => ({
      id: l.id,
      description: l.description,
      remaining: Math.round((l.quantity - (creditedQty.get(l.id) ?? 0)) * 1000) / 1000,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      hasProduct: !!l.productId,
    }))
    .filter((l) => l.remaining > 0);

  const timeline = [
    { date: "", label: "Created", at: formatDateTime(inv.createdAt), done: true },
    { date: "", label: "Sent", at: inv.sentAt ? formatDateTime(inv.sentAt) : "", done: !!inv.sentAt },
    ...pays.map((p) => ({ date: p.date, label: p.amount < 0 ? `Refund ${formatMoney(-p.amount, cur)}` : `Payment ${formatMoney(p.amount, cur)}`, at: formatDate(p.date), done: true })),
    ...notes.map((n) => ({ date: n.date, label: `Credit note ${n.number} · ${formatMoney(n.total, cur)}`, at: formatDate(n.date), done: true })),
  ];
  const events = [...timeline.slice(0, 2), ...timeline.slice(2).sort((a, b) => a.date.localeCompare(b.date))];
  if (inv.status === "paid") events.push({ date: "", label: balance < 0 ? "Settled · customer in credit" : "Paid in full", at: "", done: true });
  if (inv.status === "void") events.push({ date: "", label: "Voided", at: "", done: true });

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-3">
              {inv.number}
              <StatusBadge value={display} />
              {schedule && <StatusBadge value={schedule.active ? `repeats ${schedule.frequency}` : "recurring paused"} />}
            </span>
          }
          description={`${inv.customerName} · due ${formatDate(inv.dueDate)}${late > 0 ? ` · ${late} days overdue` : ""}`}
          tabs={FINANCE_TABS("invoices")}
          actions={
            <>
              <PrintButton />
              {inv.status === "draft" && (
                <>
                  <Link href={`/app/finance/invoices/${inv.id}/edit`} className="inline-flex h-9 items-center rounded-full border border-ink/20 px-4 text-sm font-medium hover:border-ink">
                    Edit
                  </Link>
                  <ConfirmAction action={sendInvoiceAction} fields={{ invoiceId: inv.id }} variant="ink">
                    Send invoice
                  </ConfirmAction>
                  <ConfirmAction action={deleteDraftInvoice} fields={{ invoiceId: inv.id }} confirm={`Delete draft ${inv.number}?`} variant="danger">
                    Delete draft
                  </ConfirmAction>
                </>
              )}
              {inv.status !== "draft" && inv.status !== "void" && (
                <ConfirmAction action={voidInvoiceAction} fields={{ invoiceId: inv.id }} confirm={`Void ${inv.number}? The ledger entries will be reversed.`} variant="danger">
                  Void
                </ConfirmAction>
              )}
            </>
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <article className="rounded-[20px] border border-line bg-card p-6 md:p-8 print:rounded-none print:border-0 print:p-0">
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
            <div>
              <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">{pack.tax.invoiceTitle}</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">{ws.org.name}</h2>
              {ws.org.address && <p className="mt-1 max-w-xs text-sm whitespace-pre-line text-ink-soft">{ws.org.address}</p>}
              <p className="mt-1 text-sm text-ink-soft">
                {ws.org.gstin && (
                  <>
                    {pack.tax.idLabel} {ws.org.gstin}
                  </>
                )}
                {ws.org.gstin && ws.org.state && " · "}
                {ws.org.state}
              </p>
            </div>
            <dl className="text-sm">
              <div className="flex justify-between gap-8">
                <dt className="text-ink-soft">Invoice no.</dt>
                <dd className="font-medium">{inv.number}</dd>
              </div>
              <div className="flex justify-between gap-8">
                <dt className="text-ink-soft">Issue date</dt>
                <dd>{formatDate(inv.issueDate)}</dd>
              </div>
              <div className="flex justify-between gap-8">
                <dt className="text-ink-soft">Due date</dt>
                <dd>{formatDate(inv.dueDate)}</dd>
              </div>
              <div className="flex justify-between gap-8">
                <dt className="text-ink-soft">Place of supply</dt>
                <dd>{inv.placeOfSupply ?? ws.org.state ?? "—"}</dd>
              </div>
            </dl>
          </header>

          <section className="grid gap-6 border-b border-line py-6 sm:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Bill to</p>
              <p className="mt-1 font-medium">{inv.customerName}</p>
              {inv.billingAddress && <p className="text-sm whitespace-pre-line text-ink-soft">{inv.billingAddress}</p>}
              {inv.customerEmail && <p className="text-sm text-ink-soft">{inv.customerEmail}</p>}
              {inv.customerGstin && (
                <p className="text-sm text-ink-soft">
                  {pack.tax.idLabel} {inv.customerGstin}
                </p>
              )}
            </div>
            {(deal || project) && (
              <div className="print:hidden">
                <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Linked</p>
                {deal && (
                  <p className="mt-1 text-sm">
                    Deal:{" "}
                    <Link href={`/app/crm/deals/${deal.id}`} className="font-medium underline">
                      {deal.title}
                    </Link>
                  </p>
                )}
                {project && (
                  <p className="mt-1 text-sm">
                    Project:{" "}
                    <Link href={`/app/projects/${project.id}`} className="font-medium underline">
                      {project.name}
                    </Link>
                  </p>
                )}
              </div>
            )}
          </section>

          <div className="py-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead>
                  <tr>
                    <Th className="px-0">#</Th>
                    <Th className="px-2">Description</Th>
                    <Th className="px-2 text-right">Qty</Th>
                    <Th className="px-2 text-right">Rate</Th>
                    <Th className="px-2 text-right">Taxable value</Th>
                    <Th className="px-2 text-right">{pack.tax.name}</Th>
                    <Th className="px-2 text-right">Tax amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const opt = lineTaxOption(pack, l.taxCode, l.taxRate);
                    return (
                      <tr key={l.id}>
                        <Td className="px-0 text-ink-mute">{i + 1}</Td>
                        <Td className="px-2">{l.description}</Td>
                        <Td className="px-2 text-right tabular-nums">{l.quantity}</Td>
                        <Td className="px-2 text-right tabular-nums">{formatMoney(l.unitPrice, cur)}</Td>
                        <Td className="px-2 text-right tabular-nums">{formatMoney(l.amount, cur)}</Td>
                        <Td className="px-2 text-right whitespace-nowrap tabular-nums">{opt.kind === "exempt" ? "Exempt" : `${l.taxRate}%`}</Td>
                        <Td className="px-2 text-right tabular-nums">{formatMoney(l.taxAmount, cur)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_280px]">
              <div className="text-sm">
                <TaxBreakdown rows={tax.rows} taxName={pack.tax.name} currency={cur} />
                <p className="mt-4 text-ink-soft">
                  <span className="font-medium text-ink">Amount in words: </span>
                  {amountInWords(inv.total, cur)}
                </p>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Subtotal</dt>
                  <dd className="tabular-nums">{formatMoney(inv.subtotal, cur)}</dd>
                </div>
                {tax.totals.map((t) => (
                  <div key={t.label} className="flex justify-between">
                    <dt className="text-ink-soft">{t.label}</dt>
                    <dd className="tabular-nums">{formatMoney(t.amount, cur)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatMoney(inv.total, cur)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Paid</dt>
                  <dd className="tabular-nums">{formatMoney(inv.amountPaid, cur)}</dd>
                </div>
                {inv.amountCredited > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-soft">Credited</dt>
                    <dd className="tabular-nums">{formatMoney(inv.amountCredited, cur)}</dd>
                  </div>
                )}
                <div className="flex justify-between font-display text-lg font-bold">
                  <dt>{balance < 0 ? "Customer credit" : "Balance due"}</dt>
                  <dd className="tabular-nums">{inv.status === "void" ? "—" : formatMoney(Math.abs(balance), cur)}</dd>
                </div>
              </dl>
            </div>
          </div>

          {inv.notes && (
            <footer className="border-t border-line pt-4 text-sm text-ink-soft">
              <p className="font-medium text-ink">Notes</p>
              <p className="whitespace-pre-line">{inv.notes}</p>
            </footer>
          )}
        </article>

        <aside className="space-y-6 print:hidden">
          {open && balance > 0 && (
            <Card title="Record payment">
              <ActionForm action={recordPaymentAction} className="space-y-3">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Input label="Date" name="date" type="date" defaultValue={today} required />
                <Input label={`Amount (max ${formatMoney(balance, cur)})`} name="amount" inputMode="decimal" defaultValue={fromMinor(balance)} required />
                <Select label="Method" name="method" options={schema.PAYMENT_METHODS} defaultValue="bank_transfer" />
                <Input label="Reference" name="reference" placeholder="UTR / cheque no." />
                <SubmitButton className="w-full">Record payment</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {posted && creditBalance > 0 && (
            <Card title="Refund customer">
              <ActionForm action={refundAction} className="space-y-3">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <p className="text-sm text-ink-soft">The customer has {formatMoney(creditBalance, cur)} in credit on this invoice. A refund is paid from the bank account.</p>
                <Input label="Date" name="date" type="date" defaultValue={today} required />
                <Input label={`Amount (max ${formatMoney(creditBalance, cur)})`} name="amount" inputMode="decimal" defaultValue={fromMinor(creditBalance)} required />
                <SubmitButton className="w-full">Record refund</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {posted && creditable.length > 0 && (
            <Card title="Issue credit note">
              <CreditNoteForm key={inv.amountCredited} action={issueCreditNoteAction} invoiceId={inv.id} lines={creditable} currency={cur} today={today} taxName={pack.tax.name} />
            </Card>
          )}

          {notes.length > 0 && (
            <Card title="Credit notes" actions={<Link href="/app/finance/credit-notes" className="text-sm text-ink-soft hover:text-ink">All</Link>}>
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <Link href={`/app/finance/credit-notes/${n.id}`} className="font-medium hover:underline">
                        {n.number}
                      </Link>
                      <p className="text-xs text-ink-mute">
                        {formatDate(n.date)} · {n.reason}
                        {n.restock ? " · restocked" : ""}
                      </p>
                    </div>
                    <span className="font-medium tabular-nums">{formatMoney(n.total, cur)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Payments">
            {pays.length === 0 ? (
              <p className="text-sm text-ink-soft">No payments yet.</p>
            ) : (
              <ul className="space-y-3">
                {pays.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <p className="font-medium tabular-nums">{p.amount < 0 ? `Refund ${formatMoney(-p.amount, cur)}` : formatMoney(p.amount, cur)}</p>
                      <p className="text-xs text-ink-mute capitalize">
                        {formatDate(p.date)} · {p.method.replace("_", " ")}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </p>
                    </div>
                    {p.amount > 0 && (
                      <ConfirmAction action={deletePaymentAction} fields={{ paymentId: p.id }} confirm="Delete this payment? The ledger entry will be reversed." className="h-7 px-3 text-xs">
                        Delete
                      </ConfirmAction>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {schedule ? (
            <Card title="Recurring" actions={<Link href="/app/finance/recurring" className="text-sm text-ink-soft hover:text-ink">Manage</Link>}>
              <p className="text-sm">
                Repeats <span className="font-medium">{schedule.frequency}</span> · next {formatDate(schedule.nextDate)}
                {schedule.endDate ? ` · until ${formatDate(schedule.endDate)}` : ""}
                {schedule.autoSend ? " · sent automatically" : " · created as drafts"}
                {!schedule.active ? " · paused" : ""}
              </p>
            </Card>
          ) : (
            inv.status !== "void" &&
            (canRecur ? (
              <Card title="Make recurring">
                <ActionForm action={createScheduleAction} className="space-y-3">
                  <input type="hidden" name="templateInvoiceId" value={inv.id} />
                  <Select label="Repeat" name="frequency" options={Object.keys(MONTHS)} defaultValue="monthly" />
                  <Input label="Next invoice date" name="nextDate" type="date" defaultValue={addMonths(inv.issueDate, 1) < today ? addDaysYmd(today, 1) : addMonths(inv.issueDate, 1)} required />
                  <Input label="End date (optional)" name="endDate" type="date" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="autoSend" className="size-4 accent-ink" /> Send automatically (posts to the ledger)
                  </label>
                  <SubmitButton className="w-full" variant="outline">
                    Create schedule
                  </SubmitButton>
                </ActionForm>
              </Card>
            ) : (
              <p className="text-xs text-ink-mute">
                Recurring invoices are on the Growth plan.{" "}
                <Link href="/app/billing?upgrade=recurringInvoices" className="underline">
                  Upgrade
                </Link>
              </p>
            ))
          )}

          <Card title="Timeline">
            <ol className="space-y-3 border-l border-line pl-4">
              {events.map((t, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-ink" />
                  <p className="font-medium">{t.label}</p>
                  {t.at && <p className="text-xs text-ink-mute">{t.at}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
