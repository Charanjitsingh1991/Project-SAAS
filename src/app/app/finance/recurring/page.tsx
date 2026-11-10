import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, ne } from "drizzle-orm";
import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { addDaysYmd, formatDate, formatDateTime, formatMoney, todayYmd } from "@/lib/format";
import { hasFeature, requireWorkspace } from "@/lib/tenancy";
import { ConfirmAction } from "../_components/confirm-action";
import { UpgradeHint } from "../_components/upgrade-hint";
import { FINANCE_TABS } from "../tabs";
import { createScheduleAction, deleteScheduleAction, generateNowAction, runDueAction, toggleScheduleAction } from "./actions";

export const metadata: Metadata = { title: "Recurring invoices" };

export default async function RecurringPage() {
  const ws = await requireWorkspace({ module: "finance" });
  const header = (actions?: React.ReactNode) => (
    <PageHeader
      title="Recurring invoices"
      description="Retainers and subscriptions: each cycle copies the template invoice's customer, lines and payment terms into a new invoice."
      tabs={FINANCE_TABS("recurring")}
      actions={actions}
    />
  );
  if (!hasFeature(ws, "recurringInvoices")) {
    return (
      <>
        {header()}
        <UpgradeHint feature="recurringInvoices" title="Recurring invoices">
          Bill retainers and subscriptions automatically every month, quarter or year — as drafts for review or sent straight to the ledger.
        </UpgradeHint>
      </>
    );
  }

  const cur = ws.org.currency;
  const today = todayYmd();
  const [schedules, invoices] = await Promise.all([
    db
      .select({ r: schema.recurringInvoices, inv: schema.invoices })
      .from(schema.recurringInvoices)
      .innerJoin(schema.invoices, eq(schema.recurringInvoices.templateInvoiceId, schema.invoices.id))
      .where(eq(schema.recurringInvoices.orgId, ws.org.id))
      .orderBy(desc(schema.recurringInvoices.active), schema.recurringInvoices.nextDate),
    db
      .select({ id: schema.invoices.id, number: schema.invoices.number, customer: schema.invoices.customerName, total: schema.invoices.total })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orgId, ws.org.id), ne(schema.invoices.status, "void")))
      .orderBy(desc(schema.invoices.issueDate), desc(schema.invoices.id))
      .limit(200),
  ]);
  const scheduled = new Set(schedules.map((s) => s.r.templateInvoiceId));
  const due = schedules.filter((s) => s.r.active && s.r.nextDate <= today).length;

  return (
    <>
      {header(
        <>
          <ConfirmAction action={runDueAction} fields={{}} confirm={`Generate every due invoice now (${due} schedule${due === 1 ? "" : "s"} due)?`}>
            Run due now
          </ConfirmAction>
          <Link href="/app/finance/recurring/new" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink/85">
            New recurring invoice
          </Link>
        </>,
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          {schedules.length === 0 ? (
            <EmptyState title="No recurring schedules">Create a new recurring invoice, or repeat an existing one.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Template</Th>
                  <Th>Customer</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Repeats</Th>
                  <Th>Next</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {schedules.map(({ r, inv }) => (
                  <tr key={r.id} className="align-top">
                    <Td>
                      <Link href={`/app/finance/invoices/${inv.id}`} className="font-medium hover:underline">
                        {inv.number}
                      </Link>
                      {r.lastGeneratedAt && <span className="block text-xs text-ink-mute">last run {formatDateTime(r.lastGeneratedAt)}</span>}
                    </Td>
                    <Td>{inv.customerName}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(inv.total, cur)}</Td>
                    <Td className="capitalize">
                      {r.frequency}
                      <span className="block text-xs text-ink-mute normal-case">{r.autoSend ? "sent automatically" : "created as drafts"}</span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {formatDate(r.nextDate)}
                      {r.endDate && <span className="block text-xs text-ink-mute">until {formatDate(r.endDate)}</span>}
                    </Td>
                    <Td>
                      <StatusBadge value={r.active ? (r.nextDate <= today ? "due" : "active") : "paused"} />
                    </Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {r.active && (
                          <ConfirmAction action={generateNowAction} fields={{ id: r.id }} confirm={`Generate the ${formatDate(r.nextDate)} invoice now?`} className="h-7 px-3 text-xs">
                            Generate now
                          </ConfirmAction>
                        )}
                        <ConfirmAction action={toggleScheduleAction} fields={{ id: r.id }} className="h-7 px-3 text-xs">
                          {r.active ? "Pause" : "Resume"}
                        </ConfirmAction>
                        <ConfirmAction action={deleteScheduleAction} fields={{ id: r.id }} confirm="Delete this schedule? Invoices already generated are kept." variant="danger" className="h-7 px-3 text-xs">
                          Delete
                        </ConfirmAction>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Repeat an existing invoice" className="h-fit">
          <ActionForm action={createScheduleAction} className="space-y-3">
            <Select
              label="Template invoice"
              name="templateInvoiceId"
              placeholder="— Choose an invoice —"
              options={invoices.filter((i) => !scheduled.has(i.id)).map((i) => ({ value: i.id, label: `${i.number} · ${i.customer} · ${formatMoney(i.total, cur)}` }))}
              className="[&_select]:normal-case"
            />
            <Select label="Repeat" name="frequency" options={["monthly", "quarterly", "yearly"]} defaultValue="monthly" />
            <Input label="Next invoice date" name="nextDate" type="date" defaultValue={addDaysYmd(today, 1)} required />
            <Input label="End date (optional)" name="endDate" type="date" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="autoSend" className="size-4 accent-ink" /> Send automatically (posts to the ledger)
            </label>
            <SubmitButton className="w-full">Create schedule</SubmitButton>
            <p className="text-xs text-ink-mute">Paused schedules resume from today — missed cycles are not back-filled.</p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
