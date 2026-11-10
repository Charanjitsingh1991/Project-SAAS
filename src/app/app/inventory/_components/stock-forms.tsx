import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { adjustStock, issueStock, transferStock } from "../actions";

type Wh = { id: number; name: string };

export function StockActionForms({ productId, warehouses }: { productId: number; warehouses: Wh[] }) {
  const opts = warehouses.map((w) => ({ value: w.id, label: w.name }));
  const def = warehouses[0]?.id;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <ActionForm action={adjustStock} className="space-y-3 rounded-2xl border border-line p-4">
        <h3 className="font-display font-semibold">Adjust stock</h3>
        <input type="hidden" name="productId" value={productId} />
        <Select label="Warehouse" name="warehouseId" options={opts} defaultValue={def} />
        <Input label="Quantity (+ / −)" name="quantity" inputMode="decimal" placeholder="-3 or 10" />
        <Input label="Reason" name="reason" placeholder="Cycle count, damage…" />
        <SubmitButton variant="outline">Adjust</SubmitButton>
      </ActionForm>
      <ActionForm action={issueStock} className="space-y-3 rounded-2xl border border-line p-4">
        <h3 className="font-display font-semibold">Issue stock</h3>
        <input type="hidden" name="productId" value={productId} />
        <Select label="Warehouse" name="warehouseId" options={opts} defaultValue={def} />
        <Input label="Quantity" name="quantity" inputMode="decimal" placeholder="0" />
        <Input label="Note" name="note" placeholder="Internal use, sample…" />
        <SubmitButton variant="outline">Issue</SubmitButton>
      </ActionForm>
      <ActionForm action={transferStock} className="space-y-3 rounded-2xl border border-line p-4">
        <h3 className="font-display font-semibold">Transfer</h3>
        <input type="hidden" name="productId" value={productId} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="From" name="fromId" options={opts} defaultValue={def} />
          <Select label="To" name="toId" options={opts} defaultValue={warehouses[1]?.id ?? def} />
        </div>
        <Input label="Quantity" name="quantity" inputMode="decimal" placeholder="0" />
        <SubmitButton variant="outline">Transfer</SubmitButton>
      </ActionForm>
    </div>
  );
}
