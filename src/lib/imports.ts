/** Pure CSV import parsing/validation for companies, contacts and products (no DB access). */
import { z } from "zod";
import { LEAD_SOURCES, LIFECYCLES, UNITS } from "@/db/schema";
import { CSV_MAX_BYTES, CSV_MAX_ROWS, parseCsv } from "./csv";
import { toMinor } from "./money";

export { CSV_MAX_BYTES, CSV_MAX_ROWS };

export type RowError = { row: number; message: string };
export type ParsedRows<T> = { rows: { row: number; data: T }[]; errors: RowError[]; fatal?: string };
export type OnDuplicate = "skip" | "update";

export type ImportSummary = {
  ok: boolean;
  message?: string;
  created: number;
  updated: number;
  skipped: number;
  errors: RowError[];
};

type FieldDef = { aliases: string[]; required?: boolean };

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_");

/** Maps a CSV header to its canonical field using aliases (headers arrive lower-cased from parseCsv). */
function resolveHeaders(headers: string[], fields: Record<string, FieldDef>) {
  const map = new Map<string, string>();
  for (const [field, def] of Object.entries(fields)) {
    const names = [field, ...def.aliases].map(norm);
    const hit = headers.find((h) => names.includes(h));
    if (hit) map.set(hit, field);
  }
  const missing = Object.entries(fields).filter(([f, d]) => d.required && ![...map.values()].includes(f)).map(([f]) => f);
  return { map, missing };
}

