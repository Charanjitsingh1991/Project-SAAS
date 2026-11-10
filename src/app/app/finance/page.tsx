import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { ActionForm, Input, StatusSelect, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { createInvoice, setInvoiceStatus } from "./actions";
import { FINANCE_TABS } from "./tabs";

export const metadata: Metadata = { title: "Invoices" };

function addDays(ymd: string, n: number) {
  return new Date(Date.parse(ymd) + n * 86_400_000).toISOString().slice(0, 10);
}

export default async function InvoicesPage() {
  const ws = await requireWorkspace({ module: "finance" });
  const cur = ws.org.currency;
  const today = todayYmd();

  const rows = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.orgId, ws.org.id))
    .orderBy(desc(schema.invoices.issueDate), desc(schema.invoices.id));

  const isOverdue = (i: (typeof rows)[number]) => i.status === "sent" && i.dueDate < today;
  const sum = (list: typeof rows) => list.reduce((s, i) => s + i.amount, 0);
  const sent = rows.filter((i) => i.status === "sent");
  const overdue = rows.filter(isOverdue);
  const paid = rows.filter((i) => i.status === "paid");
  const drafts = rows.filter((i) => i.status === "draft");

  const maxSuffix = rows.reduce((m, i) => {
    const match = /(\d+)\s*$/.exec(i.number);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 1000);
  const nextNumber = `INV-${maxSuffix + 1}`;

  return (
    <>
      <PageHeader title="Finance" description="Create invoices and track what's been paid." tabs={FINANCE_TABS("invoices")} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Outstanding" value={formatMoney(sum(sent), cur)} hint={`${sent.length} sent`} tone="butter" />
        <Stat label="Overdue" value={formatMoney(sum(overdue), cur)} hint={`${overdue.length} invoice${overdue.length === 1 ? "" : "s"}`} tone="rose" />
        <Stat label="Collected" value={formatMoney(sum(paid), cur)} hint={`${paid.length} paid`} tone="mint" />
        <Stat label="Drafts" value={drafts.length} tone="sky" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title={`Invoices (${rows.length})`}>
          {rows.length === 0 ? (
            <EmptyState title="No invoices yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>Customer</Th>
                  <Th>Issued</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <Td className="font-mono text-xs">{i.number}</Td>
                    <Td>
                      <p className="font-medium">{i.customerName}</p>
                      {i.customerEmail && <p className="text-xs text-ink-mute">{i.customerEmail}</p>}
                    </Td>
                    <Td className="text-ink-soft">{formatDate(i.issueDate)}</Td>
                    <Td className="text-ink-soft">
                      <div className="flex items-center gap-2">
                        {formatDate(i.dueDate)}
                        {isOverdue(i) && <StatusBadge value="overdue" />}
                      </div>
                    </Td>
                    <Td className="text-right font-medium tabular-nums">{formatMoney(i.amount, cur)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={i.status} />
                        <StatusSelect action={setInvoiceStatus} id={i.id} value={i.status} options={["draft", "sent", "paid", "void"]} />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="New invoice" className="h-fit">
          <ActionForm action={createInvoice} className="space-y-3">
            <Input key={nextNumber} label="Invoice number" name="number" defaultValue={nextNumber} />
            <Input label="Customer name" name="customerName" />
            <Input label="Customer email (optional)" name="customerEmail" type="email" />
            <Input label={`Amount (${cur})`} name="amount" type="number" min={1} step={1} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Issue date" name="issueDate" type="date" defaultValue={today} />
              <Input label="Due date" name="dueDate" type="date" defaultValue={addDays(today, 15)} />
            </div>
            <SubmitButton className="w-full">Create invoice</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
