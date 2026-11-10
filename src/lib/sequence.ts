import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

type SequenceKey = "invoice" | "po" | "ticket" | "employee" | "project" | "letter";

const FORMAT: Record<SequenceKey, { prefix: string; start: number; pad: number }> = {
  letter: { prefix: "LTR-", start: 1, pad: 4 },
  invoice: { prefix: "INV-", start: 1001, pad: 0 },
  po: { prefix: "PO-", start: 1, pad: 4 },
  ticket: { prefix: "TCK-", start: 1001, pad: 0 },
  employee: { prefix: "EMP-", start: 1, pad: 4 },
  project: { prefix: "PRJ-", start: 1, pad: 3 },
};

/** Atomically reserve the next document number for a workspace, e.g. "INV-1007". */
export async function nextNumber(orgId: number, key: SequenceKey) {
  const f = FORMAT[key];
  const [row] = await db
    .insert(schema.sequences)
    .values({ orgId, key, next: f.start + 1 })
    .onConflictDoUpdate({ target: [schema.sequences.orgId, schema.sequences.key], set: { next: sql`${schema.sequences.next} + 1` } })
    .returning({ next: schema.sequences.next });
  const n = row.next - 1;
  return `${f.prefix}${f.pad ? String(n).padStart(f.pad, "0") : n}`;
}

/** Peek without reserving (for form placeholders). */
export async function peekNumber(orgId: number, key: SequenceKey) {
  const f = FORMAT[key];
  const [row] = await db
    .select({ next: schema.sequences.next })
    .from(schema.sequences)
    .where(and(eq(schema.sequences.orgId, orgId), eq(schema.sequences.key, key)))
    .limit(1);
  const n = row?.next ?? f.start;
  return `${f.prefix}${f.pad ? String(n).padStart(f.pad, "0") : n}`;
}
