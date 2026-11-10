import type { Metadata } from "next";
import { PageHeader } from "@/components/app/ui";
import { addDaysYmd, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { saveInvoice } from "../../actions";
import { InvoiceForm } from "../../_components/invoice-form";
import { invoiceFormOptions } from "../../data";
import { FINANCE_TABS } from "../../tabs";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const ws = await requireWorkspace({ module: "finance" });
  const { customers, products } = await invoiceFormOptions(ws.org.id);
  const today = todayYmd();

  return (
    <>
      <PageHeader title="New invoice" description="Saved as a draft — nothing hits the ledger until you send it." tabs={FINANCE_TABS("invoices")} />
      <InvoiceForm
        action={saveInvoice}
        customers={customers}
        products={products}
        currency={ws.org.currency}
        country={ws.org.country}
        cancelHref="/app/finance/invoices"
        values={{
          companyId: null,
          customerName: "",
          customerEmail: "",
          customerGstin: "",
          billingAddress: "",
          placeOfSupply: ws.org.state ?? "",
          issueDate: today,
          dueDate: addDaysYmd(today, 15),
          notes: "",
          lines: [],
        }}
      />
    </>
  );
}
