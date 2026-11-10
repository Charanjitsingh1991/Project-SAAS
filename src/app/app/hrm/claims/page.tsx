import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/app/ui";
import { CLAIM_TONE, claimCategoryLabel, claimSummary, listClaims, type ClaimStatus } from "@/lib/claims";
import { formatDate, formatMoney } from "@/lib/format";
import { planModules, requireWorkspace } from "@/lib/tenancy";
import { approveClaimAction, rejectClaimAction } from "../claim-actions";
import { hrmTabs } from "../tabs";

export const metadata: Metadata = { title: "Expense claims" };

const FILTERS = ["submitted", "approved", "reimbursed", "rejected", "all"] as const;

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string }> }) {
  const ws = await requireWorkspace({ module: "hrm", manage: true, feature: "expenseClaims" });
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f === sp.status) ?? "submitted";
  const cur = ws.org.currency;
  const [claims, sum] = await Promise.all([listClaims(ws.org.id, filter === "all" ? undefined : (filter as ClaimStatus)), claimSummary(ws.org.id)]);
  const payroll = planModules(ws).includes("payroll");

  return (
    <>
      <PageHeader
        title="Expense claims"
        description={`Employees submit claims from My space. Approving posts the expense${payroll ? "; “via payroll” claims are added to the next payslip, others are paid from bank at once" : " and pays it from bank"}.`}
        tabs={hrmTabs(ws, "claims")}
      />

      {sp.error && <p role="alert" className="mb-4 rounded-xl bg-signal/10 px-4 py-3 text-sm text-signal">{sp.error}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting review" value={sum.pending.n} hint={formatMoney(sum.pending.total, cur)} tone="butter" />
        <Stat label="Approved · in next payroll" value={sum.inPayroll.n} hint={formatMoney(sum.inPayroll.total, cur)} tone="sky" />
        <Stat label="Reimbursed" value={sum.reimbursed.n} hint={formatMoney(sum.reimbursed.total, cur)} tone="mint" />
        <Stat label="Rejected" value={sum.rejected.n} tone="rose" />
      </div>

      <Card
        title="Claims"
        actions={
          <div className="flex flex-wrap gap-1 text-xs">
            {FILTERS.map((s) => (
              <Link
                key={s}
                href={`/app/hrm/claims?status=${s}`}
                className={`rounded-full border px-3 py-1 capitalize ${s === filter ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}
              >
                {s === "submitted" ? "to review" : s}
              </Link>
            ))}
          </div>
        }
      >
        {claims.length === 0 ? (
          <EmptyState title={filter === "submitted" ? "Nothing to review" : "No claims here"}>
            {filter === "submitted" ? "New claims from employees will appear here." : undefined}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Date</Th>
                <Th>Expense</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Tax</Th>
                <Th className="text-right">Total</Th>
                <Th>Via</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {claims.map(({ c, name, code, empId }) => (
                <tr key={c.id} className="align-top">
                  <Td>
                    <Link href={`/app/hrm/${empId}`} className="font-medium hover:underline">
                      {name}
                    </Link>
                    <span className="block font-mono text-xs text-ink-mute">{code}</span>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(c.date)}</Td>
                  <Td>
                    {c.description}
                    <span className="block text-xs text-ink-mute">{claimCategoryLabel(c.category)}</span>
                    {c.rejectionReason && <span className="block text-xs text-signal">Rejected: {c.rejectionReason}</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(c.amount, cur)}</Td>
                  <Td className="text-right tabular-nums">{c.taxAmount ? formatMoney(c.taxAmount, cur) : "—"}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatMoney(c.total, cur)}</Td>
                  <Td className="capitalize">{c.reimburseVia}</Td>
                  <Td>
                    <Badge tone={CLAIM_TONE[c.status]}>{c.status}</Badge>
                  </Td>
                  <Td className="min-w-56">
                    {c.status === "submitted" && (
                      <div className="space-y-2">
                        <ActionButton action={approveClaimAction} fields={{ id: c.id }} confirm={`Approve ${formatMoney(c.total, cur)} for ${name}?`}>
                          Approve
                        </ActionButton>
                        <details>
                          <summary className="cursor-pointer text-xs text-ink-soft hover:text-ink">Reject…</summary>
                          <ActionForm action={rejectClaimAction} className="mt-2 space-y-2">
                            <input type="hidden" name="id" value={c.id} />
                            <Input label="Reason" name="reason" placeholder="Receipt missing, not policy…" />
                            <SubmitButton variant="outline">Reject claim</SubmitButton>
                          </ActionForm>
                        </details>
                      </div>
                    )}
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
