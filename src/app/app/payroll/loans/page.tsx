import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, gt, ne } from "drizzle-orm";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, formatPeriod, fromMinor, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { closeLoan, createLoan, updateInstallment } from "../extras-actions";

export const metadata: Metadata = { title: "Loans & advances" };

export default async function LoansPage() {
  const ws = await requireWorkspace({ module: "payroll", manage: true });
  const orgId = ws.org.id;
  const m = (n: number) => formatMoney(n, ws.org.currency);
  const today = todayYmd();

  const [loans, emps, recoveries] = await Promise.all([
    db
      .select({ l: schema.employeeLoans, name: schema.employees.name, code: schema.employees.code })
      .from(schema.employeeLoans)
      .innerJoin(schema.employees, eq(schema.employeeLoans.employeeId, schema.employees.id))
      .where(eq(schema.employeeLoans.orgId, orgId))
      .orderBy(asc(schema.employeeLoans.status), desc(schema.employeeLoans.disbursedOn)),
    db
      .select({ id: schema.employees.id, name: schema.employees.name, code: schema.employees.code })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), ne(schema.employees.status, "exited")))
      .orderBy(asc(schema.employees.name)),
    db
      .select({
        id: schema.payslips.id,
        employeeId: schema.payslips.employeeId,
        name: schema.payslips.employeeName,
        amount: schema.payslips.loanDeduction,
        period: schema.payrollRuns.period,
        paidOn: schema.payrollRuns.paymentDate,
      })
      .from(schema.payslips)
      .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
      .where(and(eq(schema.payslips.orgId, orgId), eq(schema.payrollRuns.status, "paid"), gt(schema.payslips.loanDeduction, 0)))
      .orderBy(desc(schema.payrollRuns.period), asc(schema.payslips.employeeName)),
  ]);

  const active = loans.filter((x) => x.l.status === "active");
  const outstanding = active.reduce((t, x) => t + x.l.balance, 0);
  const recovered = recoveries.reduce((t, r) => t + r.amount, 0);
  const disbursed = loans.reduce((t, x) => t + x.l.principal, 0);

  return (
    <>
      <PageHeader
        title="Loans & advances"
        description="Disburse salary advances and staff loans; installments are deducted automatically in each payroll run from the first deduction month."
        tabs={[
          { href: "/app/payroll", label: "Runs" },
          { href: "/app/payroll/loans", label: "Loans & advances", active: true },
          { href: "/app/payroll/settlements", label: "Final settlements" },
        ]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Outstanding" value={m(outstanding)} hint={`${active.length} active`} tone="peach" />
        <Stat label="Disbursed" value={m(disbursed)} hint={`${loans.length} in total`} tone="sky" />
        <Stat label="Recovered via payroll" value={m(recovered)} hint="From paid payslips" tone="mint" />
        <Stat label="Closed" value={loans.length - active.length} hint="Fully recovered or settled" tone="lilac" />
      </div>

      <Card title="New loan or advance" className="mb-6">
        {emps.length === 0 ? (
          <EmptyState title="No employees yet">
            Add people in <Link href="/app/hrm" className="underline">HRM</Link> first.
          </EmptyState>
        ) : (
          <ActionForm action={createLoan} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Employee" name="employeeId" placeholder="Choose…" options={emps.map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }))} required />
            <Select label="Type" name="type" options={[{ value: "advance", label: "Salary advance" }, { value: "loan", label: "Loan" }]} defaultValue="advance" />
            <Input label="Principal" name="principal" type="number" step="0.01" min="0" required />
            <Input label="Monthly installment" name="monthlyInstallment" type="number" step="0.01" min="0" required />
            <Input label="Disbursed on" name="disbursedOn" type="date" defaultValue={today} required />
            <Input label="First deduction month" name="startPeriod" type="month" defaultValue={today.slice(0, 7)} required />
            <Input label="Note" name="note" maxLength={300} className="sm:col-span-2" />
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton>Disburse</SubmitButton>
              <p className="mt-2 text-xs text-ink-mute">Posts Dr Employee loans &amp; advances / Cr Bank on the disbursement date.</p>
            </div>
          </ActionForm>
        )}
      </Card>

      <Card title="Loans & advances" className="mb-6">
        {loans.length === 0 ? (
          <EmptyState title="No loans or advances yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Type</Th>
                <Th>Disbursed</Th>
                <Th className="text-right">Principal</Th>
                <Th className="text-right">Installment</Th>
                <Th className="text-right">Outstanding</Th>
                <Th>From</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {loans.map(({ l, name, code }) => (
                <tr key={l.id}>
                  <Td>
                    <p className="font-medium">{name}</p>
                    <p className="font-mono text-xs text-ink-mute">{code}</p>
                    {l.note && <p className="text-xs text-ink-soft">{l.note}</p>}
                  </Td>
                  <Td className="capitalize">{l.type}</Td>
                  <Td>{formatDate(l.disbursedOn)}</Td>
                  <Td className="text-right tabular-nums">{m(l.principal)}</Td>
                  <Td className="text-right tabular-nums">
                    {l.status === "active" ? (
                      <details className="inline-block text-left">
                        <summary className="cursor-pointer tabular-nums underline-offset-4 hover:underline">{m(l.monthlyInstallment)}</summary>
                        <ActionForm action={updateInstallment} className="mt-2 flex items-start gap-2" resetOnSuccess={false}>
                          <input type="hidden" name="id" value={l.id} />
                          <Input label="New installment" name="monthlyInstallment" type="number" step="0.01" min="0" defaultValue={fromMinor(l.monthlyInstallment)} className="w-32" />
                          <div className="pt-[22px]">
                            <SubmitButton variant="outline">Save</SubmitButton>
                          </div>
                        </ActionForm>
                      </details>
                    ) : (
                      m(l.monthlyInstallment)
                    )}
                  </Td>
                  <Td className="text-right font-medium tabular-nums">{m(l.balance)}</Td>
                  <Td>{formatPeriod(l.startPeriod)}</Td>
                  <Td>
                    <StatusBadge value={l.status} />
                  </Td>
                  <Td className="text-right">
                    {l.status === "active" && l.balance === 0 && (
                      <ActionButton action={closeLoan} fields={{ id: l.id }}>
                        Close
                      </ActionButton>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-8 text-xs text-ink-mute">
          Loans close automatically when payroll recovers the full balance. Any balance left at exit is recovered in the{" "}
          <Link href="/app/payroll/settlements" className="underline">final settlement</Link>.
        </p>
      </Card>

      <Card title="Recovery history">
        {recoveries.length === 0 ? (
          <EmptyState title="No recoveries yet">Installments appear here once a payroll run that deducts them is paid.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Employee</Th>
                <Th>Paid on</Th>
                <Th className="text-right">Recovered</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {recoveries.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{formatPeriod(r.period)}</Td>
                  <Td>{r.name}</Td>
                  <Td>{formatDate(r.paidOn)}</Td>
                  <Td className="text-right tabular-nums">{m(r.amount)}</Td>
                  <Td className="text-right">
                    <Link href={`/app/payroll/payslips/${r.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
                      Payslip
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
