"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import { asDuplicateMode, parseContacts, readCsvInput, type ImportSummary } from "@/lib/imports";
import { packFor, requireWorkspace } from "@/lib/tenancy";

const fail = (message: string): ImportSummary => ({ ok: false, message, created: 0, updated: 0, skipped: 0, errors: [] });

export async function importContacts(_: ImportSummary | undefined, fd: FormData): Promise<ImportSummary> {
  const ws = await requireWorkspace({ module: "crm" });
  const orgId = ws.org.id;
  const mode = asDuplicateMode(fd.get("onDuplicate"));
  const createCompanies = fd.get("createCompanies") === "on";

  const input = await readCsvInput(fd);
  if ("error" in input) return fail(input.error);
  const parsed = parseContacts(input.text);
  if (parsed.fatal) return fail(parsed.fatal);

  const [companies, contacts] = await Promise.all([
    db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.orgId, orgId)),
    db.select({ id: schema.contacts.id, email: schema.contacts.email }).from(schema.contacts).where(eq(schema.contacts.orgId, orgId)),
  ]);
  const companyId = new Map(companies.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email!.trim().toLowerCase(), c.id]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let companiesCreated = 0;
  const errors = [...parsed.errors];
  const inserts: (typeof schema.contacts.$inferInsert)[] = [];

  for (const { row, data } of parsed.rows) {
    const existingId = data.email ? byEmail.get(data.email) : undefined;
    if (existingId !== undefined && mode === "skip") {
      skipped++;
      continue;
    }

    let cid: number | undefined;
    if (data.company) {
      cid = companyId.get(data.company.toLowerCase());
      if (cid === undefined) {
        if (!createCompanies) {
          errors.push({ row, message: `Company "${data.company}" not found (tick "create missing companies" to add it).` });
          continue;
        }
        const [c] = await db
          .insert(schema.companies)
          .values({ orgId, name: data.company, country: packFor(ws).name, ownerId: ws.user.id })
          .returning({ id: schema.companies.id });
        cid = c.id;
        companyId.set(data.company.toLowerCase(), cid);
        companiesCreated++;
      }
    }

    if (existingId === undefined) {
      inserts.push({
        orgId,
        companyId: cid ?? null,
        name: data.name,
        title: data.title ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        ownerId: ws.user.id,
        ...(data.lifecycle && { lifecycle: data.lifecycle }),
        ...(data.source && { source: data.source }),
      });
    } else {
      const set = Object.fromEntries(Object.entries({ name: data.name, title: data.title, phone: data.phone, companyId: cid, lifecycle: data.lifecycle, source: data.source }).filter(([, v]) => v !== undefined));
      try {
        await db.update(schema.contacts).set(set).where(and(eq(schema.contacts.id, existingId), eq(schema.contacts.orgId, orgId)));
        updated++;
      } catch {
        errors.push({ row, message: "Could not update this contact." });
      }
    }
  }
  for (let i = 0; i < inserts.length; i += 100) {
    const chunk = inserts.slice(i, i + 100);
    await db.insert(schema.contacts).values(chunk);
    created += chunk.length;
  }

  errors.sort((a, b) => a.row - b.row);
  if (created + updated + companiesCreated) {
    await logActivity(ctxOf(ws), {
      module: "crm",
      entityType: "contact",
      action: "imported",
      summary: `Imported contacts from CSV: ${created} created, ${updated} updated, ${skipped} skipped, ${errors.length} rejected${companiesCreated ? `, ${companiesCreated} companies added` : ""}`,
    });
    refresh();
  }
  return {
    ok: true,
    message: `Import finished.${companiesCreated ? ` ${companiesCreated} new compan${companiesCreated > 1 ? "ies" : "y"} created.` : ""}`,
    created,
    updated,
    skipped: skipped + errors.length,
    errors,
  };
}
