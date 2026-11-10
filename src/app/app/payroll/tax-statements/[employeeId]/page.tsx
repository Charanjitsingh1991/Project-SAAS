import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { statutoryOf } from "@/lib/countries";
import { formatMoney, formatPeriod, todayYmd } from "@/lib/format";
import { parseBreakdown } from "@/lib/payroll-types";
import { legacyBreakdown } from "@/lib/posting";
import { buildTaxStatement, fyLabel, fyOf, fyPeriods } from "@/lib/statutory-in";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { PrintButton } from "../../print-button";

export const metadata: Metadata = { title: "Annual salary & TDS statement" };

export default async function TaxStatementPage(props: PageProps<"/app/payroll/tax-statements/[employeeId]">) {
  const ws = await requireWorkspace({ module: "payroll" });
  if (packFor(ws).code !== "IN") notFound();
  const { employeeId } = await props.params;
  const { fy: rawFy } = await props.searchParams;
  const empId = Number(employeeId);
  if (!Number.isInteger(empId)) notFound();
  const parsed = Number(Array.isArray(rawFy) ? rawFy[0] : rawFy);
  const fy = Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : fyOf(todayYmd());
  const periods = fyPeriods(fy);
  const cur = ws.org.currency;
  const money = (n: number) => formatMoney(n, cur);

  const [emp] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, empId), eq(schema.employees.orgId, ws.org.id)))
    .limit(1);
  if (!emp) notFound();

  const rows = await db
    .select({ p: schema.payslips, period: schema.payrollRuns.period })
    .from(schema.payslips)
    .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
    .where(
      and(
        eq(schema.payslips.orgId, ws.org.id),
        eq(schema.payrollRuns.orgId, ws.org.id),
        eq(schema.payslips.employeeId, emp.id),
        eq(schema.payrollRuns.status, "paid"),
        gte(schema.payrollRuns.period, periods[0]),
        lte(schema.payrollRuns.period, periods[11]),
      ),
    );
  const st = buildTaxStatement(rows.map(({ p, period }) => ({ period, gross: p.gross, breakdown: parseBreakdown(p.breakdown) ?? legacyBreakdown(p) })));
  const org = statutoryOf(ws.org);
  const line = "flex justify-between gap-4 border-b border-line/60 py-2 text-sm";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/app/payroll/tax-statements?fy=${fy}`} className="text-sm text-ink-soft underline-offset-4 hover:underline">
          ← Back
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-[20px] border border-line bg-card p-8 print:rounded-none print:border-0 print:p-0">
        <header className="border-b border-line pb-5">
          <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Annual salary &amp; TDS statement · FY {fyLabel(fy)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{ws.org.name}</h1>
          {ws.org.address && <p className="mt-1 max-w-xs text-sm whitespace-pre-line text-ink-soft">{ws.org.address}</p>}
          <p className="mt-1 font-mono text-xs text-ink-mute">TAN {org.tan ?? "—"}</p>
          <p className="mt-3 text-xs text-ink-soft">Form 16 Part B style — for reference only, not the official Form 16 issued via TRACES.</p>
        </header>

        <section className="grid gap-1 border-b border-line py-4 text-sm sm:grid-cols-2">
          <p>
            <span className="text-ink-soft">Employee: </span>
            {emp.name} <span className="font-mono text-xs text-ink-mute">{emp.code}</span>
          </p>
          <p>
            <span className="text-ink-soft">PAN: </span>
            <span className="font-mono">{emp.pan ?? "—"}</span>
          </p>
          <p>
            <span className="text-ink-soft">Designation: </span>
            {emp.designation}
          </p>
          <p>
            <span className="text-ink-soft">Period: </span>
            {formatPeriod(periods[0])} – {formatPeriod(periods[11])}
          </p>
        </section>

        {st.months.length === 0 ? (
          <p className="py-6 text-sm text-ink-soft">No paid payroll runs for this employee in FY {fyLabel(fy)}.</p>
        ) : (
          <>
            <section className="py-4">
              <h2 className="mb-1 font-display text-base font-semibold">Gross salary by component</h2>
              {st.components.map((c) => (
                <div key={c.code} className={line}>
                  <span>{c.label}</span>
                  <span className="tabular-nums">{money(c.amount)}</span>
                </div>
              ))}
              <div className={`${line} font-semibold`}>
                <span>Gross salary</span>
                <span className="tabular-nums">{money(st.gross)}</span>
              </div>
            </section>

            <section className="py-4">
              <h2 className="mb-1 font-display text-base font-semibold">Tax computation (new regime, estimate)</h2>
              <div className={line}>
                <span>Less: standard deduction</span>
                <span className="tabular-nums">{money(st.standardDeduction)}</span>
              </div>
              <div className={line}>
                <span>Taxable income</span>
                <span className="tabular-nums">{money(st.taxableIncome)}</span>
              </div>
              <div className={line}>
                <span>Tax on taxable income incl. 87A rebate &amp; 4% cess</span>
                <span className="tabular-nums">{money(st.taxComputed)}</span>
              </div>
              <div className={line}>
                <span>Total TDS deducted</span>
                <span className="tabular-nums">{money(st.tdsDeducted)}</span>
              </div>
              <div className={`${line} font-semibold`}>
                <span>{st.balance >= 0 ? "Balance tax payable" : "Excess TDS (refundable)"}</span>
                <span className="tabular-nums">{money(Math.abs(st.balance))}</span>
              </div>
              <p className="mt-2 text-xs text-ink-soft">Professional tax paid in the year: {money(st.professionalTax)} (shown for reference; the estimate does not reduce taxable income for it).</p>
            </section>

            <section className="py-4">
              <h2 className="mb-1 font-display text-base font-semibold">TDS deducted month by month</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-soft">
                    <th className="py-1 font-medium">Month</th>
                    <th className="py-1 text-right font-medium">Gross salary</th>
                    <th className="py-1 text-right font-medium">TDS</th>
                  </tr>
                </thead>
                <tbody>
                  {st.months.map((m) => (
                    <tr key={m.period} className="border-t border-line/60">
                      <td className="py-1.5">{formatPeriod(m.period)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(m.gross)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(m.tds)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line font-semibold">
                    <td className="py-1.5">Total</td>
                    <td className="py-1.5 text-right tabular-nums">{money(st.gross)}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(st.tdsDeducted)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </>
        )}
        <p className="border-t border-line pt-4 text-xs text-ink-mute">Computed from paid payroll runs in this app. Reimbursements are excluded. Verify against Form 26AS / TRACES before relying on it.</p>
      </article>
    </div>
  );
}
