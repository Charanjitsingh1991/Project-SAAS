import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { invoiceDisplayStatus } from "@/lib/finance-utils";
import { daysBetween, formatDate, formatMoney, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { FINANCE_TABS } from "../tabs";

export const metadata: Metadata = { title: "Invoices" };

const STATUSES = ["all", "draft", "sent", "partial", "paid", "void", "overdue"] as const;

export default async function InvoicesPage({ searchParams }: PageProps<"/app/finance/invoices">) {
  const ws = await requireWorkspace({ module: "finance" });
  const sp = await searchParams;
  const cur = ws.org.currency;
  const today = todayYmd();
  const status = (STATUSES as readonly string[]).includes(String(sp.status)) ? String(sp.status) : "all";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  const all = await db.select().from(schema.invoices).where(eq(schema.invoices.orgId, ws.org.id)).orderBy(desc(schema.invoices.issueDate), desc(schema.invoices.id));
  const withStatus = all.map((i) => ({ ...i, display: invoiceDisplayStatus(i, today) }));
  const counts: Record<string, number> = { all: withStatus.length };
  for (const s of STATUSES.slice(1)) counts[s] = withStatus.filter((i) => (s === "overdue" ? i.display === "overdue" : i.status === s)).length;

  const rows = withStatus.filter(
    (i) =>
      (status === "all" || (status === "overdue" ? i.display === "overdue" : i.status === status)) &&
      (!q || i.number.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q)),
  );

  const href = (s: string) => `/app/finance/invoices?${new URLSearchParams({ ...(s !== "all" ? { status: s } : {}), ...(q ? { q } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="GST-ready invoices with automatic numbering, ledger posting and payment tracking."
        tabs={FINANCE_TABS("invoices")}
        actions={
          <>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page */}
            <a href="/api/export/invoices" className="inline-flex h-10 items-center rounded-full border border-ink/20 px-5 text-sm font-medium hover:border-ink">
              Export CSV
            </a>
            <Link href="/app/finance/invoices/new" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink/85">
              New invoice
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={href(s)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium capitalize transition",
                status === s ? "border-ink bg-ink text-paper" : "border-line hover:border-ink",
              )}
            >
              {s} <span className="opacity-60">{counts[s]}</span>
            </Link>
          ))}
        </div>
        <form className="flex gap-2" action="/app/finance/invoices">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search number or customer"
            aria-label="Search invoices"
            className="h-9 w-64 rounded-full border border-line bg-paper/60 px-4 text-sm outline-none focus:border-ink"
          />
          <button className="h-9 rounded-full border border-ink/20 px-4 text-sm font-medium hover:border-ink">Search</button>
        </form>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No invoices found">{all.length === 0 ? "Create your first invoice to get started." : "Try another status or search."}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Customer</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th className="text-right">Days overdue</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Balance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const open = i.status === "sent" || i.status === "partial";
                const late = open ? daysBetween(i.dueDate, today) : 0;
                return (
                  <tr key={i.id} className="hover:bg-paper/60">
                    <Td>
                      <Link href={`/app/finance/invoices/${i.id}`} className="font-medium hover:underline">
                        {i.number}
                      </Link>
                    </Td>
                    <Td>{i.customerName}</Td>
                    <Td className="whitespace-nowrap">{formatDate(i.issueDate)}</Td>
                    <Td className="whitespace-nowrap">{formatDate(i.dueDate)}</Td>
                    <Td className={cn("text-right tabular-nums", late > 0 && "font-medium text-signal")}>{late > 0 ? late : "—"}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(i.total, cur)}</Td>
                    <Td className="text-right tabular-nums">{i.status === "void" ? "—" : formatMoney(i.total - i.amountPaid, cur)}</Td>
                    <Td>
                      <StatusBadge value={i.display} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
