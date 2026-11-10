/** Pure CSV parsing/validation for the bulk employee import (no DB access). */
import { z } from "zod";
import { EMPLOYMENT_TYPES } from "@/db/schema";
import { NATIONALITIES, type CountryPack } from "./countries";
import { CSV_MAX_BYTES, parseCsv } from "./csv";
import { UAE_COMPONENT_KEYS, isValidYmd, packageFromComponents, parseEmployeeFields, type EmployeeFieldKey } from "./hrm";
import { toMinor } from "./money";

export const EMPLOYEE_IMPORT_MAX_ROWS = 1000;

type FieldDefs = CountryPack["hr"]["employeeFields"];
export type EmployeeImportRow = {
  code?: string;
  name: string;
  email?: string;
  phone?: string;
  designation?: string;
  department?: string;
  manager?: string;
  joinDate?: string;
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  gender?: "male" | "female" | "other" | "undisclosed";
  dob?: string;
  workLocation?: string;
  probationEndDate?: string;
  /** Annual CTC (IN) / annual package (AE), minor units. */
  annualCtc?: number;
  /** UAE monthly components, minor units (only when at least one component column has a value). */
  components?: Record<(typeof UAE_COMPONENT_KEYS)[number], number>;
  pfEnrolled?: boolean;
  metro?: boolean;
  fields: Partial<Record<EmployeeFieldKey, string>>;
};
export type EmployeeRowError = { row: number; message: string };
export type ParsedEmployees = { rows: { row: number; data: EmployeeImportRow }[]; errors: EmployeeRowError[]; fatal?: string };

const BASE_FIELDS: Record<string, string[]> = {
  code: ["employee_code", "emp_code", "emp_id", "employee_id"],
  name: ["full_name", "employee", "employee_name"],
  email: ["work_email", "email_address"],
  phone: ["mobile", "phone_number"],
  designation: ["job_title", "title", "role"],
  department: ["dept"],
  manager: ["reporting_manager", "manager_code", "manager_email", "reports_to"],
  join_date: ["joining_date", "date_of_joining", "doj"],
  employment_type: ["type"],
  gender: [],
  dob: ["date_of_birth", "birth_date"],
  work_location: ["location"],
  probation_end_date: ["probation_end"],
  annual_ctc: ["annual_package", "ctc", "package"],
  pf_enrolled: ["pf"],
  metro: [],
  basic: ["comp_basic", "monthly_basic"],
  housing: ["comp_housing", "monthly_housing"],
  transport: ["comp_transport", "monthly_transport"],
  other: ["comp_other", "monthly_other"],
};
const REQUIRED = ["name", "designation", "join_date"];
// Exported "status" / "exit_date" columns are simply not mapped, so an export re-imports cleanly.
const FIELD_ALIASES: Record<string, string[]> = { labourCardNumber: ["labour_card", "work_permit_no"], bankAccount: ["account_number", "bank_account_no"] };

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const ymd = z.preprocess(blank, z.string().trim().refine(isValidYmd, "Enter a valid date (YYYY-MM-DD).").optional());
const lc = (v: unknown) => (typeof v === "string" ? blank(v.trim().toLowerCase()) : v);
const flag = z.preprocess(lc, z.enum(["true", "false", "yes", "no", "1", "0", "y", "n"]).transform((v) => ["true", "yes", "1", "y"].includes(v)).optional());
const money = z.preprocess(
  blank,
  z
    .string()
    .refine((v) => {
      const n = toMinor(v);
      return Number.isFinite(n) && n >= 0 && n <= 1e13;
    }, "Enter a valid non-negative amount.")
    .transform((v) => toMinor(v))
    .optional(),
);

