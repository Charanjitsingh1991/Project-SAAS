import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoney, formatMoneyCompact, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { FINANCE_TABS } from "../tabs";

export const metadata: Metadata = { title: "Customer statements" };

export default async function StatementsPage() {
  const ws = await requireWorkspace({ module: "finance" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const today = todayYmd();
  const [companies, open] = await Promise.all([
    db.select().from(schema.companies).where(eq(schema.companies.orgId, orgId)).orderBy(asc(schema.companies.name)),
    db
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orgId, orgId), inArray(schema.invoices.status, ["sent", "partial"]))),
  ]);

  const byCompany = new Map<number, { outstanding: number; overdue: number; count: number }>();
  for (const i of open) {
    if (i.companyId == null) continue;
    const bal = i.total - i.amountPaid - i.amountCredited;
    if (bal <= 0) continue;
    const row = byCompany.get(i.companyId) ?? { outstanding: 0, overdue: 0, count: 0 };
    row.outstanding += bal;
    row.count += 1;
    if (i.dueDate < today) row.overdue += bal;
    byCompany.set(i.companyId, row);
  }
  const rows = companies
    .map((c) => ({ c, ...(byCompany.get(c.id) ?? { outstanding: 0, overdue: 0, count: 0 }) }))
    .sort((a, b) => b.outstanding - a.outstanding || a.c.name.localeCompare(b.c.name));
  const totalOut = rows.reduce((s, r) => s + r.outstanding, 0);
  const totalOver = rows.reduce((s, r) => s + r.overdue, 0);

  return (
    <>
      <PageHeader
        title="Customer statements"
        description="Statements of account for each customer company. Invoices not linked to a company are not listed here."
        tabs={FINANCE_TABS("statements")}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Customers" value={rows.length} tone="card" />
        <Stat label="Outstanding" value={formatMoneyCompact(totalOut, cur)} tone="butter" />
        <Stat label="Overdue" value={formatMoneyCompact(totalOver, cur)} tone="peach" />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No customers yet">Add companies in CRM and link invoices to them to produce statements.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th className="text-right">Open invoices</Th>
                <Th className="text-right">Outstanding</Th>
                <Th className="text-right">Overdue</Th>
                <Th className="text-right">Statement</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.c.id} className="hover:bg-paper/60">
                  <Td className="font-medium">{r.c.name}</Td>
                  <Td className="text-right tabular-nums">{r.count}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.outstanding, cur)}</Td>
                  <Td className={`text-right tabular-nums ${r.overdue > 0 ? "text-danger" : ""}`}>{formatMoney(r.overdue, cur)}</Td>
                  <Td className="text-right">
                    <Link href={`/app/finance/statements/${r.c.id}`} className="font-medium underline">
                      View
                    </Link>
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
