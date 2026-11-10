import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { daysApart } from "@/lib/bank-rec";
import { YMD } from "@/lib/finance-utils";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { fromMinor, toMinor } from "@/lib/money";
import { hasFeature, requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { ConfirmAction } from "../_components/confirm-action";
import { UpgradeHint } from "../_components/upgrade-hint";
import { FINANCE_TABS } from "../tabs";
import { autoMatchAction, deleteLineAction, ignoreLineAction, importStatementAction, matchLineAction, unmatchLineAction } from "./actions";
import { bankAccountId, ledgerBankBalance, ledgerBankItems } from "./data";

export const metadata: Metadata = { title: "Bank reconciliation" };

const VIEWS = ["unmatched", "matched", "ignored", "all"] as const;

export default async function BankPage({ searchParams }: PageProps<"/app/finance/bank">) {
  const ws = await requireWorkspace({ module: "finance" });
  const header = (
    <PageHeader
      title="Bank reconciliation"
      description="Import your bank statement, match each line to a payment, bill or journal in the ledger, and check the closing balance agrees."
      tabs={FINANCE_TABS("bank")}
    />
  );
  if (!hasFeature(ws, "bankReconciliation")) {
    return (
      <>
        {header}
        <UpgradeHint feature="bankReconciliation" title="Bank reconciliation">
          Import bank statements as CSV, auto-match them to customer payments and bill payments, and prove your books agree with the bank.
        </UpgradeHint>
      </>
    );
  }

  const sp = await searchParams;
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const money = (v: number) => formatMoney(v, cur);
  const view = (VIEWS as readonly string[]).includes(String(sp.view)) ? String(sp.view) : "unmatched";

  const bankId = await bankAccountId(orgId);
  const [lines, items] = await Promise.all([
    db.select().from(schema.bankStatementLines).where(eq(schema.bankStatementLines.orgId, orgId)).orderBy(desc(schema.bankStatementLines.date), desc(schema.bankStatementLines.id)),
    bankId ? ledgerBankItems(orgId, bankId) : Promise.resolve([]),
  ]);
  const itemById = new Map(items.map((i) => [i.entryId, i]));
  const matchedIds = new Set(lines.filter((l) => l.status === "matched" && l.journalEntryId).map((l) => l.journalEntryId!));
  const openItems = items.filter((i) => !matchedIds.has(i.entryId));

  const lastDate = lines.reduce((m, l) => (l.date > m ? l.date : m), "");
  const asOf = typeof sp.asOf === "string" && YMD.test(sp.asOf) ? sp.asOf : lastDate || todayYmd();
  const statementSum = lines.filter((l) => l.date <= asOf).reduce((s, l) => s + l.amount, 0);
  const closingParam = typeof sp.closing === "string" ? toMinor(sp.closing) : NaN;
  const closing = Number.isFinite(closingParam) ? closingParam : statementSum;
  const ledger = bankId ? await ledgerBankBalance(orgId, bankId, asOf) : 0;
  const diff = closing - ledger;
  const unmatchedLines = lines.filter((l) => l.status === "unmatched");
  const openToDate = openItems.filter((i) => i.date <= asOf);
  const shown = view === "all" ? lines : lines.filter((l) => l.status === view);
  const counts = Object.fromEntries(VIEWS.map((v) => [v, v === "all" ? lines.length : lines.filter((l) => l.status === v).length]));
  const href = (v: string) => `/app/finance/bank?${new URLSearchParams({ view: v, asOf, ...(Number.isFinite(closingParam) ? { closing: String(fromMinor(closing)) } : {}) })}`;

  // Suggestions for manual matching: same direction, closest amount then date.
  const candidates = (l: { amount: number; date: string }) =>
    openItems
      .filter((i) => Math.sign(i.amount) === Math.sign(l.amount))
      .sort((a, b) => Math.abs(a.amount - l.amount) - Math.abs(b.amount - l.amount) || daysApart(a.date, l.date) - daysApart(b.date, l.date))
      .slice(0, 15);

  const imported = typeof sp.imported === "string" ? sp.imported : null;

  return (
    <>
      {header}
      {imported !== null && (
        <p role="status" className="mb-4 rounded-xl bg-mint/60 px-4 py-2 text-sm">
          Imported {imported} line{imported === "1" ? "" : "s"}
          {sp.skipped && sp.skipped !== "0" ? `, skipped ${sp.skipped} already imported` : ""}
          {sp.matched ? `, auto-matched ${sp.matched}` : ""}
          {sp.errors && sp.errors !== "0" ? ` · ${sp.errors} row${sp.errors === "1" ? "" : "s"} couldn't be read` : ""}.
        </p>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`Statement balance · ${formatDate(asOf)}`} value={money(closing)} hint={Number.isFinite(closingParam) ? "From statement" : "Sum of imported lines"} tone="sky" />
        <Stat label="Ledger bank balance" value={money(ledger)} hint="Bank & cash account" tone="lilac" />
        <Stat label="Difference" value={money(diff)} hint={diff === 0 ? "Reconciled ✓" : "Statement − ledger"} tone={diff === 0 ? "mint" : "rose"} />
        <Stat label="To reconcile" value={`${unmatchedLines.length} · ${openToDate.length}`} hint="Statement lines · ledger items" tone="butter" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {VIEWS.map((v) => (
                <Link key={v} href={href(v)} className={cn("rounded-full border px-3 py-1 text-xs font-medium capitalize transition", view === v ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}>
                  {v} <span className="opacity-60">{counts[v]}</span>
                </Link>
              ))}
            </div>
            <ConfirmAction action={autoMatchAction} fields={{}} className="h-8 px-3 text-xs">
              Auto-match (exact amount, ±3 days)
            </ConfirmAction>
          </div>

          <Card title="Statement lines">
            {shown.length === 0 ? (
              <EmptyState title={lines.length ? "Nothing here" : "No statement imported yet"}>{lines.length ? "Try another filter." : "Import a CSV from your bank to start reconciling."}</EmptyState>
            ) : (
              <div className="-mx-5 -my-5 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Description</Th>
                      <Th className="text-right">Amount</Th>
                      <Th>Status</Th>
                      <Th>Ledger match</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((l) => {
                      const m = l.journalEntryId ? itemById.get(l.journalEntryId) : undefined;
                      return (
                        <tr key={l.id} className="align-top">
                          <Td className="whitespace-nowrap">{formatDate(l.date)}</Td>
                          <Td>
                            <span className="font-medium">{l.description}</span>
                            {l.reference && <span className="block text-xs text-ink-mute">Ref {l.reference}</span>}
                          </Td>
                          <Td className={cn("text-right tabular-nums", l.amount < 0 && "text-signal")}>{money(l.amount)}</Td>
                          <Td>
                            <Badge tone={l.status === "unmatched" ? "peach" : l.status === "matched" ? "mint" : "card"}>{l.status}</Badge>
                          </Td>
                          <Td>
                            {l.status === "matched" ? (
                              <div className="flex flex-col items-start gap-1.5">
                                <span className="text-xs">
                                  {m ? (
                                    <>
                                      {formatDate(m.date)} · {m.memo}
                                    </>
                                  ) : (
                                    `Entry #${l.journalEntryId}`
                                  )}
                                </span>
                                <ConfirmAction action={unmatchLineAction} fields={{ lineId: l.id }} className="h-7 px-3 text-xs">
                                  Unmatch
                                </ConfirmAction>
                              </div>
                            ) : l.status === "ignored" ? (
                              <ConfirmAction action={unmatchLineAction} fields={{ lineId: l.id }} className="h-7 px-3 text-xs">
                                Restore
                              </ConfirmAction>
                            ) : (
                              <div className="flex flex-col items-start gap-1.5">
                                <ActionForm action={matchLineAction} className="flex items-center gap-1.5">
                                  <input type="hidden" name="lineId" value={l.id} />
                                  <select name="entryId" aria-label="Ledger entry" defaultValue="" className="h-8 max-w-64 rounded-lg border border-line bg-paper/60 px-1 text-xs">
                                    <option value="">— Choose ledger entry —</option>
                                    {candidates(l).map((c) => (
                                      <option key={c.entryId} value={c.entryId}>
                                        {formatDate(c.date)} · {money(c.amount)} · {c.memo.slice(0, 40)}
                                      </option>
                                    ))}
                                  </select>
                                  <SubmitButton className="h-8 px-3 text-xs">Match</SubmitButton>
                                </ActionForm>
                                <div className="flex gap-1.5">
                                  <ConfirmAction action={ignoreLineAction} fields={{ lineId: l.id }} className="h-7 px-3 text-xs">
                                    Ignore
                                  </ConfirmAction>
                                  <ConfirmAction action={deleteLineAction} fields={{ lineId: l.id }} confirm="Delete this statement line?" variant="danger" className="h-7 px-3 text-xs">
                                    Delete
                                  </ConfirmAction>
                                </div>
                              </div>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Unreconciled ledger items">
            {openItems.length === 0 ? (
              <EmptyState title="Every bank movement in the ledger is matched" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Memo</Th>
                    <Th>Source</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {openItems
                    .slice()
                    .reverse()
                    .slice(0, 200)
                    .map((i) => (
                      <tr key={i.entryId}>
                        <Td className="whitespace-nowrap">{formatDate(i.date)}</Td>
                        <Td>{i.memo}</Td>
                        <Td className="capitalize text-ink-soft">{i.sourceType.replace("_", " ")}</Td>
                        <Td className={cn("text-right tabular-nums", i.amount < 0 && "text-signal")}>{money(i.amount)}</Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Import statement" className="h-fit">
            <ActionForm action={importStatementAction} className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-soft">Bank statement (CSV, max 2 MB)</span>
                <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-paper" />
              </label>
              <SubmitButton className="w-full">Import & auto-match</SubmitButton>
              <p className="text-xs text-ink-mute">
                Needs a <b>Date</b> column and either a signed <b>Amount</b> (+ money in, − money out) or <b>Debit</b>/<b>Credit</b> (or Withdrawal/Deposit) columns. Description, Reference and Balance are used when present. Dates are read day-first (DD/MM/YYYY). Lines already imported are skipped.
              </p>
            </ActionForm>
          </Card>

          <Card title="Statement closing balance" className="h-fit">
            <form action="/app/finance/bank" className="space-y-3">
              <input type="hidden" name="view" value={view} />
              <label className="block text-xs text-ink-soft">
                Closing balance per bank
                <input name="closing" inputMode="decimal" defaultValue={fromMinor(closing)} className="mt-1 block h-9 w-full rounded-xl border border-line bg-paper/60 px-2 text-sm" />
              </label>
              <label className="block text-xs text-ink-soft">
                As of
                <input type="date" name="asOf" defaultValue={asOf} className="mt-1 block h-9 w-full rounded-xl border border-line bg-paper/60 px-2 text-sm" />
              </label>
              <button className="h-9 w-full rounded-full border border-ink/20 px-4 text-sm font-medium hover:border-ink">Compare with ledger</button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
