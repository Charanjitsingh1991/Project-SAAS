import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { fromMinor } from "@/lib/money";
import { requireWorkspace } from "@/lib/tenancy";
import { saveInvoice } from "../../../actions";
import { InvoiceForm } from "../../../_components/invoice-form";
import { invoiceFormOptions } from "../../../data";
import { FINANCE_TABS } from "../../../tabs";

export const metadata: Metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: PageProps<"/app/finance/invoices/[id]/edit">) {
  const ws = await requireWorkspace({ module: "finance" });
  const invoiceId = Number((await params).id);
  if (!Number.isInteger(invoiceId)) notFound();
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.orgId, ws.org.id))).limit(1);
  if (!inv) notFound();
  if (inv.status !== "draft") redirect(`/app/finance/invoices/${inv.id}`);

  const [lines, { customers, products }] = await Promise.all([
    db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, inv.id)).orderBy(asc(schema.invoiceLines.sortOrder)),
    invoiceFormOptions(ws.org.id),
  ]);

  return (
    <>
      <PageHeader title={`Edit ${inv.number}`} description="Only draft invoices can be edited." tabs={FINANCE_TABS("invoices")} />
      <InvoiceForm
        action={saveInvoice}
        customers={customers}
        products={products}
        currency={ws.org.currency}
        country={ws.org.country}
        cancelHref={`/app/finance/invoices/${inv.id}`}
        values={{
          id: inv.id,
          companyId: inv.companyId,
          customerName: inv.customerName,
          customerEmail: inv.customerEmail ?? "",
          customerGstin: inv.customerGstin ?? "",
          billingAddress: inv.billingAddress ?? "",
          placeOfSupply: inv.placeOfSupply ?? "",
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          notes: inv.notes ?? "",
          lines: lines.map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: fromMinor(l.unitPrice), taxRate: l.taxRate, taxCode: l.taxCode })),
        }}
      />
    </>
  );
}
