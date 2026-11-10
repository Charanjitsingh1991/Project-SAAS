import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Badge, Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { accountLedger } from "@/lib/finance";
import { formatDate, formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { FINANCE_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ params }: PageProps<"/app/finance/accounts/[id]">) {
  const ws = await requireWorkspace({ module: "finance" });
  const accountId = Number((await params).id);
  if (!Number.isInteger(accountId)) notFound();
  const [acct] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.orgId, ws.org.id))).limit(1);
  if (!acct) notFound();

  const cur = ws.org.currency;
  const ledger = await accountLedger(ws.org.id, acct);
  const money = (v: number) => formatMoney(v, cur);

  return (
    <>
      <PageHeader
        title={`${acct.code} · ${acct.name}`}
        description={
          <span className="flex items-center gap-2">
            <Badge>{acct.type}</Badge>
            <Link href="/app/finance/accounts" className="text-sm hover:underline">
              ← Chart of accounts
            </Link>
          </span>
        }
        tabs={FINANCE_TABS("accounts")}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Balance" value={money(ledger.closing)} tone="lime" />
        <Stat label="Total debits" value={money(ledger.lines.reduce((s, l) => s + l.debit, 0))} tone="card" />
        <Stat label="Total credits" value={money(ledger.lines.reduce((s, l) => s + l.credit, 0))} tone="card" />
      </div>
      <Card title="Ledger">
        {ledger.lines.length === 0 ? (
          <EmptyState title="No postings yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Memo</Th>
                <Th>Source</Th>
                <Th className="text-right">Debit</Th>
                <Th className="text-right">Credit</Th>
                <Th className="text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.lines.map((l) => (
                <tr key={l.lineId}>
                  <Td className="whitespace-nowrap">{formatDate(l.date)}</Td>
                  <Td>{l.memo}</Td>
                  <Td className="capitalize text-ink-soft">{l.sourceType.replace("_", " ")}</Td>
                  <Td className="text-right tabular-nums">{l.debit ? money(l.debit) : "—"}</Td>
                  <Td className="text-right tabular-nums">{l.credit ? money(l.credit) : "—"}</Td>
                  <Td className="text-right font-medium tabular-nums">{money(l.balance)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
