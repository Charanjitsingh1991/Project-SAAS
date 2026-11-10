import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoney, formatPeriod, todayYmd } from "@/lib/format";
import { fiscalYearFor } from "@/lib/countries";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { createRun } from "./actions";

export const metadata: Metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const ws = await requireWorkspace({ module: "payroll" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const today = todayYmd();
  const month = today.slice(0, 7);
  const pack = packFor(ws);
  const fyStart = fiscalYearFor(today, pack.fiscalYearStartMonth)[0].slice(0, 7);

  const [runs, active, ytd] = await Promise.all([
    db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.orgId, orgId)).orderBy(desc(schema.payrollRuns.period)),
    db
      .select({ n: sql<number>`count(*)`, ctc: sql<number>`coalesce(sum(${schema.employees.annualCtc}), 0)` })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), ne(schema.employees.status, "exited"), sql`${schema.employees.annualCtc} > 0`)),
    db
      .select({ v: sql<number>`coalesce(sum(${schema.payrollRuns.totalNet}), 0)` })
      .from(schema.payrollRuns)
      .where(and(eq(schema.payrollRuns.orgId, orgId), eq(schema.payrollRuns.status, "paid"), gte(schema.payrollRuns.period, fyStart))),
  ]);

  const monthlyCost = Math.round(Number(active[0]?.ctc ?? 0) / 12);
  const last = runs.find((r) => r.status !== "draft") ?? runs[0];

  return (
    <>
      <PageHeader
        title="Payroll"
        description={pack.code === "AE" ? "Monthly runs with proration, LOP, GPSSA, gratuity accrual and WPS salary files — draft, approve, then pay." : "Monthly runs with proration, LOP, PF, ESI, professional tax and TDS — draft, approve, then pay."}
        tabs={[
          { href: "/app/payroll", label: "Runs", active: true },
          { href: "/app/payroll/loans", label: "Loans & advances" },
          { href: "/app/payroll/settlements", label: "Final settlements" },
          ...(pack.code === "IN" ? [{ href: "/app/payroll/tax-statements", label: "Tax statements" }] : []),
        ]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Monthly payroll cost" value={formatMoney(monthlyCost, cur)} hint={pack.code === "AE" ? "Sum of active packages ÷ 12" : "Sum of active CTC ÷ 12"} tone="mint" />
        <Stat label="Last run net" value={last ? formatMoney(last.totalNet, cur) : "—"} hint={last ? formatPeriod(last.period) : "No runs yet"} tone="sky" />
        <Stat label="Paid this fiscal year" value={formatMoney(Number(ytd[0]?.v ?? 0), cur)} hint={`Net paid since ${formatPeriod(fyStart)}`} tone="butter" />
        <Stat label="Employees on payroll" value={Number(active[0]?.n ?? 0)} hint="Active with a salary" tone="lilac" />
      </div>

      <Card title="Run payroll" className="mb-6">
        <ActionForm action={createRun} className="flex flex-wrap items-start gap-3" resetOnSuccess={false}>
          <Input label="Period" name="period" type="month" defaultValue={month} required className="w-52" />
          <div className="pt-[22px]">
            <SubmitButton>Create draft run</SubmitButton>
          </div>
        </ActionForm>
        <p className="mt-3 text-sm text-ink-soft">Includes everyone who joined on or before month end and hasn&apos;t exited before month start. Attendance and unpaid leave drive LOP.</p>
      </Card>

      <Card title="Payroll runs">
        {runs.length === 0 ? (
          <EmptyState title="No payroll runs yet">Create your first run above.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th className="text-right">Employees</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">Deductions</Th>
                <Th className="text-right">Net</Th>
                <Th className="text-right">Employer cost</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{formatPeriod(r.period)}</Td>
                  <Td>
                    <StatusBadge value={r.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{r.employeeCount}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.totalGross, cur)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.totalDeductions, cur)}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatMoney(r.totalNet, cur)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.totalEmployerCost, cur)}</Td>
                  <Td className="text-right">
                    <Link href={`/app/payroll/${r.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
                      Open
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
