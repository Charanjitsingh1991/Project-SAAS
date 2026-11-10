"use client";

import { useState } from "react";
import { ActionForm, Input, Select, SubmitButton, Textarea } from "@/components/app/forms";
import { Card } from "@/components/app/ui";
import { InvoiceLinesEditor, type EditorLine, type EditorProduct } from "@/components/app/invoice-lines-editor";
import { countryPack } from "@/lib/countries";
import type { FormState } from "@/lib/definitions";

export type CustomerOption = { id: number; name: string; taxId: string; address: string; region: string; email: string };

export type InvoiceFormValues = {
  id?: number;
  companyId: number | null;
  customerName: string;
  customerEmail: string;
  customerGstin: string;
  billingAddress: string;
  placeOfSupply: string;
  issueDate: string;
  dueDate: string;
  notes: string;
  lines: EditorLine[];
};

export function InvoiceForm({
  action,
  values,
  customers,
  products,
  currency,
  country,
  cancelHref,
  extra,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  values: InvoiceFormValues;
  customers: CustomerOption[];
  products: EditorProduct[];
  currency: string;
  country: string;
  cancelHref: string;
  /** Extra cards rendered before the submit button (e.g. a recurring schedule). */
  extra?: React.ReactNode;
  submitLabel?: string;
}) {
  const pack = countryPack(country);
  const [companyId, setCompanyId] = useState(values.companyId ? String(values.companyId) : "");
  const [name, setName] = useState(values.customerName);
  const [email, setEmail] = useState(values.customerEmail);
  const [gstin, setGstin] = useState(values.customerGstin);
  const [address, setAddress] = useState(values.billingAddress);
  const [state, setState] = useState(values.placeOfSupply);
  const [issue, setIssue] = useState(values.issueDate);
  const [due, setDue] = useState(values.dueDate);
  const [notes, setNotes] = useState(values.notes);

  const pick = (v: string) => {
    setCompanyId(v);
    const c = customers.find((x) => String(x.id) === v);
    if (!c) return;
    setName(c.name);
    setGstin(c.taxId);
    setAddress(c.address);
    setState(c.region);
    if (c.email) setEmail(c.email);
  };

  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-6">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <Card title="Customer">
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="CRM company (optional)"
            name="companyId"
            placeholder="— Type a customer below —"
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
            value={companyId}
            onChange={(e) => pick(e.target.value)}
          />
          <Input label="Customer name" name="customerName" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Customer email" name="customerEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input
            label={`Customer ${pack.tax.idLabel} (optional)`}
            name="customerGstin"
            value={gstin}
            onChange={(e) => setGstin(e.target.value)}
            placeholder={pack.tax.idExample}
            className="[&_input]:uppercase"
          />
          <Textarea label="Billing address" name="billingAddress" value={address} onChange={(e) => setAddress(e.target.value)} />
          <Select
            label={`Place of supply (${pack.regionLabel.toLowerCase()})`}
            name="placeOfSupply"
            placeholder={`— Select ${pack.regionLabel.toLowerCase()} —`}
            options={pack.regions.map((s) => ({ value: s, label: s }))}
            value={state}
            onChange={(e) => setState(e.target.value)}
          />
          <Input label="Issue date" name="issueDate" type="date" value={issue} onChange={(e) => setIssue(e.target.value)} required />
          <Input label="Due date" name="dueDate" type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
        </div>
      </Card>

      <Card title="Line items">
        <InvoiceLinesEditor products={products} initial={values.lines} currency={currency} country={country} />
      </Card>

      <Card title="Notes">
        <Textarea label="Notes / payment terms (shown on the invoice)" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Card>

      {extra}

      <div className="flex items-center gap-3">
        <SubmitButton>{submitLabel ?? (values.id ? "Save changes" : "Save draft")}</SubmitButton>
        <a href={cancelHref} className="text-sm text-ink-soft hover:text-ink">
          Cancel
        </a>
      </div>
    </ActionForm>
  );
}