const RowSchema = z.object({
  code: z.preprocess(blank, z.string().trim().regex(/^[A-Za-z0-9._-]{1,30}$/, "Employee code may use letters, digits, . _ - (max 30).").optional()),
  name: z.string().trim().min(2, "Enter the employee's name.").max(120),
  email: z.preprocess((v) => (typeof v === "string" ? blank(v.trim().toLowerCase()) : v), z.email("Enter a valid email.").max(200).optional()),
  phone: opt(30),
  designation: z.preprocess(blank, z.string().trim().min(2, "Enter a designation.").max(120).optional()),
  department: opt(120),
  manager: opt(200),
  join_date: ymd,
  employment_type: z.preprocess((v) => (typeof v === "string" ? blank(v.trim().toLowerCase().replace(/[\s-]+/g, "_")) : v), z.enum(EMPLOYMENT_TYPES).optional()),
  gender: z.preprocess((v) => {
    const s = lc(v);
    return s === "m" ? "male" : s === "f" ? "female" : s;
  }, z.enum(["male", "female", "other", "undisclosed"]).optional()),
  dob: ymd,
  work_location: opt(120),
  probation_end_date: ymd,
  annual_ctc: money,
  pf_enrolled: flag,
  metro: flag,
  basic: money,
  housing: money,
  transport: money,
  other: money,
});

/** CSV columns for the template/expected-columns list, following the workspace country pack. */
export function employeeColumns(pack: CountryPack) {
  const ae = pack.code === "AE";
  const base = ["code", "name", "email", "phone", "department", "manager", "designation", "employment_type", "join_date", "gender", "dob", "work_location", ae ? "annual_package" : "annual_ctc"];
  const extra = pack.hr.employeeFields.map((f) => snake(f.key));
  return [...base, ...(ae ? [] : ["pf_enrolled", "metro"]), ...extra];
}

