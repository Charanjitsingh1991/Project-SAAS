import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, formatPeriod, fromMinor, todayYmd } from "@/lib/format";
import { parseBreakdown, sumLines, type PayslipBreakdown } from "@/lib/payroll-types";
import { legacyBreakdown } from "@/lib/posting";
import { buildEcr, buildEsi } from "@/lib/statutory-in";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { adjustSlip, approveRun, deleteRun, markPaid, recalcRun } from "../actions";

export const metadata: Metadata = { title: "Payroll run" };

const SHORT: Record<string, string> = { pf: "PF", esi: "ESI", pt: "PT", tds: "TDS", pension: "GPSSA", loan: "Loan", other: "Other" };

/** [head, employee deduction codes, employer line codes] */
const STATUTORY: Record<"IN" | "AE", [string, string[], string[]][]> = {
  IN: [
    ["Provident Fund (PF)", ["pf"], ["pf_employer"]],
    ["Employees' State Insurance (ESI)", ["esi"], ["esi_employer"]],
    ["Professional Tax (PT)", ["pt"], []],
    ["Income tax (TDS, s.192)", ["tds"], []],
  ],
  AE: [
    ["GPSSA pension (UAE nationals)", ["pension"], ["pension_employer"]],
    ["End-of-service gratuity provision", [], ["gratuity"]],
  ],
};

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
    .select({
      p: schema.payslips,
      bankAccount: schema.employees.bankAccount,
      ifsc: schema.employees.ifsc,
      iban: schema.employees.iban,
      routing: schema.employees.bankRoutingCode,
      personId: schema.employees.wpsPersonId,
      uan: schema.employees.uan,
      exitDate: schema.employees.exitDate,
    })
    .from(schema.payslips)
    .leftJoin(schema.employees, eq(schema.payslips.employeeId, schema.employees.id))
    .where(and(eq(schema.payslips.runId, id), eq(schema.payslips.orgId, ws.org.id)))
    .orderBy(asc(schema.payslips.employeeCode));

  const draft = run.status === "draft";
  const pack = packFor(ws);
  const uae = pack.code === "AE";
  const bds = new Map<number, PayslipBreakdown>(slips.map((x) => [x.p.id, parseBreakdown(x.p.breakdown) ?? legacyBreakdown(x.p)]));
  const dedCodes = [...new Set(slips.flatMap((x) => bds.get(x.p.id)!.deductions.filter((d) => d.amount).map((d) => d.code)))];
  const statutory = STATUTORY[uae ? "AE" : "IN"].map(([label, emp, er]) => {
    let e = 0;
    let r = 0;
    let n = 0;
    for (const x of slips) {
      const b = bds.get(x.p.id)!;
      const se = sumLines(b.deductions.filter((d) => emp.includes(d.code)));
      const sr = sumLines(b.employer.filter((l) => er.includes(l.code)));
      e += se;
      r += sr;
      if (se + sr > 0) n++;
    }
    return { label, e, r, n };
  });

  const statSlips = slips.map((x) => ({ employeeId: x.p.employeeId, code: x.p.employeeCode, name: x.p.employeeName, gross: x.p.gross, paidDays: x.p.paidDays, lopDays: x.p.lopDays, breakdown: bds.get(x.p.id)!, uan: x.uan, exitDate: x.exitDate }));
  const ecr = !uae && !draft ? buildEcr(statSlips) : null;
  const esi = !uae && !draft ? buildEsi(statSlips, run.period) : null;

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
        <Stat label="Employer cost" value={money(run.totalEmployerCost)} hint={uae ? "Gross + employer GPSSA + gratuity accrual" : "Gross + employer PF & ESI"} tone="butter" />
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
                  {dedCodes.map((c) => (
                    <Th key={c} className="text-right">
                      {SHORT[c] ?? c}
                    </Th>
                  ))}
                  <Th className="text-right">Net</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {slips.map(({ p }) => (
                  <PayslipRows key={p.id} p={p} b={bds.get(p.id)!} codes={dedCodes} draft={draft} cur={cur} />
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "statutory" && ecr && esi && (
        <Card
          title="India statutory files"
          className="mb-6"
          actions={
            <span className="flex gap-4">
              {ecr.count > 0 && (
                <a href={`/api/payroll/${run.id}/ecr`} className="text-sm font-medium underline-offset-4 hover:underline">
                  Download PF ECR
                </a>
              )}
              {esi.count > 0 && (
                <a href={`/api/payroll/${run.id}/esi`} className="text-sm font-medium underline-offset-4 hover:underline">
                  Download ESI file
                </a>
              )}
            </span>
          }
        >
          <p className="text-sm text-ink-soft">
            PF ECR (EPFO ECR 2.0 text) has {ecr.count} member{ecr.count === 1 ? "" : "s"}; the ESI contribution CSV has {esi.count} employee{esi.count === 1 ? "" : "s"}. Upload them on the EPFO / ESIC portals — these files are aids, not filed returns.
          </p>
          {ecr.missingUan.length > 0 && (
            <p className="mt-3 text-sm text-signal">
              Excluded from the ECR file — missing or invalid 12-digit UAN: {ecr.missingUan.map((m) => `${m.name} (${m.code})`).join(", ")}. Add the UAN on the employee record and download again.
            </p>
          )}
          {esi.count > 0 && <p className="mt-3 text-sm text-ink-soft">ESIC IP numbers aren&apos;t stored in the app, so the IP Number column is blank — fill it in before uploading.</p>}
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
              {statutory.map(({ label, e, r, n }) => (
                <tr key={label}>
                  <Td className="font-medium">{label}</Td>
                  <Td className="text-right tabular-nums">{money(e)}</Td>
                  <Td className="text-right tabular-nums">{money(r)}</Td>
                  <Td className="text-right font-medium tabular-nums">{money(e + r)}</Td>
                  <Td className="text-right tabular-nums">{n}</Td>
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
            <span className="flex gap-4">
              {uae && !draft && (
                <a href={`/api/payroll/${run.id}/sif`} className="text-sm font-medium underline-offset-4 hover:underline">
                  Download WPS SIF
                </a>
              )}
              {ecr && ecr.count > 0 && (
                <a href={`/api/payroll/${run.id}/ecr`} className="text-sm font-medium underline-offset-4 hover:underline">
                  Download PF ECR
                </a>
              )}
              {esi && esi.count > 0 && (
                <a href={`/api/payroll/${run.id}/esi`} className="text-sm font-medium underline-offset-4 hover:underline">
                  Download ESI file
                </a>
              )}
              <a href={`/api/export/payslips?run=${run.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
                Download CSV
              </a>
            </span>
          }
        >
          {uae && draft && <p className="mb-3 text-sm text-ink-soft">Approve the run to generate the WPS salary information file (SIF).</p>}
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                {uae ? (
                  <>
                    <Th>IBAN</Th>
                    <Th>Routing code</Th>
                    <Th>MOHRE person ID</Th>
                  </>
                ) : (
                  <>
                    <Th>Account</Th>
                    <Th>IFSC</Th>
                  </>
                )}
                <Th className="text-right">Net pay</Th>
              </tr>
            </thead>
            <tbody>
              {slips.map(({ p, bankAccount, ifsc, iban, routing, personId }) => (
                <tr key={p.id}>
                  <Td className="font-medium">
                    {p.employeeName} <span className="font-mono text-xs text-ink-mute">{p.employeeCode}</span>
                  </Td>
                  {(uae ? [iban, routing, personId] : [bankAccount, ifsc]).map((v, i) => (
                    <Td key={i} className="font-mono text-xs">
                      {v ?? <span className="text-signal">Missing</span>}
                    </Td>
                  ))}
                  <Td className="text-right font-medium tabular-nums">{money(p.net)}</Td>
                </tr>
              ))}
              <tr>
                <Td className="font-semibold">Total</Td>
                <td colSpan={uae ? 3 : 2} className="border-b border-line/70" />
                <Td className="text-right font-semibold tabular-nums">{money(run.totalNet)}</Td>
              </tr>
            </tbody>
          </Table>
        </Card>
      )}

      <Card title="How this is calculated">
        <ul className="grid gap-2 text-sm text-ink-soft md:grid-cols-2">
          {uae ? (
            <>
              <li><b className="text-ink">Earnings:</b> basic, housing, transport and other allowances from the employee&apos;s salary components (default 60/25/10/5% of the package), pro-rated by paid days ÷ {run.daysInMonth} days.</li>
              <li><b className="text-ink">LOP:</b> absent days + unpaid leave + ½ per half-day or half-pay leave day.</li>
              <li><b className="text-ink">Income tax:</b> none — the UAE has no personal income tax.</li>
              <li><b className="text-ink">GPSSA (UAE nationals only):</b> 11% employee; employer 12.5% (15% at AED 20,000+) of the full contract salary, bounded AED 3,000–70,000. Abu Dhabi (ADPF) and GCC-national schemes aren&apos;t modelled.</li>
              <li><b className="text-ink">Gratuity accrual (expats):</b> basic ÷ 30 × 21 days per year (30 days after 5 years) ÷ 12, posted to the gratuity provision.</li>
              <li><b className="text-ink">Net</b> = gross + approved claims − GPSSA − loan recovery − other deductions. Paid through WPS using the SIF file.</li>
            </>
          ) : (
            <>
              <li><b className="text-ink">Earnings:</b> Basic = 50% of CTC/12; HRA = 40% of Basic (50% in metros); Special = the remainder. All pro-rated by paid days ÷ {run.daysInMonth} days.</li>
              <li><b className="text-ink">LOP:</b> absent days + unpaid leave + ½ per half-day. Days before joining or after exit are unpaid but not LOP.</li>
              <li><b className="text-ink">PF:</b> 12% of Basic capped at a ₹15,000 wage (max ₹1,800), employee and employer, if enrolled.</li>
              <li><b className="text-ink">ESI:</b> if gross ≤ ₹21,000: 0.75% employee, 3.25% employer of gross.</li>
              <li><b className="text-ink">Professional tax:</b> ₹200 when gross exceeds ₹15,000.</li>
              <li><b className="text-ink">TDS (new regime FY2025-26):</b> (gross × 12 − ₹75,000) taxed at 0/5/10/15/20/25/30% slabs from ₹4L; nil if taxable ≤ ₹12L (s.87A); +4% cess; ÷ 12.</li>
              <li><b className="text-ink">Net</b> = gross + approved claims − PF − ESI − PT − TDS − loan recovery − other deductions. <b className="text-ink">Employer cost</b> = gross + employer PF + employer ESI.</li>
            </>
          )}
        </ul>
      </Card>
    </>
  );
}

function PayslipRows({ p, b, codes, draft, cur }: { p: typeof schema.payslips.$inferSelect; b: PayslipBreakdown; codes: string[]; draft: boolean; cur: string }) {
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
        {codes.map((c) => (
          <Td key={c} className="text-right tabular-nums">
            {m(sumLines(b.deductions.filter((d) => d.code === c)))}
          </Td>
        ))}
        <Td className="text-right font-medium tabular-nums">{m(p.net)}</Td>
        <Td className="text-right">
          <Link href={`/app/payroll/payslips/${p.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
            Payslip
          </Link>
        </Td>
      </tr>
      {draft && (
        <tr>
          <td colSpan={codes.length + 6} className="border-b border-line/70 px-5 py-2">
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
