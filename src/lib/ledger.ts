import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { accountsForCountry } from "./accounting";
import type { Ctx } from "./activity";

async function countryOfOrg(orgId: number) {
  const [o] = await db.select({ country: schema.organizations.country }).from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  return o?.country ?? "IN";
}

/** Create the country's default chart of accounts for a workspace (idempotent; adds missing accounts only). */
export async function ensureChartOfAccounts(orgId: number) {
  const defs = accountsForCountry(await countryOfOrg(orgId));
  await db
    .insert(schema.accounts)
    .values(defs.map((a) => ({ orgId, code: a.code, name: a.name, type: a.type, systemKey: a.key })))
    .onConflictDoNothing();
}

/** Map of system key → account id for a workspace. Creates the chart if missing. */
export async function accountIds(orgId: number) {
  let rows = await db
    .select({ id: schema.accounts.id, key: schema.accounts.systemKey })
    .from(schema.accounts)
    .where(eq(schema.accounts.orgId, orgId));
  const have = new Set(rows.map((r) => r.key));
  if (accountsForCountry(await countryOfOrg(orgId)).some((a) => !have.has(a.key))) {
    await ensureChartOfAccounts(orgId);
    rows = await db
      .select({ id: schema.accounts.id, key: schema.accounts.systemKey })
      .from(schema.accounts)
      .where(eq(schema.accounts.orgId, orgId));
  }
  return new Map(rows.filter((r) => r.key).map((r) => [r.key as string, r.id]));
}

export type JournalLineInput = { key?: string; accountId?: number; debit?: number; credit?: number };

/**
 * Post a balanced journal entry. Lines reference accounts by system key or id.
 * Zero lines are dropped. Throws if debits ≠ credits.
 */
export async function postJournal(
  ctx: Ctx,
  entry: { date: string; memo: string; sourceType: (typeof schema.SOURCE_TYPES)[number]; sourceId?: number | null; lines: JournalLineInput[] },
) {
  const ids = await accountIds(ctx.orgId);
  const lines = entry.lines
    .map((l) => ({
      accountId: l.accountId ?? (l.key ? ids.get(l.key) : undefined),
      debit: Math.round(l.debit ?? 0),
      credit: Math.round(l.credit ?? 0),
      key: l.key,
    }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);

  for (const l of lines) {
    if (!l.accountId) throw new Error(`Unknown account ${l.key}`);
    if (l.debit < 0 || l.credit < 0) throw new Error("Journal amounts must be positive");
  }
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  if (dr !== cr) throw new Error(`Unbalanced journal: debit ${dr} ≠ credit ${cr} (${entry.memo})`);
  if (dr === 0) return null;

  const [je] = await db
    .insert(schema.journalEntries)
    .values({ orgId: ctx.orgId, date: entry.date, memo: entry.memo, sourceType: entry.sourceType, sourceId: entry.sourceId ?? null, createdBy: ctx.userId })
    .returning({ id: schema.journalEntries.id });
  await db
    .insert(schema.journalLines)
    .values(lines.map((l) => ({ orgId: ctx.orgId, entryId: je.id, accountId: l.accountId!, debit: l.debit, credit: l.credit })));
  return je.id;
}

/** Reverse every (not yet reversed) entry for a source with mirror-image entries dated `date`. */
export async function reverseJournal(ctx: Ctx, sourceType: (typeof schema.SOURCE_TYPES)[number], sourceId: number, date: string, memo: string) {
  const entries = await db
    .select()
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.orgId, ctx.orgId),
        eq(schema.journalEntries.sourceType, sourceType),
        eq(schema.journalEntries.sourceId, sourceId),
        eq(schema.journalEntries.reversed, false),
      ),
    );
  if (!entries.length) return;
  const lines = await db
    .select()
    .from(schema.journalLines)
    .where(inArray(schema.journalLines.entryId, entries.map((e) => e.id)));

  await postJournal(ctx, {
    date,
    memo,
    sourceType: "reversal",
    sourceId,
    lines: lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
  });
  await db
    .update(schema.journalEntries)
    .set({ reversed: true })
    .where(inArray(schema.journalEntries.id, entries.map((e) => e.id)));
}
