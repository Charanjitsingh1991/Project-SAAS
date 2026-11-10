import "server-only";
import { db, schema } from "@/db";
import { packFor, type ActiveWorkspace } from "@/lib/tenancy";
import { formatDate, formatMoney } from "@/lib/format";
import { parseSalaryComponents, salaryStructure } from "@/lib/hrm";
import { buildLetter, type LetterKindKey, type SalaryLine } from "@/lib/letters";
import { and, eq } from "drizzle-orm";

type Employee = typeof schema.employees.$inferSelect;

function salaryLines(emp: Employee, countryCode: string, currency: string): SalaryLine[] {
  const m = (n: number) => formatMoney(n, currency);
  const line = (label: string, monthly: number): SalaryLine => ({ label, monthly: m(monthly), annual: m(monthly * 12) });
  if (countryCode === "AE") {
    const c = parseSalaryComponents(emp.salaryComponents);
    if (!c) return [];
    const labels = { basic: "Basic salary", housing: "Housing allowance", transport: "Transport allowance", other: "Other allowances" } as const;
    return (Object.keys(labels) as (keyof typeof labels)[]).filter((k) => c[k]).map((k) => line(labels[k], c[k] ?? 0));
  }
  if (!emp.annualCtc) return [];
  const s = salaryStructure(emp.annualCtc, emp.metro).monthly;
  return [line("Basic", s.basic), line("House rent allowance", s.hra), line("Special allowance", s.special)];
}

/** Default subject/body for a letter, from the employee's current record. */
export async function draftLetter(ws: ActiveWorkspace, emp: Employee, kind: LetterKindKey, issuedOn: string) {
  let department: string | null = null;
  if (emp.departmentId) {
    const [d] = await db
      .select({ name: schema.departments.name })
      .from(schema.departments)
      .where(and(eq(schema.departments.id, emp.departmentId), eq(schema.departments.orgId, ws.org.id)))
      .limit(1);
    department = d?.name ?? null;
  }
  const code = packFor(ws).code;
  const lines = kind === "offer" || kind === "appointment" || kind === "salary_certificate" ? salaryLines(emp, code, ws.org.currency) : [];
  return buildLetter(kind, {
    companyName: ws.org.name,
    employee: {
      name: emp.name,
      code: emp.code,
      designation: emp.designation,
      department,
      workLocation: emp.workLocation,
      joinDate: formatDate(emp.joinDate),
      exitDate: emp.exitDate ? formatDate(emp.exitDate) : null,
      probationEndDate: emp.probationEndDate ? formatDate(emp.probationEndDate) : null,
    },
    issuedOn: formatDate(issuedOn),
    annualPackage: emp.annualCtc ? formatMoney(emp.annualCtc, ws.org.currency) : null,
    salaryLines: lines,
  });
}
