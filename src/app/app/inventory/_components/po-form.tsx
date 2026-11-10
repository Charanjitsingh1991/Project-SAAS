import { ActionForm, Input, Select, SubmitButton, Textarea } from "@/components/app/forms";
import { PoLinesEditor, type PoEditorLine, type PoEditorProduct } from "@/components/app/po-lines-editor";
import type { FormState } from "@/lib/definitions";

type Opt = { id: number; name: string };

export function PoForm({
  action,
  id,
  vendors,
  warehouses,
  products,
  currency,
  initial,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  id?: number;
  vendors: Opt[];
  warehouses: Opt[];
  products: PoEditorProduct[];
  currency: string;
  initial: { vendorId?: number; warehouseId?: number; orderDate: string; expectedDate?: string | null; notes?: string | null; lines?: PoEditorLine[] };
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-5">
      {id && <input type="hidden" name="id" value={id} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Vendor" name="vendorId" placeholder="Select vendor…" options={vendors.map((v) => ({ value: v.id, label: v.name }))} defaultValue={initial.vendorId ?? ""} />
        <Select label="Deliver to" name="warehouseId" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} defaultValue={initial.warehouseId} />
        <Input label="Order date" name="orderDate" type="date" defaultValue={initial.orderDate} />
        <Input label="Expected date" name="expectedDate" type="date" defaultValue={initial.expectedDate ?? ""} />
      </div>
      <PoLinesEditor products={products} initial={initial.lines} currency={currency} />
      <Textarea label="Notes" name="notes" defaultValue={initial.notes ?? ""} />
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
