import { ActionForm, Input, Select, SubmitButton, Textarea } from "@/components/app/forms";
import type { TaxRateOption } from "@/lib/countries";
import { createQuote, updateQuote } from "../quotes/actions";
import { QuoteLinesEditor, type QuoteEditorLine, type QuoteEditorProduct } from "./quote-lines-editor";

type Opt = { value: number; label: string };

export type QuoteFormInitial = {
  dealId?: number | null;
  companyId?: number | null;
  contactId?: number | null;
  customerName?: string | null;
  customerEmail?: string | null;
  placeOfSupply?: string | null;
  issueDate: string;
  validUntil: string;
  terms?: string | null;
  lines?: QuoteEditorLine[];
};

export function QuoteForm({
  id,
  initial,
  deals,
  companies,
  contacts,
  products,
  currency,
  tax,
  regionLabel,
  regions,
}: {
  id?: number;
  initial: QuoteFormInitial;
  deals: Opt[];
  companies: Opt[];
  contacts: Opt[];
  products: QuoteEditorProduct[];
  currency: string;
  tax: { name: string; rates: TaxRateOption[]; defaultCode: string };
  regionLabel: string;
  regions: readonly string[];
}) {
  return (
    <ActionForm action={id ? updateQuote : createQuote} resetOnSuccess={false} className="space-y-5">
      {id && <input type="hidden" name="id" value={id} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Select label="Company" name="companyId" options={companies} placeholder="— None —" defaultValue={initial.companyId ?? ""} />
        <Select label="Contact" name="contactId" options={contacts} placeholder="— None —" defaultValue={initial.contactId ?? ""} />
        <Select label="Deal (optional)" name="dealId" options={deals} placeholder="— None —" defaultValue={initial.dealId ?? ""} />
        <Input label="Customer name (defaults to company/contact)" name="customerName" defaultValue={initial.customerName ?? ""} />
        <Input label="Customer email" name="customerEmail" type="email" defaultValue={initial.customerEmail ?? ""} />
        <Select
          label={`Place of supply (${regionLabel.toLowerCase()})`}
          name="placeOfSupply"
          options={regions.map((r) => ({ value: r, label: r }))}
          placeholder="— Same as company —"
          defaultValue={initial.placeOfSupply && regions.includes(initial.placeOfSupply) ? initial.placeOfSupply : ""}
        />
        <Input label="Quote date" name="issueDate" type="date" defaultValue={initial.issueDate} required />
        <Input label="Valid until" name="validUntil" type="date" defaultValue={initial.validUntil} required />
      </div>
      <QuoteLinesEditor products={products} initial={initial.lines} currency={currency} rates={tax.rates} defaultCode={tax.defaultCode} taxName={tax.name} />
      <Textarea label="Terms & notes" name="terms" defaultValue={initial.terms ?? ""} placeholder="Payment terms, delivery timelines, inclusions…" />
      <SubmitButton>{id ? "Save quote" : "Create quote"}</SubmitButton>
    </ActionForm>
  );
}
