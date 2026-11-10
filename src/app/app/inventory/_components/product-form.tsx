import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { UNITS } from "@/db/schema";
import { fromMinor } from "@/lib/format";
import { createProduct, updateProduct } from "../actions";
import type { InventoryTax } from "./tax";

type Option = { id: number; name: string };
export type ProductFormValues = {
  id: number;
  name: string;
  sku: string;
  barcode: string | null;
  category: string | null;
  unit: (typeof UNITS)[number];
  costPrice: number;
  sellingPrice: number;
  taxRate: number;
  reorderLevel: number;
  reorderQty: number;
  preferredVendorId: number | null;
  trackStock: boolean;
  active: boolean;
};

const check = "size-4 rounded border-line accent-ink";

export function ProductForm({
  vendors,
  warehouses,
  product,
  costLocked,
  tax,
}: {
  vendors: Option[];
  warehouses?: Option[];
  product?: ProductFormValues;
  costLocked?: boolean;
  tax: InventoryTax;
}) {
  const editing = !!product;
  const rates = [...new Set<number>([...tax.rates, product?.taxRate ?? tax.defaultRate])].sort((a, b) => a - b);
  return (
    <ActionForm action={editing ? updateProduct : createProduct} resetOnSuccess={!editing} className="space-y-4">
      {editing && <input type="hidden" name="id" value={product.id} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Name" name="name" defaultValue={product?.name} className="lg:col-span-2" />
        <Input label="SKU" name="sku" defaultValue={product?.sku} />
        <Input label="Barcode" name="barcode" defaultValue={product?.barcode ?? ""} />
        <Input label="Category" name="category" defaultValue={product?.category ?? ""} list="inventory-categories" placeholder="e.g. Electronics" />
        <datalist id="inventory-categories">
          {["Electronics", "Furniture", "Consumables", "Packaging"].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Select label="Unit" name="unit" options={UNITS} defaultValue={product?.unit ?? "pcs"} />
        <Input
          label={costLocked ? "Avg. cost (locked after receipt)" : "Cost price"}
          name="costPrice"
          inputMode="decimal"
          defaultValue={product ? fromMinor(product.costPrice) : ""}
          disabled={costLocked}
          placeholder="0.00"
        />
        <Input label="Selling price" name="sellingPrice" inputMode="decimal" defaultValue={product ? fromMinor(product.sellingPrice) : ""} placeholder="0.00" />
        <Select label={`${tax.name} %`} name="taxRate" options={rates.map((r) => ({ value: r, label: `${r}%` }))} defaultValue={product?.taxRate ?? tax.defaultRate} />
        <Input label="Reorder level" name="reorderLevel" inputMode="decimal" defaultValue={product?.reorderLevel ?? 0} />
        <Input label="Reorder qty" name="reorderQty" inputMode="decimal" defaultValue={product?.reorderQty ?? 0} />
        <Select
          label="Preferred vendor"
          name="preferredVendorId"
          placeholder="— None —"
          options={vendors.map((v) => ({ value: v.id, label: v.name }))}
          defaultValue={product?.preferredVendorId ?? ""}
        />
        {!editing && warehouses && (
          <>
            <Input label="Opening stock (optional)" name="openingQty" inputMode="decimal" placeholder="0" />
            <Select label="Opening warehouse" name="openingWarehouseId" placeholder="Default warehouse" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="trackStock" defaultChecked={product?.trackStock ?? true} className={check} /> Track stock
        </label>
        {editing && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={product.active} className={check} /> Active
          </label>
        )}
      </div>
      <SubmitButton>{editing ? "Save product" : "Add product"}</SubmitButton>
    </ActionForm>
  );
}
