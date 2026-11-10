import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, formatMoneyCompact } from "@/lib/format";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { FINANCE_TABS } from "../tabs";

export const metadata: Metadata = { title: "Credit notes" };

export default async function CreditNotesPage() {
  const ws = await requireWorkspace({ module: "finance" });
  const cur = ws.org.currency;
  const pack = packFor(ws);
  const rows = await db
    .select({ n: schema.creditNotes, invoiceNumber: schema.invoices.number, customer: schema.invoices.customerName })
    .from(schema.creditNotes)
    .innerJoin(schema.invoices, eq(schema.creditNotes.invoiceId, schema.invoices.id))
    .where(eq(schema.creditNotes.orgId, ws.org.id))
    .orderBy(desc(schema.creditNotes.date), desc(schema.creditNotes.id));
  const total = rows.reduce((s, r) => s + r.n.total, 0);
  const taxTotal = rows.reduce((s, r) => s + r.n.taxTotal, 0);

  return (
    <>
      <PageHeader
        title="Credit notes"
        description={`Returns and price corrections against sent invoices. Each credit note reverses sales and ${pack.tax.name} in the ledger; issue one from the invoice page.`}
        tabs={FINANCE_TABS("credit-notes")}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Credit notes" value={rows.length} tone="card" />
        <Stat label="Total credited" value={formatMoneyCompact(total, cur)} tone="peach" />
        <Stat label={`${pack.tax.name} reversed`} value={formatMoneyCompact(taxTotal, cur)} tone="butter" />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No credit notes yet">Open a sent invoice and use “Issue credit note” to credit some or all of its lines.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Date</Th>
                <Th>Invoice</Th>
                <Th>Customer</Th>
                <Th>Reason</Th>
                <Th className="text-right">Taxable</Th>
                <Th className="text-right">{pack.tax.name}</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ n, invoiceNumber, customer }) => (
                <tr key={n.id} className="hover:bg-paper/60">
                  <Td>
                    <Link href={`/app/finance/credit-notes/${n.id}`} className="font-medium hover:underline">
                      {n.number}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(n.date)}</Td>
                  <Td>
                    <Link href={`/app/finance/invoices/${n.invoiceId}`} className="hover:underline">
                      {invoiceNumber}
                    </Link>
                  </Td>
                  <Td>{customer}</Td>
                  <Td className="text-ink-soft">
                    {n.reason}
                    {n.restock ? " · restocked" : ""}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(n.subtotal, cur)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(n.taxTotal, cur)}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatMoney(n.total, cur)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
