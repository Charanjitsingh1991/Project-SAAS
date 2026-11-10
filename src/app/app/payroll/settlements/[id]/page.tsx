import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Card, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { nationalityName } from "@/lib/countries";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { amountInWords } from "@/lib/money";
import { parseSettlementBreakdown, type SettlementLine } from "@/lib/settlement";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { deleteSettlement, paySettlementAction } from "../../extras-actions";
import { PrintButton } from "../../print-button";
import { activeLoanBalance, openPayslips } from "../data";
import { SettlementForm } from "../settlement-form";

export const metadata: Metadata = { title: "Final settlement" };

export default async function SettlementPage(props: PageProps<"/app/payroll/settlements/[id]">) {
  const ws = await requireWorkspace({ module: "payroll", manage: true });
  const { id: rawId } = await props.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  const [row] = await db
    .select({ s: schema.finalSettlements, emp: schema.employees })
    .from(schema.finalSettlements)
    .innerJoin(schema.employees, eq(schema.finalSettlements.employeeId, schema.employees.id))
    .where(and(eq(schema.finalSettlements.id, id), eq(schema.finalSettlements.orgId, ws.org.id)))
    .limit(1);
  if (!row) notFound();
  const { s, emp } = row;

  const cur = ws.org.currency;
  const m = (n: number) => formatMoney(n, cur);
  const pack = packFor(ws);
  const uae = pack.code === "AE";
  const draft = s.status === "draft";
  const bd = parseSettlementBreakdown(s.breakdown);
  const lines: SettlementLine[] =
    bd?.lines ??
    [
      { code: "salary", label: "Pending salary", kind: "earning" as const, amount: s.pendingSalary, note: "" },
      { code: "leave", label: "Leave encashment", kind: "earning" as const, amount: s.leaveEncashment, note: `${s.leaveEncashmentDays} day(s)` },
      { code: "gratuity", label: "Gratuity", kind: "earning" as const, amount: s.gratuity, note: "" },
      { code: "other_earnings", label: "Other earnings", kind: "earning" as const, amount: s.otherEarnings, note: "" },
      { code: "loan", label: "Loan / advance recovery", kind: "deduction" as const, amount: s.loanRecovery, note: "" },
      { code: "other_deductions", label: "Other deductions", kind: "deduction" as const, amount: s.otherDeductions, note: "" },
    ];
  const earnings = lines.filter((l) => l.kind === "earning");
  const deductions = lines.filter((l) => l.kind === "deduction");
  const totalE = earnings.reduce((t, l) => t + l.amount, 0);
  const totalD = deductions.reduce((t, l) => t + l.amount, 0);
  const owes = s.netPayable < 0;

  const [open, loanNow] = draft ? await Promise.all([openPayslips(ws.org.id, emp.id), activeLoanBalance(ws.org.id, emp.id)]) : [[], s.loanRecovery];
  const stale = draft && loanNow !== s.loanRecovery;
  const years = Math.floor(s.serviceDays / 365);
  const rem = s.serviceDays - years * 365;

  const details: [string, string][] = [
    ["Employee", emp.name],
    ["Employee ID", emp.code],
    ["Designation", emp.designation],
    ["Date of joining", formatDate(emp.joinDate)],
    ["Last working day", formatDate(s.exitDate)],
    ["Service", `${years} yr${years === 1 ? "" : "s"} ${rem} day${rem === 1 ? "" : "s"} (${s.serviceDays} days)`],
    ...(uae
      ? ([
          ["Nationality", nationalityName(emp.nationality) || "—"],
          ["Labour card", emp.labourCardNumber ?? "—"],
        ] as [string, string][])
      : ([
          ["PAN", emp.pan ?? "—"],
          ["UAN", emp.uan ?? "—"],
        ] as [string, string][])),
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/app/payroll/settlements" className="text-sm text-ink-soft underline-offset-4 hover:underline">
          ← All settlements
        </Link>
        <div className="flex items-center gap-2">
          {draft && (
            <ActionButton action={deleteSettlement} fields={{ id: s.id }} confirm="Delete this draft settlement?" className="text-signal">
              Delete draft
            </ActionButton>
          )}
          <PrintButton />
        </div>
      </div>

      {draft && (
        <div className="mb-6 space-y-6 print:hidden">
          <Card title="Edit draft">
            <SettlementForm
              employeeId={emp.id}
              values={{ exitDate: s.exitDate, unpaidDays: bd?.inputs.unpaidDays ?? 0, leaveDays: s.leaveEncashmentDays, otherEarnings: s.otherEarnings, otherDeductions: s.otherDeductions }}
              hints={{}}
              submitLabel="Recalculate"
            />
            {stale && <p className="mt-3 rounded-xl bg-signal/10 px-3 py-2 text-sm text-signal">Loan balances changed since this draft was saved ({m(loanNow)} now outstanding) — recalculate before paying.</p>}
          </Card>
          <Card title="Pay settlement">
            {open.length > 0 ? (
              <p className="text-sm text-signal">
                This employee is on the {open[0].status} payroll run for {open[0].period}.{" "}
                <Link href={`/app/payroll/${open[0].runId}`} className="underline">Pay or remove them from it</Link> before paying the settlement.
              </p>
            ) : (
              <ActionForm action={paySettlementAction} className="flex flex-wrap items-start gap-3" resetOnSuccess={false}>
                <input type="hidden" name="id" value={s.id} />
                <Input label="Payment date" name="date" type="date" defaultValue={todayYmd()} required className="w-52" />
                <div className="pt-[22px]">
                  <SubmitButton>{owes ? "Record recovery" : "Mark paid"}</SubmitButton>
                </div>
              </ActionForm>
            )}
            <p className="mt-3 text-sm text-ink-soft">
              Posts the settlement journal (gratuity is charged to the accrued provision first), closes outstanding loans and marks the employee as exited. This cannot be undone.
            </p>
          </Card>
        </div>
      )}

      <article className="rounded-[20px] border border-line bg-card p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{ws.org.name}</h1>
            {ws.org.address && <p className="mt-1 max-w-xs text-sm whitespace-pre-line text-ink-soft">{ws.org.address}</p>}
            {ws.org.gstin && <p className="mt-1 font-mono text-xs text-ink-mute">{pack.tax.idLabel} {ws.org.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Full &amp; final settlement</p>
            <p className="mt-1">
              <StatusBadge value={s.status} />
            </p>
            {s.paidOn && <p className="mt-1 text-sm text-ink-soft">Settled on {formatDate(s.paidOn)}</p>}
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line py-5 text-sm sm:grid-cols-3">
          {details.map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">{k}</dt>
              <dd className="mt-0.5 font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="space-y-6 py-5">
          <Section title="Earnings" lines={earnings} total={totalE} totalLabel="Total dues" m={m} />
          <Section title="Deductions" lines={deductions} total={totalD} totalLabel="Total deductions" m={m} />
        </div>

        <div className={`rounded-2xl p-6 text-center ${owes ? "bg-peach" : "bg-mint"}`}>
          <p className="font-mono text-[11px] tracking-widest text-ink/60 uppercase">{owes ? "Recoverable from employee" : "Net payable to employee"}</p>
          <p className="mt-1 font-display text-4xl font-bold tracking-tight">{m(Math.abs(s.netPayable))}</p>
          <p className="mt-1 text-sm text-ink/70">{amountInWords(Math.abs(s.netPayable), cur)}</p>
        </div>

        <div className="mt-5 space-y-1 text-xs text-ink-mute">
          {(bd?.notes ?? []).map((n) => (
            <p key={n}>{n}</p>
          ))}
          <p>
            {uae
              ? "End-of-service gratuity: 21 days' basic wage per year for the first five years and 30 days per year thereafter, capped at two years' wage; nothing below one year of service. UAE nationals are covered by GPSSA pension instead."
              : "Gratuity: payable after five years of continuous service (earlier on death or disablement) at 15 days' wages per completed year (wages = basic + DA, ÷ 26), capped at ₹20 lakh."}
          </p>
          <p>Statutory figures are calculated from the salary and service data on record and should be reviewed against the employment contract and current law before payment.</p>
        </div>

        <footer className="mt-10 grid grid-cols-2 gap-10 text-sm">
          <div className="border-t border-line pt-2 text-ink-soft">Authorised signatory</div>
          <div className="border-t border-line pt-2 text-ink-soft">Employee acknowledgement</div>
        </footer>
      </article>
    </div>
  );
}

function Section({ title, lines, total, totalLabel, m }: { title: string; lines: SettlementLine[]; total: number; totalLabel: string; m: (n: number) => string }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] tracking-widest text-ink-mute uppercase">{title}</p>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((l) => (
            <tr key={l.code} className="border-b border-line/70 align-top">
              <td className="py-2 pr-4">
                <p className="font-medium">{l.label}</p>
                {l.note && <p className="text-xs text-ink-mute">{l.note}</p>}
              </td>
              <td className="py-2 text-right tabular-nums">{m(l.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-semibold">{totalLabel}</td>
            <td className="py-2 text-right font-semibold tabular-nums">{m(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
