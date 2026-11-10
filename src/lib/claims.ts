import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity, type Ctx } from "./activity";
import { formatMoney } from "./format";
import type { ClaimStatus, ParsedClaim } from "./hrm";

export { CLAIM_TONE, claimCategoryLabel, claimTaxOptions, parseClaim, type ClaimStatus } from "./hrm";

export async function myClaims(orgId: number, employeeId: number, limit = 20) {
  return db
    .select()
    .from(schema.expenseClaims)
    .where(and(eq(schema.expenseClaims.orgId, orgId), eq(schema.expenseClaims.employeeId, employeeId)))
    .orderBy(desc(schema.expenseClaims.createdAt), desc(schema.expenseClaims.id))
    .limit(limit);
}

export async function listClaims(orgId: number, status?: ClaimStatus) {
  return db
    .select({ c: schema.expenseClaims, name: schema.employees.name, code: schema.employees.code, empId: schema.employees.id })
    .from(schema.expenseClaims)
    .innerJoin(schema.employees, eq(schema.expenseClaims.employeeId, schema.employees.id))
    .where(and(eq(schema.expenseClaims.orgId, orgId), status ? eq(schema.expenseClaims.status, status) : undefined))
    .orderBy(desc(schema.expenseClaims.createdAt), desc(schema.expenseClaims.id))
    .limit(300);
}

export async function claimSummary(orgId: number) {
  const rows = await db
    .select({ status: schema.expenseClaims.status, via: schema.expenseClaims.reimburseVia, n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${schema.expenseClaims.total}),0)` })
    .from(schema.expenseClaims)
    .where(eq(schema.expenseClaims.orgId, orgId))
    .groupBy(schema.expenseClaims.status, schema.expenseClaims.reimburseVia);
  const sum = (pred: (r: (typeof rows)[number]) => boolean) =>
    rows.filter(pred).reduce((a, r) => ({ n: a.n + Number(r.n), total: a.total + Number(r.total) }), { n: 0, total: 0 });
  return {
    pending: sum((r) => r.status === "submitted"),
    inPayroll: sum((r) => r.status === "approved" && r.via === "payroll"),
    reimbursed: sum((r) => r.status === "reimbursed"),
    rejected: sum((r) => r.status === "rejected"),
  };
}

export async function submitClaim(
  ctx: Ctx,
  employee: { id: number; name: string },
  claim: ParsedClaim,
  currency: string,
) {
  const [row] = await db
    .insert(schema.expenseClaims)
    .values({ orgId: ctx.orgId, employeeId: employee.id, ...claim, status: "submitted" })
    .returning({ id: schema.expenseClaims.id });
  await logActivity(ctx, {
    module: "hrm",
    entityType: "expense_claim",
    entityId: row.id,
    action: "submitted",
    summary: `${employee.name} claimed ${formatMoney(claim.total, currency)} for “${claim.description}”`,
  });
  return row.id;
}

/** Employees can withdraw their own claim while it's still awaiting review. */
export async function withdrawClaim(ctx: Ctx, claimId: number, employeeId: number) {
  const res = await db
    .delete(schema.expenseClaims)
    .where(
      and(
        eq(schema.expenseClaims.id, claimId),
        eq(schema.expenseClaims.orgId, ctx.orgId),
        eq(schema.expenseClaims.employeeId, employeeId),
        eq(schema.expenseClaims.status, "submitted"),
      ),
    )
    .returning({ id: schema.expenseClaims.id, description: schema.expenseClaims.description });
  if (!res.length) return "Only claims awaiting review can be withdrawn.";
  await logActivity(ctx, { module: "hrm", entityType: "expense_claim", entityId: claimId, action: "withdrawn", summary: `Withdrew claim “${res[0].description}”` });
  return null;
}

export async function rejectClaim(ctx: Ctx, claimId: number, reason: string): Promise<string | null> {
  const r = reason.trim();
  if (r.length < 3) return "Give a reason so the employee knows what to fix.";
  const [c] = await db
    .select({ c: schema.expenseClaims, name: schema.employees.name })
    .from(schema.expenseClaims)
    .innerJoin(schema.employees, eq(schema.expenseClaims.employeeId, schema.employees.id))
    .where(and(eq(schema.expenseClaims.id, claimId), eq(schema.expenseClaims.orgId, ctx.orgId)))
    .limit(1);
  if (!c) return "Claim not found.";
  if (c.c.status !== "submitted") return "Only submitted claims can be rejected.";
  await db
    .update(schema.expenseClaims)
    .set({ status: "rejected", rejectionReason: r.slice(0, 300), decidedBy: ctx.userId, decidedAt: new Date() })
    .where(and(eq(schema.expenseClaims.id, claimId), eq(schema.expenseClaims.orgId, ctx.orgId)));
  await logActivity(ctx, { module: "hrm", entityType: "expense_claim", entityId: claimId, action: "rejected", summary: `Rejected ${c.name}'s claim “${c.c.description}”: ${r}` });
  return null;
}
