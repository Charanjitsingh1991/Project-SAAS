import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoney, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { runPayroll } from "./actions";

export const metadata: Metadata = { title: "Payroll" };

function monthLabel(period: string) {
  return new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function PayrollPage() {
  const ws = await requireWorkspace({ module: "payroll" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const thisMonth = todayYmd().slice(0, 7);
  const year = thisMonth.slice(0, 4);

  const [runs, [emp]] = await Promise.all([
    db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.orgId, orgId)).orderBy(desc(schema.payrollRuns.period)),
    db
      .select({
        active: sql<number>`count(*)`,
        gross: sql<number>`coalesce(sum(${schema.employees.monthlySalary}), 0)`,
      })
      .from(schema.employees)
      .where(sql`${schema.employees.orgId} = ${orgId} and ${schema.employees.status} = 'active'`),
  ]);

  const last = runs[0];
  const paidYtd = runs
    .filter((r) => r.status === "paid" && r.period.startsWith(year))
    .reduce((s, r) => s + r.totalNet, 0);

  return (
    <>
      <PageHeader title="Payroll" description="Run monthly payroll from your employee directory and review payslips." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active employees" value={emp?.active ?? 0} tone="mint" />
        <Stat label="Monthly gross" value={formatMoney(emp?.gross ?? 0, cur)} tone="lime" />
        <Stat
          label="Last run net"
          value={last ? formatMoney(last.totalNet, cur) : "—"}
          hint={last ? monthLabel(last.period) : "No runs yet"}
          tone="sky"
        />
        <Stat label={`Paid in ${year}`} value={formatMoney(paidYtd, cur)} tone="butter" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title={`Payroll runs (${runs.length})`}>
          {runs.length === 0 ? (
            <EmptyState title="No payroll runs yet">Run payroll for the current month to generate payslips.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th className="text-right">Employees</Th>
                  <Th className="text-right">Gross</Th>
                  <Th className="text-right">Deductions</Th>
                  <Th className="text-right">Net</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{monthLabel(r.period)}</Td>
                    <Td className="text-right tabular-nums">{r.employeeCount}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.totalGross, cur)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.totalDeductions, cur)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.totalNet, cur)}</Td>
                    <Td>
                      <StatusBadge value={r.status} />
                    </Td>
                    <Td>
                      <Link href={`/app/payroll/${r.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
                        View payslips →
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Run payroll" className="self-start">
          <ActionForm action={runPayroll} className="space-y-3" resetOnSuccess={false}>
            <Input label="Pay period" name="period" type="month" defaultValue={thisMonth} />
            <p className="text-xs text-ink-soft">
              Every active employee is paid their monthly salary. Deductions: PF 12%, professional tax 200 when gross is above
              15,000, and TDS 10% when gross is above 50,000.
            </p>
            <SubmitButton className="w-full">Run payroll</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
