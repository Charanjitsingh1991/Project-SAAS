import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReturnDoc, TaxReturnInput } from "@/lib/tax-return";

type LineRow = { parent: number; taxCode: string | null; taxRate: number; amount: number; taxAmount: number };

function group(rows: LineRow[]) {
  const m = new Map<number, ReturnDoc["lines"]>();
  for (const r of rows) {
    const list = m.get(r.parent) ?? [];
    list.push({ taxCode: r.taxCode, taxRate: r.taxRate, amount: r.amount, taxAmount: r.taxAmount });
    m.set(r.parent, list);
  }
  return m;
}

/** Sent/partial/paid invoices issued in the period, credit notes dated in the period, and expenses/bills dated in the period. */
export async function loadTaxReturnInput(orgId: number, orgRegion: string | null, from: string, to: string) {
  const [invs, notes, expenses] = await Promise.all([
    db
      .select({ id: schema.invoices.id, placeOfSupply: schema.invoices.placeOfSupply })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orgId, orgId), inArray(schema.invoices.status, ["sent", "partial", "paid"]), gte(schema.invoices.issueDate, from), lte(schema.invoices.issueDate, to))),
    db
      .select({ id: schema.creditNotes.id, placeOfSupply: schema.invoices.placeOfSupply })
      .from(schema.creditNotes)
      .innerJoin(schema.invoices, eq(schema.creditNotes.invoiceId, schema.invoices.id))
      .where(and(eq(schema.creditNotes.orgId, orgId), gte(schema.creditNotes.date, from), lte(schema.creditNotes.date, to))),
    db
      .select({ amount: schema.expenses.amount, taxAmount: schema.expenses.taxAmount })
      .from(schema.expenses)
      .where(and(eq(schema.expenses.orgId, orgId), gte(schema.expenses.date, from), lte(schema.expenses.date, to))),
  ]);
  const [invLines, noteLines] = await Promise.all([
    invs.length
      ? db
          .select({ parent: schema.invoiceLines.invoiceId, taxCode: schema.invoiceLines.taxCode, taxRate: schema.invoiceLines.taxRate, amount: schema.invoiceLines.amount, taxAmount: schema.invoiceLines.taxAmount })
          .from(schema.invoiceLines)
          .where(inArray(schema.invoiceLines.invoiceId, invs.map((i) => i.id)))
      : Promise.resolve([]),
    notes.length
      ? db
          .select({ parent: schema.creditNoteLines.creditNoteId, taxCode: schema.creditNoteLines.taxCode, taxRate: schema.creditNoteLines.taxRate, amount: schema.creditNoteLines.amount, taxAmount: schema.creditNoteLines.taxAmount })
          .from(schema.creditNoteLines)
          .where(inArray(schema.creditNoteLines.creditNoteId, notes.map((n) => n.id)))
      : Promise.resolve([]),
  ]);
  const il = group(invLines);
  const nl = group(noteLines);
  const input: TaxReturnInput = {
    orgRegion,
    invoices: invs.map((i) => ({ placeOfSupply: i.placeOfSupply, lines: il.get(i.id) ?? [] })),
    creditNotes: notes.map((n) => ({ placeOfSupply: n.placeOfSupply, lines: nl.get(n.id) ?? [] })),
    expenses,
  };
  return { input, counts: { invoices: invs.length, creditNotes: notes.length, expenses: expenses.length } };
}
