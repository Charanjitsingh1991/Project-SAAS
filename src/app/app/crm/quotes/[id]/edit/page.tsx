import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { fromMinor } from "@/lib/format";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { QuoteForm } from "../../../_components/quote-form";
import { CRM_TABS } from "../../../tabs";
import { editorTax, getQuoteFormData } from "../../form-data";

export const metadata: Metadata = { title: "Edit quote" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [q] = await db.select().from(schema.quotes).where(and(eq(schema.quotes.id, id), eq(schema.quotes.orgId, ws.org.id))).limit(1);
  if (!q) notFound();
  if (q.status !== "draft") redirect(`/app/crm/quotes/${id}?error=${encodeURIComponent("Only draft quotes can be edited. Revise it back to draft first.")}`);

  const pack = packFor(ws);
  const [data, lines] = await Promise.all([
    getQuoteFormData(ws.org.id),
    db.select().from(schema.quoteLines).where(and(eq(schema.quoteLines.quoteId, id), eq(schema.quoteLines.orgId, ws.org.id))).orderBy(schema.quoteLines.sortOrder),
  ]);

  return (
    <>
      <PageHeader title={`Edit ${q.number}`} tabs={CRM_TABS("quotes")} />
      <Card>
        <QuoteForm
          id={q.id}
          initial={{
            ...q,
            lines: lines.map((l) => ({
              productId: l.productId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: fromMinor(l.unitPrice),
              discountPercent: l.discountPercent,
              taxCode: l.taxCode ?? pack.tax.defaultCode,
            })),
          }}
          {...data}
          currency={ws.org.currency}
          tax={editorTax(pack)}
          regionLabel={pack.regionLabel}
          regions={pack.regions}
        />
      </Card>
    </>
  );
}
