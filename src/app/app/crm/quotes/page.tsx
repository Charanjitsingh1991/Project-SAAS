import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import { Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { quoteDisplayStatus, type QuoteStatus } from "@/lib/quotes";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { QuoteStatusBadge } from "../_components/quote-status";
import { CRM_TABS } from "../tabs";

export const metadata: Metadata = { title: "Quotes" };

const FILTERS: (QuoteStatus | "all")[] = ["all", "draft", "sent", "accepted", "declined", "expired", "invoiced"];

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const sp = await searchParams;
  const filter = FILTERS.includes(sp.status as QuoteStatus) ? (sp.status as QuoteStatus) : "all";
  const cur = ws.org.currency;
  const today = todayYmd();

  const rows = await db.select().from(schema.quotes).where(eq(schema.quotes.orgId, ws.org.id)).orderBy(desc(schema.quotes.createdAt), desc(schema.quotes.id));
  const quotes = rows.map((q) => ({ ...q, display: quoteDisplayStatus(q, today) }));
  const shown = filter === "all" ? quotes : quotes.filter((q) => q.display === filter);

  const sum = (s: QuoteStatus[]) => quotes.filter((q) => s.includes(q.display)).reduce((a, q) => a + q.total, 0);
  const decided = quotes.filter((q) => ["accepted", "declined", "invoiced"].includes(q.display));
  const won = decided.filter((q) => q.display !== "declined").length;

  return (
    <>
      <PageHeader
        title="CRM"
        description="Priced proposals with country tax, validity and one-click conversion to invoices."
        tabs={CRM_TABS("quotes")}
        actions={
          <Link href="/app/crm/quotes/new" className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink/85">
            <Plus className="size-4" /> New quote
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Open quotes" value={formatMoney(sum(["draft", "sent"]), cur)} hint="Draft & sent, still valid" tone="sky" />
        <Stat label="Accepted" value={formatMoney(sum(["accepted", "invoiced"]), cur)} hint="Accepted or invoiced" tone="mint" />
        <Stat label="Acceptance rate" value={decided.length ? `${Math.round((won / decided.length) * 100)}%` : "—"} hint={`${decided.length} decided quotes`} tone="butter" />
      </div>

      <nav className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/app/crm/quotes" : `/app/crm/quotes?status=${f}`}
            className={cn("h-8 rounded-full border px-3 text-xs leading-8 font-medium capitalize", filter === f ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}
          >
            {f}
          </Link>
        ))}
      </nav>

      <Card title={`Quotes (${shown.length})`}>
        {shown.length === 0 ? (
          <EmptyState title={filter === "all" ? "No quotes yet" : `No ${filter} quotes`}>
            {filter === "all" ? "Create a quote for a company or deal to send a priced proposal." : "Try another filter."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th>Valid until</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((q) => (
                <tr key={q.id}>
                  <Td>
                    <Link href={`/app/crm/quotes/${q.id}`} className="font-mono font-medium hover:underline">
                      {q.number}
                    </Link>
                  </Td>
                  <Td>{q.customerName}</Td>
                  <Td className="text-ink-soft">{formatDate(q.issueDate)}</Td>
                  <Td className={cn("text-ink-soft", q.display === "expired" && "text-signal")}>{formatDate(q.validUntil)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(q.total, cur)}</Td>
                  <Td>
                    <QuoteStatusBadge status={q.display} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