export function employeeTemplate(pack: CountryPack) {
  const ae = pack.code === "AE";
  const sample: Record<string, string> = {
    code: "",
    name: "Asha Verma",
    email: "asha@example.com",
    phone: ae ? "+971 50 123 4567" : "+91 98765 43210",
    department: "Operations",
    manager: "",
    designation: "Operations Executive",
    employment_type: "full_time",
    join_date: "2026-04-01",
    gender: "female",
    dob: "1994-08-15",
    work_location: ae ? "Dubai" : "Bengaluru",
    annual_ctc: "600000",
    annual_package: "120000",
    pf_enrolled: "yes",
    metro: "yes",
  };
  for (const f of pack.hr.employeeFields) {
    const k = snake(f.key);
    if (f.placeholder && f.type !== "country") sample[k] = f.sensitive ? "" : f.placeholder;
    if (f.type === "date") sample[k] = "";
    if (f.type === "country") sample[k] = "IN";
  }
  const cols = employeeColumns(pack);
  return `${cols.join(",")}\n${cols.map((c) => csvCell(sample[c] ?? "")).join(",")}\n`;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function parseEmployees(text: string, pack: CountryPack): ParsedEmployees {
  const empty = { rows: [], errors: [] };
  if (new TextEncoder().encode(text).length > CSV_MAX_BYTES) return { ...empty, fatal: `File is larger than ${CSV_MAX_BYTES / 1024 / 1024} MiB.` };
  const { headers, rows } = parseCsv(text);
  if (!headers.length) return { ...empty, fatal: "The file is empty." };

  const defs: FieldDefs = pack.hr.employeeFields;
  // header → canonical base field or pack field key
  const map = new Map<string, { kind: "base" | "pack"; key: string }>();
  for (const [field, aliases] of Object.entries(BASE_FIELDS)) {
    const hit = headers.find((h) => h === field || aliases.includes(h));
    if (hit) map.set(hit, { kind: "base", key: field });
  }
  for (const f of defs) {
    const names = [snake(f.key), f.key.toLowerCase(), ...(FIELD_ALIASES[f.key] ?? [])];
    const hit = headers.find((h) => names.includes(h) && !map.has(h));
    if (hit) map.set(hit, { kind: "pack", key: f.key });
  }
  const missing = REQUIRED.filter((r) => ![...map.values()].some((m) => m.kind === "base" && m.key === r));
  if (missing.length) return { ...empty, fatal: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` };
  if (!rows.length) return { ...empty, fatal: "The file has a header row but no data rows." };
  if (rows.length > EMPLOYEE_IMPORT_MAX_ROWS) return { ...empty, fatal: `Too many rows (${rows.length}). The limit is ${EMPLOYEE_IMPORT_MAX_ROWS} per import.` };

  const out: ParsedEmployees = { rows: [], errors: [] };
  const seenEmail = new Map<string, number>();
  const seenCode = new Map<string, number>();
  const ae = pack.code === "AE";

  rows.forEach((raw, i) => {
    const row = i + 2; // header is line 1
    const base: Record<string, string> = {};
    const packRaw: Record<string, string | undefined> = {};
    for (const [h, m] of map) {
      const v = raw[h] ?? "";
      if (m.kind === "base") base[m.key] = v;
      else packRaw[m.key] = v;
    }
    const messages: string[] = [];
    const r = RowSchema.safeParse(base);
    if (!r.success) messages.push(...r.error.issues.map((x) => `${x.path.join(".") || "row"}: ${x.message}`));

    // AE nationality may be given as a name ("India") as well as a code ("IN").
    if (packRaw.nationality) {
      const v = packRaw.nationality.trim();
      const hit = NATIONALITIES.find((n) => n.code.toLowerCase() === v.toLowerCase() || n.name.toLowerCase() === v.toLowerCase());
      if (hit) packRaw.nationality = hit.code;
    }
    const pf = parseEmployeeFields(defs, packRaw);
    for (const [k, errs] of Object.entries(pf.errors)) messages.push(`${snake(k)}: ${errs[0]}`);
    if (messages.length || !r.success) return void out.errors.push({ row, message: messages.join("; ") });

    const d = r.data;
    const fields: EmployeeImportRow["fields"] = {};
    for (const [k, v] of Object.entries(pf.values)) if (v) fields[k as EmployeeFieldKey] = v;
    if (d.probation_end_date && d.join_date && d.probation_end_date < d.join_date) {
      return void out.errors.push({ row, message: "probation_end_date: Probation can't end before the join date." });
    }

    const data: EmployeeImportRow = {
      code: d.code,
      name: d.name,
      email: d.email,
      phone: d.phone,
      designation: d.designation,
      department: d.department,
      manager: d.manager,
      joinDate: d.join_date,
      employmentType: d.employment_type,
      gender: d.gender,
      dob: d.dob,
      workLocation: d.work_location,
      probationEndDate: d.probation_end_date,
      annualCtc: d.annual_ctc,
      fields,
    };
    if (ae) {
      const parts = { basic: d.basic, housing: d.housing, transport: d.transport, other: d.other };
      if (Object.values(parts).some((v) => v !== undefined)) {
        const comps = { basic: parts.basic ?? 0, housing: parts.housing ?? 0, transport: parts.transport ?? 0, other: parts.other ?? 0 };
        data.components = comps;
        data.annualCtc = packageFromComponents(comps).annual;
      }
    } else {
      data.pfEnrolled = d.pf_enrolled;
      data.metro = d.metro;
    }

    const codeKey = d.code?.toLowerCase();
    if (codeKey) {
      const first = seenCode.get(codeKey);
      if (first !== undefined) return void out.errors.push({ row, message: `Duplicate employee code of row ${first} in this file.` });
    }
    if (d.email) {
      const first = seenEmail.get(d.email);
      if (first !== undefined) return void out.errors.push({ row, message: `Duplicate of row ${first} in this file (same email).` });
    }
    if (codeKey) seenCode.set(codeKey, row);
    if (d.email) seenEmail.set(d.email, row);
    out.rows.push({ row, data });
  });
  return out;
}

/** New employees need the fields the create form requires; update rows may omit them. */
export function missingForNew(d: EmployeeImportRow) {
  const m: string[] = [];
  if (!d.designation) m.push("designation");
  if (!d.joinDate) m.push("join_date");
  return m;
}

export type EmployeeImportSummary = {
  ok: boolean;
  message?: string;
  created: number;
  updated: number;
  skipped: number;
  errors: EmployeeRowError[];
  /** Present when "invite to portal" was requested. */
  invites?: { emailed: number; linkOnly: number; failed: number; stopped?: string; links: { email: string; url: string }[] };
};
