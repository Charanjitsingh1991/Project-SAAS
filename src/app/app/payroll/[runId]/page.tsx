import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, formatPeriod, fromMinor, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { adjustSlip, approveRun, deleteRun, markPaid, recalcRun } from "../actions";

export const metadata: Metadata = { title: "Payroll run" };

const TABS = [
  { key: "payslips", label: "Payslips" },
  { key: "statutory", label: "Statutory summary" },
  { key: "bank", label: "Bank transfer" },
] as const;

export default async function RunPage(props: PageProps<"/app/payroll/[runId]">) {
  const ws = await requireWorkspace({ module: "payroll" });
  const { runId } = await props.params;
  const { tab: rawTab } = await props.searchParams;
  const id = Number(runId);
  if (!Number.isInteger(id)) notFound();
  const tab = TABS.find((t) => t.key === rawTab)?.key ?? "payslips";
  const cur = ws.org.currency;
  const money = (n: number) => formatMoney(n, cur);

  const [run] = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.id, id), eq(schema.payrollRuns.orgId, ws.org.id)))
    .limit(1);
  if (!run) notFound();

  const slips = await db
    .select({ p: schema.payslips, bankAccount: schema.employees.bankAccount, ifsc: schema.employees.ifsc })
    .from(schema.payslips)
    .leftJoin(schema.employees, eq(schema.payslips.employeeId, schema.employees.id))
    .where(and(eq(schema.payslips.runId, id), eq(schema.payslips.orgId, ws.org.id)))
    .orderBy(asc(schema.payslips.employeeCode));

  const sum = (f: (p: (typeof slips)[number]["p"]) => number) => slips.reduce((s, x) => s + f(x.p), 0);
  const draft = run.status === "draft";
  const pfE = sum((p) => p.pfEmployee);
  const pfR = sum((p) => p.pfEmployer);
  const esiE = sum((p) => p.esiEmployee);
  const esiR = sum((p) => p.esiEmployer);
  const pt = sum((p) => p.professionalTax);
  const tds = sum((p) => p.tds);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Payroll · {formatPeriod(run.period)} <StatusBadge value={run.status} />
          </span>
        }
        description={
          run.status === "paid"
            ? `Paid on ${formatDate(run.paymentDate)}. This run is locked.`
            : run.status === "approved"
              ? "Approved and locked. Mark it paid once the bank transfer is done."
              : "Draft — review payslips, adjust and recalculate, then approve."
        }
        actions={
          <>
            <Link href="/app/payroll" className="text-sm text-ink-soft underline-offset-4 hover:underline">
              All runs
            </Link>
            {draft && (
              <>
                <ActionButton action={recalcRun} fields={{ id: run.id }}>
                  Recalculate
                </ActionButton>
                <ActionButton action={deleteRun} fields={{ id: run.id }} confirm="Delete this draft payroll run?" className="text-signal">
                  Delete draft
                </ActionButton>
                <ActionButton action={approveRun} fields={{ id: run.id }} className="bg-ink text-paper hover:bg-ink/85">
                  Approve
                </ActionButton>
              </>
            )}
          </>
        }
        tabs={TABS.map((t) => ({ href: `/app/payroll/${run.id}?tab=${t.key}`, label: t.label, active: t.key === tab }))}
      />

      {run.status === "approved" && (
        <Card title="Mark as paid" className="mb-6">
          <ActionForm action={markPaid} className="flex flex-wrap items-start gap-3" resetOnSuccess={false}>
            <input type="hidden" name="id" value={run.id} />
            <Input label="Payment date" name="paymentDate" type="date" defaultValue={todayYmd()} required className="w-52" />
            <div className="pt-[22px]">
              <SubmitButton>Mark paid</SubmitButton>
            </div>
          </ActionForm>
          <p className="mt-3 text-sm text-ink-soft">Posts the salary journal and creates a Salaries expense. This cannot be undone.</p>
        </Card>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Gross" value={money(run.totalGross)} hint={`${run.employeeCount} employees`} tone="mint" />
        <Stat label="Deductions" value={money(run.totalDeductions)} tone="peach" />
        <Stat label="Net pay" value={money(run.totalNet)} tone="sky" />
        <Stat label="Employer cost" value={money(run.totalEmployerCost)} hint="Gross + employer PF & ESI" tone="butter" />
      </div>

      {tab === "payslips" && (
        <Card title="Payslips" className="mb-6">
          {slips.length === 0 ? (
            <EmptyState title="No payslips" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th className="text-right">Paid days</Th>
                  <Th className="text-right">LOP</Th>
                  <Th className="text-right">Gross</Th>
                  <Th className="text-right">PF</Th>
                  <Th className="text-right">ESI</Th>
                  <Th className="text-right">PT</Th>
                  <Th className="text-right">TDS</Th>
                  <Th className="text-right">Other</Th>
                  <Th className="text-right">Net</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {slips.map(({ p }) => (
                  <PayslipRows key={p.id} p={p} draft={draft} cur={cur} />
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "statutory" && (
        <Card title="Statutory summary" className="mb-6">
          <Table>
            <thead>
              <tr>
                <Th>Head</Th>
                <Th className="text-right">Employee</Th>
                <Th className="text-right">Employer</Th>
                <Th className="text-right">Total remittance</Th>
                <Th className="text-right">Employees</Th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Provident Fund (PF)", pfE, pfR, slips.filter((x) => x.p.pfEmployee > 0).length],
                ["Employees' State Insurance (ESI)", esiE, esiR, slips.filter((x) => x.p.esiEmployee > 0).length],
                ["Professional Tax (PT)", pt, 0, slips.filter((x) => x.p.professionalTax > 0).length],
                ["Income tax (TDS, s.192)", tds, 0, slips.filter((x) => x.p.tds > 0).length],
              ].map(([label, e, r, n]) => (
                <tr key={label as string}>
                  <Td className="font-medium">{label}</Td>
                  <Td className="text-right tabular-nums">{money(e as number)}</Td>
                  <Td className="text-right tabular-nums">{money(r as number)}</Td>
                  <Td className="text-right font-medium tabular-nums">{money((e as number) + (r as number))}</Td>
                  <Td className="text-right tabular-nums">{n as number}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "bank" && (
        <Card
          title="Bank transfer"
          className="mb-6"
          actions={
            <a href={`/api/export/payslips?run=${run.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
              Download CSV
            </a>
          }
        >
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Account</Th>
                <Th>IFSC</Th>
                <Th className="text-right">Net pay</Th>
              </tr>
            </thead>
            <tbody>
              {slips.map(({ p, bankAccount, ifsc }) => (
                <tr key={p.id}>
                  <Td className="font-medium">
                    {p.employeeName} <span className="font-mono text-xs text-ink-mute">{p.employeeCode}</span>
                  </Td>
                  <Td className="font-mono text-xs">{bankAccount ?? <span className="text-signal">Missing</span>}</Td>
                  <Td className="font-mono text-xs">{ifsc ?? <span className="text-signal">Missing</span>}</Td>
                  <Td className="text-right font-medium tabular-nums">{money(p.net)}</Td>
                </tr>
              ))}
              <tr>
                <Td className="font-semibold">Total</Td>
                <Td />
                <Td />
                <Td className="text-right font-semibold tabular-nums">{money(run.totalNet)}</Td>
              </tr>
            </tbody>
          </Table>
        </Card>
      )}

      <Card title="How this is calculated">
        <ul className="grid gap-2 text-sm text-ink-soft md:grid-cols-2">
          <li><b className="text-ink">Earnings:</b> Basic = 50% of CTC/12; HRA = 40% of Basic (50% in metros); Special = the remainder. All pro-rated by paid days ÷ {run.daysInMonth} days.</li>
          <li><b className="text-ink">LOP:</b> absent days + unpaid leave + ½ per half-day. Days before joining or after exit are unpaid but not LOP.</li>
          <li><b className="text-ink">PF:</b> 12% of Basic capped at a ₹15,000 wage (max ₹1,800), employee and employer, if enrolled.</li>
          <li><b className="text-ink">ESI:</b> if gross ≤ ₹21,000: 0.75% employee, 3.25% employer of gross.</li>
          <li><b className="text-ink">Professional tax:</b> ₹200 when gross exceeds ₹15,000.</li>
          <li><b className="text-ink">TDS (new regime FY2025-26):</b> (gross × 12 − ₹75,000) taxed at 0/5/10/15/20/25/30% slabs from ₹4L; nil if taxable ≤ ₹12L (s.87A); +4% cess; ÷ 12.</li>
          <li><b className="text-ink">Net</b> = gross − PF − ESI − PT − TDS − other deductions. <b className="text-ink">Employer cost</b> = gross + employer PF + employer ESI.</li>
        </ul>
      </Card>
    </>
  );
}

function PayslipRows({ p, draft, cur }: { p: typeof schema.payslips.$inferSelect; draft: boolean; cur: string }) {
  const m = (n: number) => formatMoney(n, cur);
  return (
    <>
      <tr>
        <Td>
          <p className="font-medium">{p.employeeName}</p>
          <p className="font-mono text-xs text-ink-mute">
            {p.employeeCode}
            {p.designation ? ` · ${p.designation}` : ""}
          </p>
        </Td>
        <Td className="text-right tabular-nums">{p.paidDays}</Td>
        <Td className="text-right tabular-nums">{p.lopDays}</Td>
        <Td className="text-right tabular-nums">{m(p.gross)}</Td>
        <Td className="text-right tabular-nums">{m(p.pfEmployee)}</Td>
        <Td className="text-right tabular-nums">{m(p.esiEmployee)}</Td>
        <Td className="text-right tabular-nums">{m(p.professionalTax)}</Td>
        <Td className="text-right tabular-nums">{m(p.tds)}</Td>
        <Td className="text-right tabular-nums">{m(p.otherDeductions)}</Td>
        <Td className="text-right font-medium tabular-nums">{m(p.net)}</Td>
        <Td className="text-right">
          <Link href={`/app/payroll/payslips/${p.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
            Payslip
          </Link>
        </Td>
      </tr>
      {draft && (
        <tr>
          <td colSpan={11} className="border-b border-line/70 px-5 py-2">
            <details>
              <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">
                Adjust {p.employeeName}
                {p.bonus + p.otherEarnings + p.otherDeductions > 0 ? " · adjusted" : ""}
              </summary>
              <ActionForm action={adjustSlip} className="mt-3 flex flex-wrap items-start gap-3 pb-2" resetOnSuccess={false}>
                <input type="hidden" name="id" value={p.id} />
                <Input label="Bonus" name="bonus" type="number" step="0.01" min="0" defaultValue={fromMinor(p.bonus)} className="w-32" />
                <Input label="Other earnings" name="otherEarnings" type="number" step="0.01" min="0" defaultValue={fromMinor(p.otherEarnings)} className="w-36" />
                <Input label="Other deductions" name="otherDeductions" type="number" step="0.01" min="0" defaultValue={fromMinor(p.otherDeductions)} className="w-36" />
                <Input label="Note" name="note" defaultValue={p.note ?? ""} maxLength={300} className="w-64" />
                <div className="pt-[22px]">
                  <SubmitButton variant="outline">Save &amp; recalculate</SubmitButton>
                </div>
              </ActionForm>
            </details>
          </td>
        </tr>
      )}
    </>
  );
}
