import type { Metadata } from "next";
import { Input, Select } from "@/components/app/forms";
import { Card, PageHeader } from "@/components/app/ui";
import { addDaysYmd, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { saveInvoice } from "../../actions";
import { InvoiceForm } from "../../_components/invoice-form";
import { invoiceFormOptions } from "../../data";
import { FINANCE_TABS } from "../../tabs";

export const metadata: Metadata = { title: "New recurring invoice" };

const nextMonth = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())).toISOString().slice(0, 10);
};

export default async function NewRecurringPage() {
  const ws = await requireWorkspace({ module: "finance", feature: "recurringInvoices" });
  const { customers, products } = await invoiceFormOptions(ws.org.id);
  const today = todayYmd();

  return (
    <>
      <PageHeader
        title="New recurring invoice"
        description="Saves the first invoice as a draft and repeats it on the schedule below. Later cycles copy its customer, lines and payment terms."
        tabs={FINANCE_TABS("recurring")}
      />
      <InvoiceForm
        action={saveInvoice}
        customers={customers}
        products={products}
        currency={ws.org.currency}
        country={ws.org.country}
        cancelHref="/app/finance/recurring"
        submitLabel="Save invoice & schedule"
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
        extra={
          <Card title="Schedule">
            <div className="grid gap-4 md:grid-cols-4">
              <Select label="Repeat" name="recurringFrequency" options={["monthly", "quarterly", "yearly"]} defaultValue="monthly" />
              <Input label="Next invoice date" name="recurringNextDate" type="date" defaultValue={nextMonth(today)} required />
              <Input label="End date (optional)" name="recurringEndDate" type="date" />
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
                <input type="checkbox" name="recurringAutoSend" className="size-4 accent-ink" /> Send automatically
              </label>
            </div>
          </Card>
        }
      />
    </>
  );
}
