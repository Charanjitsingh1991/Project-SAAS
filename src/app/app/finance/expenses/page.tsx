import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, GST_RATES } from "@/lib/accounting";
import { daysBetween, formatDate, formatMoney, formatMoneyCompact, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { createExpenseAction, deleteExpenseAction, payBillAction } from "../actions";
import { ConfirmAction } from "../_components/confirm-action";
import { FINANCE_TABS } from "../tabs";

export const metadata: Metadata = { title: "Expenses" };

const SOURCE_LABEL = { manual: "Manual", payroll: "Payroll", purchase_order: "Purchase order" } as const;
const SOURCE_TONE = { manual: "card", payroll: "lilac", purchase_order: "sky" } as const;

export default async function ExpensesPage({ searchParams }: PageProps<"/app/finance/expenses">) {
  const ws = await requireWorkspace({ module: "finance" });
  const sp = await searchParams;
  const cur = ws.org.currency;
  const today = todayYmd();
  const category = typeof sp.category === "string" ? sp.category : "";
  const status = sp.status === "paid" || sp.status === "unpaid" ? sp.status : "";
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : "";

  const [all, vendors] = await Promise.all([
    db
      .select({ e: schema.expenses, vendor: schema.vendors.name })
      .from(schema.expenses)
      .leftJoin(schema.vendors, eq(schema.expenses.vendorId, schema.vendors.id))
      .where(and(eq(schema.expenses.orgId, ws.org.id)))
      .orderBy(desc(schema.expenses.date), desc(schema.expenses.id)),
    db.select({ id: schema.vendors.id, name: schema.vendors.name }).from(schema.vendors).where(eq(schema.vendors.orgId, ws.org.id)).orderBy(schema.vendors.name),
  ]);

  const rows = all.filter(({ e }) => (!category || e.category === category) && (!status || e.status === status) && (!month || e.date.startsWith(month)));
  const monthStart = `${today.slice(0, 7)}-01`;
  const sum = (list: typeof rows) => list.reduce((s, r) => s + r.e.total, 0);
  const unpaid = all.filter(({ e }) => e.status === "unpaid");
  const overdueBills = unpaid.filter(({ e }) => e.dueDate && e.dueDate < today);

  const byCat = new Map<string, number>();
  for (const { e } of rows) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.total);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] ?? 0;

  const monthsAvail = [...new Set(all.map(({ e }) => e.date.slice(0, 7)))];
  const allCats = [...new Set([...EXPENSE_CATEGORIES.map((c) => c.value as string), ...all.map(({ e }) => e.category)])];

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Expenses and vendor bills post to the ledger automatically — paid ones hit the bank, unpaid ones go to accounts payable."
        tabs={FINANCE_TABS("expenses")}
        actions={
          <a href="/api/export/expenses" className="inline-flex h-10 items-center rounded-full border border-ink/20 px-5 text-sm font-medium hover:border-ink">
            Export CSV
          </a>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="This month" value={formatMoneyCompact(sum(all.filter(({ e }) => e.date >= monthStart)), cur)} tone="peach" />
        <Stat label="Unpaid bills" value={formatMoneyCompact(sum(unpaid), cur)} hint={`${unpaid.length} bill${unpaid.length === 1 ? "" : "s"}`} tone="butter" />
        <Stat label="Overdue bills" value={formatMoneyCompact(sum(overdueBills), cur)} hint={`${overdueBills.length} past due date`} tone={overdueBills.length ? "rose" : "mint"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <form action="/app/finance/expenses" className="flex flex-wrap items-end gap-3">
            <Select label="Category" name="category" placeholder="All categories" defaultValue={category} options={allCats.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABEL[c] ?? c }))} className="w-52" />
            <Select label="Status" name="status" placeholder="All" defaultValue={status} options={["paid", "unpaid"]} className="w-32" />
            <Select label="Month" name="month" placeholder="All months" defaultValue={month} options={monthsAvail.map((m) => ({ value: m, label: m }))} className="w-36" />
            <button className="h-10 rounded-full border border-ink/20 px-5 text-sm font-medium hover:border-ink">Filter</button>
            {(category || status || month) && (
              <a href="/app/finance/expenses" className="pb-2.5 text-sm text-ink-soft hover:text-ink">
                Clear
              </a>
            )}
          </form>

          <Card title="By category">
            {cats.length === 0 ? (
              <EmptyState title="No expenses match" />
            ) : (
              <ul className="space-y-3">
                {cats.map(([key, amount]) => (
                  <li key={key}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">{EXPENSE_CATEGORY_LABEL[key] ?? key}</span>
                      <span className="tabular-nums text-ink-soft">{formatMoney(amount, cur)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-ink/5">
                      <div className="h-2 rounded-full bg-ink" style={{ width: `${(amount / max) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            {rows.length === 0 ? (
              <EmptyState title="No expenses found" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th>Category</Th>
                    <Th>Source</Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="text-right">GST</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ e, vendor }) => {
                    const late = e.status === "unpaid" && e.dueDate ? daysBetween(e.dueDate, today) : 0;
                    return (
                      <tr key={e.id} className="align-top">
                        <Td className="whitespace-nowrap">{formatDate(e.date)}</Td>
                        <Td>
                          <span className="font-medium">{e.description}</span>
                          {vendor && <span className="block text-xs text-ink-mute">{vendor}</span>}
                          {e.reference && <span className="block text-xs text-ink-mute">Ref {e.reference}</span>}
                        </Td>
                        <Td>{EXPENSE_CATEGORY_LABEL[e.category] ?? e.category}</Td>
                        <Td>
                          <Badge tone={SOURCE_TONE[e.sourceType]}>{SOURCE_LABEL[e.sourceType]}</Badge>
                        </Td>
                        <Td className="text-right tabular-nums">{formatMoney(e.amount, cur)}</Td>
                        <Td className="text-right tabular-nums">{e.taxAmount ? formatMoney(e.taxAmount, cur) : "—"}</Td>
                        <Td className="text-right font-medium tabular-nums">{formatMoney(e.total, cur)}</Td>
                        <Td>
                          <StatusBadge value={e.status} />
                          {e.status === "unpaid" && e.dueDate && (
                            <span className={cn("mt-1 block text-xs", late > 0 ? "text-signal" : "text-ink-mute")}>
                              {late > 0 ? `${late}d overdue` : `due ${formatDate(e.dueDate)}`}
                            </span>
                          )}
                          {e.status === "paid" && e.paidDate && <span className="mt-1 block text-xs text-ink-mute">{formatDate(e.paidDate)}</span>}
                        </Td>
                        <Td>
                          <div className="flex flex-col items-start gap-2">
                            {e.status === "unpaid" && (
                              <ActionForm action={payBillAction} className="flex items-center gap-1.5">
                                <input type="hidden" name="expenseId" value={e.id} />
                                <input type="date" name="date" defaultValue={today} aria-label="Payment date" className="h-8 w-32 rounded-lg border border-line bg-paper/60 px-2 text-xs" />
                                <select name="method" defaultValue="bank_transfer" aria-label="Method" className="h-8 rounded-lg border border-line bg-paper/60 px-1 text-xs">
                                  {schema.PAYMENT_METHODS.map((m) => (
                                    <option key={m} value={m}>
                                      {m.replace("_", " ")}
                                    </option>
                                  ))}
                                </select>
                                <SubmitButton className="h-8 px-3 text-xs">Pay bill</SubmitButton>
                              </ActionForm>
                            )}
                            {e.sourceType === "manual" && (
                              <ConfirmAction action={deleteExpenseAction} fields={{ expenseId: e.id }} confirm="Delete this expense? Its ledger entries will be reversed." variant="danger" className="h-7 px-3 text-xs">
                                Delete
                              </ConfirmAction>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <Card title="Add expense" className="h-fit">
          <ActionForm action={createExpenseAction} className="space-y-3">
            <Input label="Date" name="date" type="date" defaultValue={today} required />
            <Select label="Vendor" name="vendorId" placeholder="— None —" options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
            <Input label="Description" name="description" placeholder="e.g. Office rent — November" required />
            <Select label="Category" name="category" options={EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} defaultValue="other_expense" />
            <Input label="Amount (excl. GST)" name="amount" inputMode="decimal" placeholder="0.00" required />
            <div className="grid grid-cols-2 gap-3">
              <Select label="GST rate (helper)" name="gstRate" placeholder="None" options={GST_RATES.filter((r) => r > 0).map((r) => ({ value: r, label: `${r}%` }))} />
              <Input label="or GST amount" name="gstAmount" inputMode="decimal" placeholder="auto" />
            </div>
            <Select label="Status" name="status" options={["paid", "unpaid"]} defaultValue="paid" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Due date (if unpaid)" name="dueDate" type="date" />
              <Select label="Method (if paid)" name="paymentMethod" options={schema.PAYMENT_METHODS} defaultValue="bank_transfer" />
            </div>
            <Input label="Reference" name="reference" placeholder="Bill / UTR no." />
            <SubmitButton className="w-full">Add expense</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
