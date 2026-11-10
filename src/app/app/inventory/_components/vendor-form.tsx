import { ActionForm, Input, Textarea, SubmitButton } from "@/components/app/forms";
import { createVendor, updateVendor } from "../actions";
import type { InventoryTax } from "./tax";

export type VendorValues = { id: number; name: string; email: string | null; phone: string | null; gstin: string | null; address: string | null };

export function VendorForm({ vendor, tax }: { vendor?: VendorValues; tax: InventoryTax }) {
  return (
    <ActionForm action={vendor ? updateVendor : createVendor} resetOnSuccess={!vendor} className="space-y-4">
      {vendor && <input type="hidden" name="id" value={vendor.id} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Name" name="name" defaultValue={vendor?.name} />
        <Input label="Email" name="email" type="email" defaultValue={vendor?.email ?? ""} />
        <Input label="Phone" name="phone" defaultValue={vendor?.phone ?? ""} />
        <Input label={tax.idLabel} name="gstin" defaultValue={vendor?.gstin ?? ""} placeholder={tax.idExample} />
      </div>
      <Textarea label="Address" name="address" defaultValue={vendor?.address ?? ""} />
      <SubmitButton>{vendor ? "Save vendor" : "Add vendor"}</SubmitButton>
    </ActionForm>
  );
}
