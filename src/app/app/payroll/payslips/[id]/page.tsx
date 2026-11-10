import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatDate, formatMoney, formatPeriod } from "@/lib/format";
import { amountInWords } from "@/lib/money";
import { packFor } from "@/lib/tenancy";
import { legacyBreakdown } from "@/lib/posting";
import { REIMBURSEMENT_CODE, parseBreakdown, sumLines } from "@/lib/payroll-types";
import { canUseModule, requireWorkspace } from "@/lib/tenancy";
import { PrintButton } from "../../print-button";

export const metadata: Metadata = { title: "Payslip" };

export default async function PayslipPage(props: PageProps<"/app/payroll/payslips/[id]">) {
  const ws = await requireWorkspace();
  const { id: rawId } = await props.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  const [row] = await db
    .select({ p: schema.payslips, run: schema.payrollRuns, emp: schema.employees })
    .from(schema.payslips)
    .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
    .innerJoin(schema.employees, eq(schema.payslips.employeeId, schema.employees.id))
    .where(and(eq(schema.payslips.id, id), eq(schema.payslips.orgId, ws.org.id)))
    .limit(1);
  if (!row) notFound();
  const { p, run, emp } = row;

  const isPayroll = canUseModule(ws, "payroll");
  const isSelf = emp.userId != null && emp.userId === ws.user.id;
  if (!isPayroll && !(isSelf && run.status !== "draft")) notFound();

  const m = (n: number) => formatMoney(n, ws.org.currency);
  const pack = packFor(ws);
  const b = parseBreakdown(p.breakdown) ?? legacyBreakdown(p);
  const salary = b.earnings.filter((e) => e.code !== REIMBURSEMENT_CODE);
  const reimbursed = sumLines(b.earnings.filter((e) => e.code === REIMBURSEMENT_CODE));
  const earnings: [string, number][] = salary.filter((e) => e.amount).map((e) => [e.label, e.amount]);
  const deductions: [string, number][] = b.deductions.filter((d) => d.amount).map((d) => [d.label, d.amount]);
  const employer = b.employer.filter((r) => r.amount);
  const mask = (v: string | null) => (v ? `••••${v.slice(-4)}` : "—");
  const ids: [string, string][] =
    pack.code === "AE"
      ? [
          ["Emirates ID", mask(emp.emiratesId)],
          ["MOHRE person ID", emp.wpsPersonId ?? "—"],
          ["IBAN", mask(emp.iban)],
        ]
      : [
          ["PAN", emp.pan ?? "—"],
          ["UAN", emp.uan ?? "—"],
          ["Bank account", mask(emp.bankAccount)],
        ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={isPayroll ? `/app/payroll/${run.id}` : "/app/me"} className="text-sm text-ink-soft underline-offset-4 hover:underline">
          ← Back
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-[20px] border border-line bg-card p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{ws.org.name}</h1>
            {ws.org.address && <p className="mt-1 max-w-xs text-sm whitespace-pre-line text-ink-soft">{ws.org.address}</p>}
            {ws.org.gstin && <p className="mt-1 font-mono text-xs text-ink-mute">{pack.tax.idLabel} {ws.org.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Payslip</p>
            <p className="text-xl font-semibold">{formatPeriod(run.period)}</p>
            {run.paymentDate && <p className="text-sm text-ink-soft">Paid on {formatDate(run.paymentDate)}</p>}
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line py-5 text-sm sm:grid-cols-3">
          {[
            ["Employee", p.employeeName],
            ["Employee ID", p.employeeCode],
            ["Designation", p.designation ?? "—"],
            ["Department", p.department ?? "—"],
            ["Date of joining", formatDate(emp.joinDate)],
            ...ids,
            ["Days in month", String(run.daysInMonth)],
            ["Paid days", String(p.paidDays)],
            ["LOP days", String(p.lopDays)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">{k}</dt>
              <dd className="mt-0.5 font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-6 py-5 md:grid-cols-2">
          <LedgerTable title="Earnings" rows={earnings} totalLabel="Gross earnings" total={p.gross} m={m} />
          <LedgerTable title="Deductions" rows={deductions.length ? deductions : [["No deductions", 0]]} totalLabel="Total deductions" total={p.totalDeductions} m={m} />
        </div>

        {reimbursed > 0 && (
          <p className="mb-3 text-sm text-ink-soft">
            Expense reimbursements added to net pay: <span className="font-medium text-ink">{m(reimbursed)}</span>
          </p>
        )}
        {employer.length > 0 && (
          <div className="rounded-2xl bg-paper/60 p-4 text-sm">
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Employer contributions (not part of net pay)</p>
            <p className="mt-1 text-ink-soft">{employer.map((r) => `${r.label} ${m(r.amount)}`).join(" · ")}</p>
          </div>
        )}
        {b.notes?.length ? <p className="mt-3 text-xs text-ink-mute">{b.notes.join(" ")}</p> : null}

        <div className="mt-5 rounded-2xl bg-mint p-6 text-center">
          <p className="font-mono text-[11px] tracking-widest text-ink/60 uppercase">Net pay</p>
          <p className="mt-1 font-display text-4xl font-bold tracking-tight">{m(p.net)}</p>
          <p className="mt-1 text-sm text-ink/70">{amountInWords(p.net, ws.org.currency)}</p>
        </div>

        {p.note && <p className="mt-4 text-sm text-ink-soft">Note: {p.note}</p>}
        <footer className="mt-6 border-t border-line pt-4 text-center text-xs text-ink-mute">
          This is a computer-generated payslip and does not require a signature.
        </footer>
      </article>
    </div>
  );
}

function LedgerTable({
  title,
  rows,
  totalLabel,
  total,
  m,
}: {
  title: string;
  rows: [string, number][];
  totalLabel: string;
  total: number;
  m: (n: number) => string;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className="border-b border-line pb-2 text-left font-mono text-[11px] font-normal tracking-widest text-ink-mute uppercase">{title}</th>
          <th className="border-b border-line pb-2" />
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="border-b border-line/70 py-2">{k}</td>
            <td className="border-b border-line/70 py-2 text-right tabular-nums">{m(v)}</td>
          </tr>
        ))}
        <tr>
          <td className="pt-2 font-semibold">{totalLabel}</td>
          <td className="pt-2 text-right font-semibold tabular-nums">{m(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
