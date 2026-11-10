import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ActionButton } from "@/components/app/forms";
import { Card, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { deleteRun, markRunPaid } from "../actions";

export const metadata: Metadata = { title: "Payslips" };

export default async function PayrollRunPage(props: PageProps<"/app/payroll/[runId]">) {
  const ws = await requireWorkspace({ module: "payroll" });
  const { runId } = await props.params;
  const id = Number(runId);
  if (!Number.isInteger(id)) notFound();

  const [run] = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.id, id), eq(schema.payrollRuns.orgId, ws.org.id)))
    .limit(1);
  if (!run) notFound();

  const slips = await db
    .select()
    .from(schema.payslips)
    .where(and(eq(schema.payslips.runId, id), eq(schema.payslips.orgId, ws.org.id)))
    .orderBy(asc(schema.payslips.employeeName));

  const cur = ws.org.currency;
  const label = new Date(`${run.period}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {label} <StatusBadge value={run.status} />
          </span>
        }
        description={
          <Link href="/app/payroll" className="underline-offset-4 hover:underline">
            ← Back to payroll
          </Link>
        }
        actions={
          run.status === "draft" ? (
            <>
              <ActionButton action={markRunPaid} fields={{ id: run.id }}>
                Mark as paid
              </ActionButton>
              <ActionButton action={deleteRun} fields={{ id: run.id }} confirm="Delete this draft run and its payslips?" className="text-signal">
                Delete draft run
              </ActionButton>
            </>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gross" value={formatMoney(run.totalGross, cur)} tone="lime" />
        <Stat label="Deductions" value={formatMoney(run.totalDeductions, cur)} tone="peach" />
        <Stat label="Net pay" value={formatMoney(run.totalNet, cur)} tone="mint" />
        <Stat label="Employees" value={run.employeeCount} tone="sky" />
      </div>

      <div className="mt-6">
        <Card title="Payslips">
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">Deductions</Th>
                <Th className="text-right">Net</Th>
              </tr>
            </thead>
            <tbody>
              {slips.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium">{s.employeeName}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(s.gross, cur)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(s.deductions, cur)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(s.net, cur)}</Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td>Total</Td>
                <Td className="text-right tabular-nums">{formatMoney(run.totalGross, cur)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(run.totalDeductions, cur)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(run.totalNet, cur)}</Td>
              </tr>
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
