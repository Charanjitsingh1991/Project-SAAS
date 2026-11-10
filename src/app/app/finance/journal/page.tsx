import type { Metadata } from "next";
import { desc, eq, inArray } from "drizzle-orm";
import { Badge, Card, EmptyState, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { createJournalAction } from "../actions";
import { JournalForm } from "../_components/journal-form";
import { FINANCE_TABS } from "../tabs";

export const metadata: Metadata = { title: "Journal" };

export default async function JournalPage() {
  const ws = await requireWorkspace({ module: "finance" });
  const cur = ws.org.currency;
  const orgId = ws.org.id;

  const [entries, accounts] = await Promise.all([
    db.select().from(schema.journalEntries).where(eq(schema.journalEntries.orgId, orgId)).orderBy(desc(schema.journalEntries.date), desc(schema.journalEntries.id)).limit(100),
    db.select().from(schema.accounts).where(eq(schema.accounts.orgId, orgId)).orderBy(schema.accounts.code),
  ]);
  const lines = entries.length
    ? await db.select().from(schema.journalLines).where(inArray(schema.journalLines.entryId, entries.map((e) => e.id))).orderBy(schema.journalLines.id)
    : [];
  const acctById = new Map(accounts.map((a) => [a.id, a]));

  return (
    <>
      <PageHeader title="Journal" description="Every posting in the ledger, newest first. Post manual adjustments below — entries must balance." tabs={FINANCE_TABS("journal")} />
      <div className="grid gap-6 xl:grid-cols-[1fr_460px]">
        <div className="min-w-0 space-y-3">
          {entries.length === 0 ? (
            <EmptyState title="No journal entries yet" />
          ) : (
            entries.map((e) => {
              const ls = lines.filter((l) => l.entryId === e.id);
              return (
                <Card key={e.id}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{e.memo}</p>
                      <p className="text-xs text-ink-mute">{formatDate(e.date)}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Badge tone={e.sourceType === "manual" ? "lilac" : e.sourceType === "reversal" ? "rose" : "card"}>{e.sourceType.replace("_", " ")}</Badge>
                      {e.reversed && <Badge tone="rose">reversed</Badge>}
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {ls.map((l) => (
                        <tr key={l.id} className="border-t border-line/60">
                          <td className={l.credit > 0 ? "py-1.5 pl-6" : "py-1.5"}>
                            <span className="text-ink-mute">{acctById.get(l.accountId)?.code}</span> {acctById.get(l.accountId)?.name}
                          </td>
                          <td className="w-28 py-1.5 text-right tabular-nums">{l.debit ? formatMoney(l.debit, cur) : ""}</td>
                          <td className="w-28 py-1.5 text-right tabular-nums">{l.credit ? formatMoney(l.credit, cur) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              );
            })
          )}
        </div>

        <Card title="Manual journal entry" className="h-fit">
          <JournalForm action={createJournalAction} accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))} today={todayYmd()} currency={cur} />
        </Card>
      </div>
    </>
  );
}