function parseWith<T>(
  text: string,
  fields: Record<string, FieldDef>,
  schema: z.ZodType<T>,
  keyOf: (d: T) => string | null,
  extra?: (d: T) => string | null,
): ParsedRows<T> {
  const empty = { rows: [], errors: [] };
  if (new TextEncoder().encode(text).length > CSV_MAX_BYTES) return { ...empty, fatal: `File is larger than ${CSV_MAX_BYTES / 1024 / 1024} MiB.` };
  const { headers, rows } = parseCsv(text);
  if (!headers.length) return { ...empty, fatal: "The file is empty." };
  const { map, missing } = resolveHeaders(headers, fields);
  if (missing.length) return { ...empty, fatal: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` };
  if (!rows.length) return { ...empty, fatal: "The file has a header row but no data rows." };
  if (rows.length > CSV_MAX_ROWS) return { ...empty, fatal: `Too many rows (${rows.length}). The limit is ${CSV_MAX_ROWS} per import.` };

  const out: ParsedRows<T> = { rows: [], errors: [] };
  const seen = new Map<string, number>();
  rows.forEach((raw, i) => {
    const row = i + 2; // header is line 1
    const obj: Record<string, string> = {};
    for (const [h, f] of map) obj[f] = raw[h] ?? "";
    const r = schema.safeParse(obj);
    if (!r.success) {
      out.errors.push({ row, message: r.error.issues.map((x) => `${x.path.join(".") || "row"}: ${x.message}`).join("; ") });
      return;
    }
    const problem = extra?.(r.data);
    if (problem) return void out.errors.push({ row, message: problem });
    const key = keyOf(r.data);
    if (key) {
      const first = seen.get(key);
      if (first !== undefined) return void out.errors.push({ row, message: `Duplicate of row ${first} in this file.` });
      seen.set(key, row);
    }
    out.rows.push({ row, data: r.data });
  });
  return out;
}

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.preprocess(blankToUndef, z.string().trim().max(max).optional());
const enumField = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (typeof v === "string" ? blankToUndef(v.trim().toLowerCase()) : v), z.enum(values).optional());
const amount = z.preprocess(
  blankToUndef,
  z
    .string()
    .refine((v) => {
      const n = toMinor(v);
      return !Number.isNaN(n) && n >= 0;
    }, "Enter a valid non-negative amount.")
    .transform((v) => toMinor(v))
    .optional(),
);
const number = (max: number) => z.preprocess(blankToUndef, z.string().refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max, `Enter a number between 0 and ${max}.`).transform(Number).optional());
const flag = z.preprocess(
  (v) => (typeof v === "string" ? blankToUndef(v.trim().toLowerCase()) : v),
  z.enum(["true", "false", "yes", "no", "1", "0", "active", "inactive"]).transform((v) => ["true", "yes", "1", "active"].includes(v)).optional(),
);

/* ---------- Companies ---------- */

export const COMPANY_COLUMNS = ["name", "industry", "website", "phone", "gstin", "city", "state", "country"] as const;
const COMPANY_FIELDS: Record<string, FieldDef> = {
  name: { aliases: ["company", "company_name"], required: true },
  industry: { aliases: [] },
  website: { aliases: ["url"] },
  phone: { aliases: ["mobile"] },
  gstin: { aliases: ["trn", "tax_id", "tax_number"] },
  city: { aliases: [] },
  state: { aliases: ["emirate", "region"] },
  country: { aliases: [] },
};

const CompanyRow = z.object({
  name: z.string().trim().min(1, "Name is required.").max(160),
  industry: text(80),
  website: text(200),
  phone: text(30),
  gstin: z.preprocess(blankToUndef, z.string().max(40).transform((v) => v.replace(/[\s-]/g, "").toUpperCase()).optional()),
  city: text(80),
  state: text(80),
  country: text(80),
});
export type CompanyImportRow = z.infer<typeof CompanyRow>;

/** `validateTaxId` is injected so country-specific rules stay out of this pure module. */
export function parseCompanies(csv: string, opts: { validateTaxId?: (id: string, country?: string) => string | null } = {}) {
  return parseWith<CompanyImportRow>(csv, COMPANY_FIELDS, CompanyRow, (d) => d.name.toLowerCase(), (d) => (d.gstin && opts.validateTaxId ? opts.validateTaxId(d.gstin, d.country) : null));
}

/* ---------- Contacts ---------- */

export const CONTACT_COLUMNS = ["name", "title", "email", "phone", "company", "lifecycle", "source"] as const;
const CONTACT_FIELDS: Record<string, FieldDef> = {
  name: { aliases: ["full_name", "contact"], required: true },
  title: { aliases: ["job_title"] },
  email: { aliases: ["email_address"] },
  phone: { aliases: ["mobile"] },
  company: { aliases: ["company_name", "account"] },
  lifecycle: { aliases: ["stage", "status"] },
  source: { aliases: ["lead_source"] },
};

const ContactRow = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  title: text(120),
  email: z.preprocess((v) => (typeof v === "string" ? blankToUndef(v.trim().toLowerCase()) : v), z.email("Enter a valid email.").max(200).optional()),
  phone: text(30),
  company: text(160),
  lifecycle: enumField(LIFECYCLES),
  source: enumField(LEAD_SOURCES),
});
export type ContactImportRow = z.infer<typeof ContactRow>;

export function parseContacts(csv: string) {
  return parseWith<ContactImportRow>(csv, CONTACT_FIELDS, ContactRow, (d) => d.email ?? null);
}

/* ---------- Products ---------- */

export const PRODUCT_COLUMNS = ["sku", "name", "barcode", "category", "unit", "cost_price", "selling_price", "gst_rate", "reorder_level", "active"] as const;
const PRODUCT_FIELDS: Record<string, FieldDef> = {
  sku: { aliases: ["code", "item_code"], required: true },
  name: { aliases: ["product", "product_name"], required: true },
  barcode: { aliases: ["ean", "upc"] },
  category: { aliases: [] },
  unit: { aliases: ["uom"] },
  cost_price: { aliases: ["cost", "purchase_price"] },
  selling_price: { aliases: ["price", "sale_price"] },
  gst_rate: { aliases: ["tax_rate", "vat_rate", "tax"] },
  reorder_level: { aliases: ["reorder"] },
  active: { aliases: [] },
};

const ProductRow = z.object({
  sku: z.string().trim().min(1, "SKU is required.").max(60),
  name: z.string().trim().min(1, "Name is required.").max(160),
  barcode: text(60),
  category: text(80),
  unit: enumField(UNITS),
  cost_price: amount,
  selling_price: amount,
  gst_rate: number(100),
  reorder_level: number(1_000_000),
  active: flag,
});
/** Prices are minor units; blank fields are `undefined` (kept on update, defaulted on create). */
export type ProductImportRow = z.infer<typeof ProductRow>;

/** `allowedRates` are the workspace's valid tax rates; blank rates are always accepted. */
export function parseProducts(csv: string, opts: { allowedRates?: number[]; taxName?: string } = {}) {
  return parseWith<ProductImportRow>(csv, PRODUCT_FIELDS, ProductRow, (d) => d.sku, (d) =>
    d.gst_rate !== undefined && opts.allowedRates && !opts.allowedRates.includes(d.gst_rate)
      ? `gst_rate: ${d.gst_rate} is not a valid ${opts.taxName ?? "tax"} rate (use ${opts.allowedRates.join(", ")}).`
      : null,
  );
}

/** Header line + sample row for the downloadable template. */
export function templateCsv(columns: readonly string[], sample: Record<string, string>) {
  return `${columns.join(",")}\n${columns.map((c) => sample[c] ?? "").join(",")}\n`;
}

/** Reads the CSV from an uploaded `file` field, falling back to a pasted `csv` textarea. */
export async function readCsvInput(fd: FormData): Promise<{ text: string } | { error: string }> {
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > CSV_MAX_BYTES) return { error: `File is larger than ${CSV_MAX_BYTES / 1024 / 1024} MiB.` };
    return { text: await file.text() };
  }
  const pasted = String(fd.get("csv") ?? "");
  if (pasted.trim()) return { text: pasted };
  return { error: "Choose a CSV file or paste CSV text." };
}

export const asDuplicateMode = (v: FormDataEntryValue | null): OnDuplicate => (v === "update" ? "update" : "skip");
