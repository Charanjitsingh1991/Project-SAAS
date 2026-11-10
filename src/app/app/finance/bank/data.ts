import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { autoMatch } from "@/lib/bank-rec";

const jl = schema.journalLines;
const je = schema.journalEntries;

export async function bankAccountId(orgId: number) {
  const [a] = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.orgId, orgId), eq(schema.accounts.systemKey, "bank")))
    .limit(1);
  return a?.id ?? null;
}

export type LedgerBankItem = { entryId: number; date: string; memo: string; sourceType: string; amount: number };

/** Ledger entries that move the bank account (net + in / − out). Reversed entries and their reversals cancel out and are skipped. */
export async function ledgerBankItems(orgId: number, bankId: number): Promise<LedgerBankItem[]> {
  const rows = await db
    .select({
      entryId: je.id,
      date: je.date,
      memo: je.memo,
      sourceType: je.sourceType,
      reversed: je.reversed,
      dr: sql<number>`coalesce(sum(${jl.debit}), 0)`,
      cr: sql<number>`coalesce(sum(${jl.credit}), 0)`,
    })
    .from(jl)
    .innerJoin(je, eq(jl.entryId, je.id))
    .where(and(eq(jl.orgId, orgId), eq(jl.accountId, bankId)))
    .groupBy(je.id)
    .orderBy(je.date, je.id);
  return rows
    .filter((r) => !r.reversed && r.sourceType !== "reversal")
    .map((r) => ({ entryId: r.entryId, date: r.date, memo: r.memo, sourceType: r.sourceType, amount: Number(r.dr) - Number(r.cr) }))
    .filter((r) => r.amount !== 0);
}

/** Bank account balance in the ledger up to and including `asOf`. */
export async function ledgerBankBalance(orgId: number, bankId: number, asOf: string) {
  const [r] = await db
    .select({ dr: sql<number>`coalesce(sum(${jl.debit}), 0)`, cr: sql<number>`coalesce(sum(${jl.credit}), 0)` })
    .from(jl)
    .innerJoin(je, eq(jl.entryId, je.id))
    .where(and(eq(jl.orgId, orgId), eq(jl.accountId, bankId), lte(je.date, asOf)));
  return Number(r?.dr ?? 0) - Number(r?.cr ?? 0);
}

/**
 * Release matches whose ledger entry has since been reversed (deleted payment, voided bill…), then auto-match
 * every unmatched statement line to an unmatched ledger bank movement. Returns the number of new matches.
 */
export async function autoMatchOrg(orgId: number) {
  const bankId = await bankAccountId(orgId);
  if (!bankId) return 0;
  const items = await ledgerBankItems(orgId, bankId);
  const live = new Set(items.map((i) => i.entryId));
  const lines = await db.select().from(schema.bankStatementLines).where(eq(schema.bankStatementLines.orgId, orgId));
  const stale = lines.filter((l) => l.status === "matched" && (!l.journalEntryId || !live.has(l.journalEntryId))).map((l) => l.id);
  if (stale.length) {
    await db.update(schema.bankStatementLines).set({ status: "unmatched", journalEntryId: null }).where(inArray(schema.bankStatementLines.id, stale));
  }
  const staleSet = new Set(stale);
  const taken = new Set(lines.filter((l) => l.status === "matched" && !staleSet.has(l.id) && l.journalEntryId).map((l) => l.journalEntryId!));
  const pairs = autoMatch(
    lines.filter((l) => l.status === "unmatched" || staleSet.has(l.id)).map((l) => ({ id: l.id, date: l.date, amount: l.amount })),
    items.filter((i) => !taken.has(i.entryId)),
  );
  for (const p of pairs) {
    await db
      .update(schema.bankStatementLines)
      .set({ status: "matched", journalEntryId: p.entryId })
      .where(and(eq(schema.bankStatementLines.id, p.lineId), eq(schema.bankStatementLines.orgId, orgId)));
  }
  return pairs.length;
}
