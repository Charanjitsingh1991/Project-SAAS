import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { statutoryOf } from "@/lib/countries";
import { parseBreakdown } from "@/lib/payroll-types";
import { canUseModule, getWorkspace, type ActiveWorkspace } from "@/lib/tenancy";
import { buildSif, validateSif } from "@/lib/wps";

const VARIABLE = new Set(["bonus", "other_earnings", "reimbursement"]);

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const ws = await getWorkspace();
  if (!ws?.org || !ws.role || !ws.access || ws.access.state === "locked") return new Response("Unauthorized", { status: 401 });
  if (!canUseModule(ws as ActiveWorkspace, "payroll")) return new Response("Forbidden", { status: 403 });
  if (ws.org.country !== "AE") return new Response("WPS files are only available for UAE workspaces.", { status: 400 });

  const runId = Number((await ctx.params).runId);
  const [run] = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.orgId, ws.org.id)))
    .limit(1);
  if (!run) return new Response("Not found", { status: 404 });
  if (run.status === "draft") return new Response("Approve the run before generating the WPS file.", { status: 400 });

  const rows = await db
    .select({ p: schema.payslips, e: schema.employees })
    .from(schema.payslips)
    .innerJoin(schema.employees, eq(schema.payslips.employeeId, schema.employees.id))
    .where(and(eq(schema.payslips.runId, run.id), eq(schema.payslips.orgId, ws.org.id)))
    .orderBy(schema.payslips.employeeCode);

  const st = statutoryOf(ws.org);
  const input = {
    employerId: st.mohreEstablishmentId ?? null,
    employerRouting: st.wpsRoutingCode ?? null,
    period: run.period,
    // SIF timestamps are UAE local time (UTC+4, no DST).
    createdAt: new Date(Date.now() + 4 * 3_600_000),
    reference: `${ws.org.name} ${run.period}`,
    employees: rows
      .filter(({ p }) => p.net > 0)
      .map(({ p, e }) => ({
        name: p.employeeName,
        personId: e.wpsPersonId,
        routingCode: e.bankRoutingCode,
        iban: e.iban?.replace(/\s/g, "").toUpperCase() ?? null,
        net: p.net,
        variable: (parseBreakdown(p.breakdown)?.earnings ?? []).filter((l) => VARIABLE.has(l.code)).reduce((s, l) => s + l.amount, 0),
        leaveDays: Math.ceil(p.lopDays),
      })),
  };
  const errors = validateSif(input);
  if (errors.length) {
    return new Response(`Fix these before generating the WPS file:\n\n${errors.join("\n")}`, {
      status: 422,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { content, fileName } = buildSif(input);
  return new Response(content, { headers: { "content-type": "text/plain; charset=us-ascii", "content-disposition": `attachment; filename="${fileName}"` } });
}
