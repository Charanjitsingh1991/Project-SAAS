"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import { asDuplicateMode, parseCompanies, readCsvInput, type ImportSummary } from "@/lib/imports";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { taxIdError } from "../../_components/tax-id";

const fail = (message: string): ImportSummary => ({ ok: false, message, created: 0, updated: 0, skipped: 0, errors: [] });

export async function importCompanies(_: ImportSummary | undefined, fd: FormData): Promise<ImportSummary> {
  const ws = await requireWorkspace({ module: "crm" });
  const orgId = ws.org.id;
  const pack = packFor(ws);
  const mode = asDuplicateMode(fd.get("onDuplicate"));

  const input = await readCsvInput(fd);
  if ("error" in input) return fail(input.error);
  const parsed = parseCompanies(input.text, { validateTaxId: (id, country) => taxIdError(pack, id, country) });
  if (parsed.fatal) return fail(parsed.fatal);

  const existing = await db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.orgId, orgId));
  const byName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c.id]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [...parsed.errors];
  const inserts: (typeof schema.companies.$inferInsert)[] = [];

  for (const { row, data } of parsed.rows) {
    const id = byName.get(data.name.toLowerCase());
    if (id === undefined) {
      inserts.push({
        orgId,
        name: data.name,
        industry: data.industry ?? null,
        website: data.website ?? null,
        phone: data.phone ?? null,
        gstin: data.gstin ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        country: data.country ?? pack.name,
        ownerId: ws.user.id,
      });
    } else if (mode === "skip") {
      skipped++;
    } else {
      const rest = { ...data, name: undefined };
      const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      try {
        if (Object.keys(set).length) await db.update(schema.companies).set(set).where(and(eq(schema.companies.id, id), eq(schema.companies.orgId, orgId)));
        updated++;
      } catch {
        errors.push({ row, message: "Could not update this company." });
      }
    }
  }
  for (let i = 0; i < inserts.length; i += 100) {
    const chunk = inserts.slice(i, i + 100);
    await db.insert(schema.companies).values(chunk);
    created += chunk.length;
  }

  errors.sort((a, b) => a.row - b.row);
  if (created + updated) {
    await logActivity(ctxOf(ws), { module: "crm", entityType: "company", action: "imported", summary: `Imported companies from CSV: ${created} created, ${updated} updated, ${skipped} skipped, ${errors.length} rejected` });
    refresh();
  }
  return { ok: true, message: "Import finished.", created, updated, skipped: skipped + errors.length, errors };
}
