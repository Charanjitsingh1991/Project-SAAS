"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import { parseBankStatement } from "@/lib/bank-rec";
import { CSV_MAX_BYTES, CSV_MAX_ROWS } from "@/lib/csv";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { fromMinor } from "@/lib/money";
import { requireWorkspace } from "@/lib/tenancy";
import { autoMatchOrg, bankAccountId, ledgerBankItems } from "./data";

const guard = () => requireWorkspace({ module: "finance", feature: "bankReconciliation" });

/** Import a statement CSV, skip lines already imported, then auto-match. */
export async function importStatementAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { errors: { file: ["Choose a CSV file."] }, message: "Choose a CSV file." };
  if (file.size > CSV_MAX_BYTES) return { errors: { file: ["The file is larger than 2 MB."] }, message: "The file is larger than 2 MB." };
  const parsed = parseBankStatement(await file.text());
  if (!parsed.lines.length) return { message: parsed.errors[0] ?? "No transactions found in the file." };
  if (parsed.lines.length > CSV_MAX_ROWS) return { message: `Import at most ${CSV_MAX_ROWS} rows at a time.` };

  const existing = await db
    .select({ date: schema.bankStatementLines.date, amount: schema.bankStatementLines.amount, description: schema.bankStatementLines.description, reference: schema.bankStatementLines.reference })
    .from(schema.bankStatementLines)
    .where(eq(schema.bankStatementLines.orgId, ws.org.id));
  const sig = (l: { date: string; amount: number; description: string; reference: string | null }) => `${l.date}|${l.amount}|${l.description}|${l.reference ?? ""}`;
  const seen = new Set(existing.map(sig));
  const batch = `import-${Date.now()}`;
  const fresh = parsed.lines.filter((l) => {
    const k = sig(l);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (fresh.length) {
    await db.insert(schema.bankStatementLines).values(
      fresh.map((l) => ({ orgId: ws.org.id, date: l.date, description: l.description, reference: l.reference, amount: l.amount, importBatch: batch })),
    );
  }
  const matched = await autoMatchOrg(ws.org.id);
  await logActivity(ctxOf(ws), { module: "finance", entityType: "bank_statement", action: "imported", summary: `Imported ${fresh.length} bank statement lines (${matched} auto-matched)` });

  const params = new URLSearchParams({ imported: String(fresh.length), skipped: String(parsed.lines.length - fresh.length), matched: String(matched), errors: String(parsed.errors.length) });
  if (parsed.closingBalance !== null) {
    params.set("closing", String(fromMinor(parsed.closingBalance)));
    params.set("asOf", parsed.lines.reduce((m, l) => (l.date > m ? l.date : m), parsed.lines[0].date));
  }
  redirect(`/app/finance/bank?${params}`);
}

export async function autoMatchAction(): Promise<FormState> {
  const ws = await guard();
  const n = await autoMatchOrg(ws.org.id);
  refresh();
  return { ok: true, message: n ? `Matched ${n} line${n === 1 ? "" : "s"}.` : "No new matches found." };
}

const LineSchema = z.object({ lineId: z.coerce.number().int().positive() });

async function lineOf(orgId: number, fd: FormData) {
  const p = LineSchema.safeParse(formObject(fd));
  if (!p.success) return null;
  const [l] = await db
    .select()
    .from(schema.bankStatementLines)
    .where(and(eq(schema.bankStatementLines.id, p.data.lineId), eq(schema.bankStatementLines.orgId, orgId)))
    .limit(1);
  return l ?? null;
}

/** Manually match a statement line to a ledger entry that moves the bank account. */
export async function matchLineAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const line = await lineOf(ws.org.id, fd);
  if (!line) return { message: "Statement line not found." };
  const entryId = Number(fd.get("entryId"));
  if (!Number.isInteger(entryId) || entryId <= 0) return { message: "Choose a ledger entry." };
  const bankId = await bankAccountId(ws.org.id);
  const items = bankId ? await ledgerBankItems(ws.org.id, bankId) : [];
  if (!items.some((i) => i.entryId === entryId)) return { message: "That entry doesn't move the bank account." };
  const [taken] = await db
    .select({ id: schema.bankStatementLines.id })
    .from(schema.bankStatementLines)
    .where(and(eq(schema.bankStatementLines.orgId, ws.org.id), eq(schema.bankStatementLines.journalEntryId, entryId), eq(schema.bankStatementLines.status, "matched")))
    .limit(1);
  if (taken && taken.id !== line.id) return { message: "That entry is already matched to another statement line." };
  await db.update(schema.bankStatementLines).set({ status: "matched", journalEntryId: entryId }).where(eq(schema.bankStatementLines.id, line.id));
  refresh();
  return { ok: true, message: "Matched." };
}

export async function unmatchLineAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const line = await lineOf(ws.org.id, fd);
  if (!line) return { message: "Statement line not found." };
  await db.update(schema.bankStatementLines).set({ status: "unmatched", journalEntryId: null }).where(eq(schema.bankStatementLines.id, line.id));
  refresh();
  return { ok: true, message: "Unmatched." };
}

/** Mark a line as not needing a ledger match (e.g. a transfer between own accounts recorded elsewhere). */
export async function ignoreLineAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const line = await lineOf(ws.org.id, fd);
  if (!line) return { message: "Statement line not found." };
  await db.update(schema.bankStatementLines).set({ status: "ignored", journalEntryId: null }).where(eq(schema.bankStatementLines.id, line.id));
  refresh();
  return { ok: true, message: "Ignored." };
}

export async function deleteLineAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const line = await lineOf(ws.org.id, fd);
  if (!line) return { message: "Statement line not found." };
  await db.delete(schema.bankStatementLines).where(eq(schema.bankStatementLines.id, line.id));
  refresh();
  return { ok: true, message: "Deleted." };
}
