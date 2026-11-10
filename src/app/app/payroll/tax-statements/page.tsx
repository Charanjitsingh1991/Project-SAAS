import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoney, todayYmd } from "@/lib/format";
import { fyLabel, fyOf, fyPeriods } from "@/lib/statutory-in";
import { packFor, requireWorkspace } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Tax statements" };

export default async function TaxStatementsPage(props: PageProps<"/app/payroll/tax-statements">) {
  const ws = await requireWorkspace({ module: "payroll" });
  if (packFor(ws).code !== "IN") notFound();
  const { fy: rawFy } = await props.searchParams;
  const current = fyOf(todayYmd());
  const parsed = Number(Array.isArray(rawFy) ? rawFy[0] : rawFy);
  const fy = Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : current;
  const periods = fyPeriods(fy);
  const cur = ws.org.currency;

  const rows = await db
    .select({
      employeeId: schema.payslips.employeeId,
      name: sql<string>`max(${schema.payslips.employeeName})`,
      code: sql<string>`max(${schema.payslips.employeeCode})`,
      months: sql<number>`count(*)`,
      gross: sql<number>`coalesce(sum(${schema.payslips.gross}), 0)`,
      tds: sql<number>`coalesce(sum(${schema.payslips.tds}), 0)`,
    })
    .from(schema.payslips)
    .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
    .where(
      and(
        eq(schema.payslips.orgId, ws.org.id),
        eq(schema.payrollRuns.orgId, ws.org.id),
        eq(schema.payrollRuns.status, "paid"),
        gte(schema.payrollRuns.period, periods[0]),
        lte(schema.payrollRuns.period, periods[11]),
      ),
    )
    .groupBy(schema.payslips.employeeId)
    .orderBy(sql`max(${schema.payslips.employeeCode})`);

  return (
    <>
      <PageHeader
        title="Tax statements"
        description={`Annual salary & TDS statements for FY ${fyLabel(fy)} (April–March), built from paid payroll runs. For reference — not the official Form 16 issued via TRACES.`}
        tabs={[
          { href: "/app/payroll", label: "Runs" },
          { href: "/app/payroll/loans", label: "Loans & advances" },
          { href: "/app/payroll/settlements", label: "Final settlements" },
          { href: "/app/payroll/tax-statements", label: "Tax statements", active: true },
        ]}
      />
      <div className="mb-4 flex gap-4 text-sm">
        {[current - 2, current - 1, current].map((y) => (
          <Link key={y} href={`/app/payroll/tax-statements?fy=${y}`} className={y === fy ? "font-semibold underline underline-offset-4" : "text-ink-soft underline-offset-4 hover:underline"}>
            FY {fyLabel(y)}
          </Link>
        ))}
      </div>
      <Card title={`FY ${fyLabel(fy)}`}>
        {rows.length === 0 ? (
          <EmptyState title="No paid payroll runs in this financial year">Statements appear once runs are marked paid.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th className="text-right">Months paid</Th>
                <Th className="text-right">Gross salary</Th>
                <Th className="text-right">TDS deducted</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <Td className="font-medium">
                    {r.name} <span className="font-mono text-xs text-ink-mute">{r.code}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{Number(r.months)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(Number(r.gross), cur)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(Number(r.tds), cur)}</Td>
                  <Td className="text-right">
                    <Link href={`/app/payroll/tax-statements/${r.employeeId}?fy=${fy}`} className="text-sm font-medium underline-offset-4 hover:underline">
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
