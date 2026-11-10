import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Card, PageHeader, StatusBadge, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { invoiceDisplayStatus, isIntraState, splitGst, taxByRate } from "@/lib/finance-utils";
import { daysBetween, formatDate, formatDateTime, formatMoney, todayYmd } from "@/lib/format";
import { amountInWords, fromMinor } from "@/lib/money";
import { requireWorkspace } from "@/lib/tenancy";
import { deleteDraftInvoice, deletePaymentAction, recordPaymentAction, sendInvoiceAction, voidInvoiceAction } from "../../actions";
import { ConfirmAction } from "../../_components/confirm-action";
import { PrintButton } from "../../_components/print-button";
import { FINANCE_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/app/finance/invoices/[id]">) {
  const ws = await requireWorkspace({ module: "finance" });
  const invoiceId = Number((await params).id);
  if (!Number.isInteger(invoiceId)) notFound();
  const orgId = ws.org.id;
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.orgId, orgId))).limit(1);
  if (!inv) notFound();

  const [lines, pays, [deal], [project]] = await Promise.all([
    db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, inv.id)).orderBy(asc(schema.invoiceLines.sortOrder)),
    db.select().from(schema.payments).where(and(eq(schema.payments.invoiceId, inv.id), eq(schema.payments.orgId, orgId))).orderBy(asc(schema.payments.date), asc(schema.payments.id)),
    inv.dealId ? db.select({ id: schema.deals.id, title: schema.deals.title }).from(schema.deals).where(and(eq(schema.deals.id, inv.dealId), eq(schema.deals.orgId, orgId))).limit(1) : Promise.resolve([]),
    inv.projectId ? db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(and(eq(schema.projects.id, inv.projectId), eq(schema.projects.orgId, orgId))).limit(1) : Promise.resolve([]),
  ]);

  const cur = ws.org.currency;
  const today = todayYmd();
  const balance = inv.total - inv.amountPaid;
  const intra = isIntraState(inv.placeOfSupply, ws.org.state);
  const gst = splitGst(inv.taxTotal, intra);
  const rateRows = taxByRate(lines);
  const display = invoiceDisplayStatus(inv, today);
  const open = inv.status === "sent" || inv.status === "partial";
  const late = open ? daysBetween(inv.dueDate, today) : 0;

  const timeline = [
    { label: "Created", at: formatDateTime(inv.createdAt), done: true },
    { label: "Sent", at: inv.sentAt ? formatDateTime(inv.sentAt) : "", done: !!inv.sentAt },
    ...pays.map((p) => ({ label: `Payment ${formatMoney(p.amount, cur)}`, at: formatDate(p.date), done: true })),
    ...(inv.status === "paid" ? [{ label: "Paid in full", at: "", done: true }] : []),
    ...(inv.status === "void" ? [{ label: "Voided", at: "", done: true }] : []),
  ];

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-3">
              {inv.number}
              <StatusBadge value={display} />
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

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <article className="rounded-[20px] border border-line bg-card p-6 md:p-8 print:rounded-none print:border-0 print:p-0">
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
            <div>
              <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Tax invoice</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">{ws.org.name}</h2>
              {ws.org.address && <p className="mt-1 max-w-xs text-sm whitespace-pre-line text-ink-soft">{ws.org.address}</p>}
              <p className="mt-1 text-sm text-ink-soft">
                {ws.org.gstin && <>GSTIN {ws.org.gstin}</>}
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
              {inv.customerGstin && <p className="text-sm text-ink-soft">GSTIN {inv.customerGstin}</p>}
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
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr>
                    <Th className="px-0">#</Th>
                    <Th className="px-2">Description</Th>
                    <Th className="px-2 text-right">Qty</Th>
                    <Th className="px-2 text-right">Rate</Th>
                    <Th className="px-2 text-right">Taxable value</Th>
                    <Th className="px-2 text-right">GST %</Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.id}>
                      <Td className="px-0 text-ink-mute">{i + 1}</Td>
                      <Td className="px-2">{l.description}</Td>
                      <Td className="px-2 text-right tabular-nums">{l.quantity}</Td>
                      <Td className="px-2 text-right tabular-nums">{formatMoney(l.unitPrice, cur)}</Td>
                      <Td className="px-2 text-right tabular-nums">{formatMoney(l.amount, cur)}</Td>
                      <Td className="px-2 text-right tabular-nums">{l.taxRate}%</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_280px]">
              <div className="text-sm">
                {rateRows.length > 0 && (
                  <table className="w-full max-w-sm text-left text-xs">
                    <thead>
                      <tr className="font-mono tracking-widest text-ink-mute uppercase">
                        <th className="pb-1 font-normal">GST %</th>
                        <th className="pb-1 text-right font-normal">Taxable</th>
                        {intra ? (
                          <>
                            <th className="pb-1 text-right font-normal">CGST</th>
                            <th className="pb-1 text-right font-normal">SGST</th>
                          </>
                        ) : (
                          <th className="pb-1 text-right font-normal">IGST</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rateRows.map((r) => {
                        const s = splitGst(r.tax, intra);
                        return (
                          <tr key={r.rate}>
                            <td className="py-0.5">{r.rate}%</td>
                            <td className="py-0.5 text-right tabular-nums">{formatMoney(r.taxable, cur)}</td>
                            {intra ? (
                              <>
                                <td className="py-0.5 text-right tabular-nums">{formatMoney(s.cgst, cur)}</td>
                                <td className="py-0.5 text-right tabular-nums">{formatMoney(s.sgst, cur)}</td>
                              </>
                            ) : (
                              <td className="py-0.5 text-right tabular-nums">{formatMoney(s.igst, cur)}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
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
                {intra ? (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-ink-soft">CGST</dt>
                      <dd className="tabular-nums">{formatMoney(gst.cgst, cur)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-soft">SGST</dt>
                      <dd className="tabular-nums">{formatMoney(gst.sgst, cur)}</dd>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between">
                    <dt className="text-ink-soft">IGST</dt>
                    <dd className="tabular-nums">{formatMoney(gst.igst, cur)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatMoney(inv.total, cur)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Paid</dt>
                  <dd className="tabular-nums">{formatMoney(inv.amountPaid, cur)}</dd>
                </div>
                <div className="flex justify-between font-display text-lg font-bold">
                  <dt>Balance due</dt>
                  <dd className="tabular-nums">{inv.status === "void" ? "—" : formatMoney(balance, cur)}</dd>
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
          {open && (
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

          <Card title="Payments">
            {pays.length === 0 ? (
              <p className="text-sm text-ink-soft">No payments yet.</p>
            ) : (
              <ul className="space-y-3">
                {pays.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <p className="font-medium tabular-nums">{formatMoney(p.amount, cur)}</p>
                      <p className="text-xs text-ink-mute capitalize">
                        {formatDate(p.date)} · {p.method.replace("_", " ")}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </p>
                    </div>
                    <ConfirmAction action={deletePaymentAction} fields={{ paymentId: p.id }} confirm="Delete this payment? The ledger entry will be reversed." className="h-7 px-3 text-xs">
                      Delete
                    </ConfirmAction>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Timeline">
            <ol className="space-y-3 border-l border-line pl-4">
              {timeline.map((t, i) => (
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
