import { ActionForm, Input, Select, SubmitButton, Textarea } from "@/components/app/forms";
import type { schema } from "@/db";
import { ASSET_CATEGORIES, MANUAL_STATUSES } from "@/lib/assets";
import type { FormState } from "@/lib/definitions";
import { fromMinor } from "@/lib/format";

type Asset = typeof schema.companyAssets.$inferSelect;

export function AssetForm({
  action,
  asset,
  currency,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  asset?: Asset;
  currency: string;
}) {
  const assigned = asset?.status === "assigned";
  return (
    <ActionForm action={action} resetOnSuccess={!asset} className="space-y-3">
      {asset && <input type="hidden" name="id" value={asset.id} />}
      <Input label="Name" name="name" defaultValue={asset?.name} placeholder="e.g. MacBook Pro 14”" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Category" name="category" options={ASSET_CATEGORIES} defaultValue={asset?.category ?? "laptop"} />
        {assigned ? (
          <Input label="Status" name="statusDisplay" value="assigned" readOnly disabled />
        ) : (
          <Select label="Status" name="status" options={MANUAL_STATUSES} defaultValue={asset?.status ?? "available"} />
        )}
        <Input label="Serial number" name="serialNumber" defaultValue={asset?.serialNumber ?? ""} />
        <Input label={`Purchase cost (${currency})`} name="purchaseCost" inputMode="decimal" defaultValue={asset?.purchaseCost ? fromMinor(asset.purchaseCost) : ""} />
        <Input label="Purchase date" name="purchaseDate" type="date" defaultValue={asset?.purchaseDate ?? ""} />
        <Input label="Warranty expiry" name="warrantyExpiry" type="date" defaultValue={asset?.warrantyExpiry ?? ""} />
      </div>
      <Textarea label="Notes" name="notes" rows={3} defaultValue={asset?.notes ?? ""} />
      <SubmitButton>{asset ? "Save changes" : "Add asset"}</SubmitButton>
    </ActionForm>
  );
}
