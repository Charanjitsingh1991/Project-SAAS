import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { createExpense, deleteExpense } from "../actions";
import { FINANCE_TABS } from "../tabs";

export const metadata: Metadata = { title: "Expenses" };

const CATEGORIES = ["Rent", "Salaries", "Software", "Travel", "Marketing", "Supplies", "Utilities", "Other"];

export default async function ExpensesPage() {
  const ws = await requireWorkspace({ module: "finance" });
  const cur = ws.org.currency;
  const today = todayYmd();
  const monthStart = `${today.slice(0, 7)}-01`;
  const since30 = new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.orgId, ws.org.id))
    .orderBy(desc(schema.expenses.date), desc(schema.expenses.id));

  const total = (list: typeof rows) => list.reduce((s, e) => s + e.amount, 0);
  const thisMonth = total(rows.filter((e) => e.date >= monthStart));
  const last30 = total(rows.filter((e) => e.date >= since30));

  const byCat = new Map<string, number>();
  for (const e of rows) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] ?? 0;

  return (
    <>
      <PageHeader title="Finance" description="Log expenses and see where the money goes." tabs={FINANCE_TABS("expenses")} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="This month" value={formatMoney(thisMonth, cur)} tone="peach" />
        <Stat label="Last 30 days" value={formatMoney(last30, cur)} tone="lilac" />
        <Stat label="Top category" value={cats[0]?.[0] ?? "—"} hint={cats[0] ? formatMoney(cats[0][1], cur) : undefined} tone="butter" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="By category">
            {cats.length === 0 ? (
              <EmptyState title="No expenses yet" />
            ) : (
              <ul className="space-y-3">
                {cats.map(([name, amount]) => (
                  <li key={name}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">{name}</span>
                      <span className="tabular-nums text-ink-soft">{formatMoney(amount, cur)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-ink/5">
                      <div className="h-2 rounded-full bg-ink" style={{ width: `${max ? Math.max(2, (amount / max) * 100) : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Expenses (${rows.length})`}>
            {rows.length === 0 ? (
              <EmptyState title="No expenses yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th>Category</Th>
                    <Th className="text-right">Amount</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <Td className="text-ink-soft">{formatDate(e.date)}</Td>
                      <Td className="font-medium">{e.description}</Td>
                      <Td className="text-ink-soft">{e.category}</Td>
                      <Td className="text-right font-medium tabular-nums">{formatMoney(e.amount, cur)}</Td>
                      <Td className="text-right">
                        <ActionButton action={deleteExpense} fields={{ id: e.id }} confirm="Delete this expense?" className="text-xs text-signal hover:underline">
                          Delete
                        </ActionButton>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <Card title="Add expense" className="h-fit">
          <ActionForm action={createExpense} className="space-y-3">
            <Input label="Description" name="description" />
            <Select label="Category" name="category" options={CATEGORIES} defaultValue="Other" />
            <Input label={`Amount (${cur})`} name="amount" type="number" min={1} step={1} />
            <Input label="Date" name="date" type="date" defaultValue={today} />
            <SubmitButton className="w-full">Add expense</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
