import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiError, apiJson, withApi } from "@/lib/api-auth";
import { serializeInvoice } from "@/lib/api/resources";
import { serializeLine } from "@/lib/api/writes";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(req, { module: "finance" }, async (ctx) => {
    if (!/^\d{1,15}$/.test(id)) return apiError(404, "not_found", "Invoice not found.");
    const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, Number(id)), eq(schema.invoices.orgId, ctx.orgId))).limit(1);
    if (!inv) return apiError(404, "not_found", "Invoice not found.");
    const lines = await db
      .select()
      .from(schema.invoiceLines)
      .where(and(eq(schema.invoiceLines.invoiceId, inv.id), eq(schema.invoiceLines.orgId, ctx.orgId)))
      .orderBy(schema.invoiceLines.sortOrder);
    return apiJson({ data: { ...serializeInvoice(inv, ctx), lines: lines.map(serializeLine) } });
  });
}
