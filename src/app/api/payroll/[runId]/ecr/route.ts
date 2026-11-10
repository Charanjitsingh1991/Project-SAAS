import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseBreakdown } from "@/lib/payroll-types";
import { legacyBreakdown } from "@/lib/posting";
import { buildEcr } from "@/lib/statutory-in";
import { canUseModule, getWorkspace, type ActiveWorkspace } from "@/lib/tenancy";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const ws = await getWorkspace();
  if (!ws?.org || !ws.role || !ws.access || ws.access.state === "locked") return new Response("Unauthorized", { status: 401 });
  if (!canUseModule(ws as ActiveWorkspace, "payroll")) return new Response("Forbidden", { status: 403 });
  if (ws.org.country !== "IN") return new Response("The PF ECR file is only available for India workspaces.", { status: 400 });

  const runId = Number((await ctx.params).runId);
  const [run] = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.orgId, ws.org.id)))
    .limit(1);
  if (!run) return new Response("Not found", { status: 404 });
  if (run.status === "draft") return new Response("Approve the run before generating the ECR file.", { status: 400 });

  const rows = await db
    .select({ p: schema.payslips, uan: schema.employees.uan })
    .from(schema.payslips)
    .innerJoin(schema.employees, eq(schema.payslips.employeeId, schema.employees.id))
    .where(and(eq(schema.payslips.runId, run.id), eq(schema.payslips.orgId, ws.org.id)))
    .orderBy(schema.payslips.employeeCode);

  const { content, count } = buildEcr(
    rows.map(({ p, uan }) => ({
      employeeId: p.employeeId,
      code: p.employeeCode,
      name: p.employeeName,
      uan,
      gross: p.gross,
      paidDays: p.paidDays,
      lopDays: p.lopDays,
      breakdown: parseBreakdown(p.breakdown) ?? legacyBreakdown(p),
    })),
  );
  if (count === 0) return new Response("No PF-enrolled employees with a valid 12-digit UAN in this run.", { status: 422, headers: { "content-type": "text/plain; charset=utf-8" } });

  return new Response(content, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="ECR_${run.period}.txt"` } });
}
