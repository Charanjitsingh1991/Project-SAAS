import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { dashboard } from "@/lib/finance";
import { AGING_BUCKETS, AGING_LABEL, invoiceDisplayStatus, type AgingBucket } from "@/lib/finance-utils";
import { daysBetween, formatDate, formatMoney, formatMoneyCompact, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { FINANCE_TABS } from "./tabs";

export const metadata: Metadata = { title: "Finance" };

const BUCKET_COLOR: Record<AgingBucket, string> = {
  current: "bg-mint",
  "1-30": "bg-butter",
  "31-60": "bg-peach",
  "61-90": "bg-rose",
  "90+": "bg-signal",
};

export default async function FinancePage() {
  const ws = await requireWorkspace({ module: "finance" });
  const cur = ws.org.currency;
  const today = todayYmd();
  const d = await dashboard(ws.org.id, today);
  const { ar } = d;

  return (
    <>
      <PageHeader
        title="Finance"
        description="Invoices, bills and a live double-entry ledger — every number below comes straight from the books."
        tabs={FINANCE_TABS("overview")}
        actions={
          <Link href="/app/finance/invoices/new" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink/85">
            New invoice
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Receivables outstanding" value={formatMoneyCompact(ar.total, cur)} hint={`${ar.invoices.length} open invoice${ar.invoices.length === 1 ? "" : "s"}`} tone="sky" />
        <Stat label="Overdue" value={formatMoneyCompact(ar.overdueAmount, cur)} hint={`${ar.overdueCount} invoice${ar.overdueCount === 1 ? "" : "s"} past due`} tone={ar.overdueCount ? "rose" : "mint"} />
        <Stat label="Collected this month" value={formatMoneyCompact(d.collectedThisMonth, cur)} tone="mint" />
        <Stat label={`Net profit · FY ${d.fiscal[0].slice(0, 4)}–${d.fiscal[1].slice(2, 4)}`} value={formatMoneyCompact(d.netProfit, cur)} hint="Income − expenses from the ledger" tone="lilac" />
        <Stat label="GST payable (net)" value={formatMoneyCompact(d.gstNet, cur)} hint={d.gstNet < 0 ? "Input credit exceeds output" : "Output − input credit"} tone="butter" />
        <Stat label="Cash balance" value={formatMoneyCompact(d.cash, cur)} hint="Bank & cash account" tone="lime" />
      </div>

      <Card title="Receivables aging" className="mb-6">
        {ar.total === 0 ? (
          <EmptyState title="Nothing outstanding">Sent invoices with a balance will show up here.</EmptyState>
        ) : (
          <>
            <div className="flex h-4 overflow-hidden rounded-full bg-ink/5" role="img" aria-label="Receivables aging">
              {AGING_BUCKETS.map((b) => (
                <div key={b} className={BUCKET_COLOR[b]} style={{ width: `${(ar.totals[b] / ar.total) * 100}%` }} title={`${AGING_LABEL[b]}: ${formatMoney(ar.totals[b], cur)}`} />
              ))}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
              {AGING_BUCKETS.map((b) => (
                <div key={b}>
                  <dt className="flex items-center gap-1.5 font-mono text-[11px] tracking-widest text-ink-mute uppercase">
                    <span className={`size-2 rounded-full ${BUCKET_COLOR[b]}`} />
                    {AGING_LABEL[b]}
                  </dt>
                  <dd className="mt-1 font-display text-lg font-semibold tabular-nums">{formatMoney(ar.totals[b], cur)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recent invoices" actions={<Link href="/app/finance/invoices" className="text-sm text-ink-soft hover:text-ink">View all</Link>}>
          {d.recent.length === 0 ? (
            <EmptyState title="No invoices yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Customer</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <Link href={`/app/finance/invoices/${i.id}`} className="font-medium hover:underline">
                        {i.number}
                      </Link>
                    </Td>
                    <Td>{i.customerName}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(i.total, cur)}</Td>
                    <Td>
                      <StatusBadge value={invoiceDisplayStatus(i, today)} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Unpaid bills" actions={<Link href="/app/finance/expenses?status=unpaid" className="text-sm text-ink-soft hover:text-ink">View all</Link>}>
          {d.bills.length === 0 ? (
            <EmptyState title="No unpaid bills" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Bill</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {d.bills.map(({ e, vendor }) => {
                  const days = e.dueDate ? daysBetween(today, e.dueDate) : null;
                  return (
                    <tr key={e.id}>
                      <Td>
                        <span className="font-medium">{e.description}</span>
                        {vendor && <span className="block text-xs text-ink-mute">{vendor}</span>}
                      </Td>
                      <Td>
                        {e.dueDate ? formatDate(e.dueDate) : "—"}
                        {days !== null && (
                          <span className={`block text-xs ${days < 0 ? "text-signal" : "text-ink-mute"}`}>
                            {days < 0 ? `${-days}d overdue` : days === 0 ? "due today" : `in ${days}d`}
                          </span>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(e.total, cur)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
