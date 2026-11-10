"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { GST_RATES } from "@/lib/accounting";
import { formatMoney, taxOf, toMinor } from "@/lib/money";

export type PoEditorProduct = { id: number; name: string; sku: string; cost: number; taxRate: number };
export type PoEditorLine = { productId: number; quantity: number; unitCost: number; taxRate: number };

type Row = { key: number; productId: string; quantity: string; unitCost: string; taxRate: string };

const cell = "h-9 w-full rounded-lg border border-line bg-paper/60 px-2 text-sm outline-none focus:border-ink focus:bg-card";

/** Dynamic PO line rows. `cost` / `unitCost` are major units; serialises to hidden JSON input `name` (default "lines"). */
export function PoLinesEditor({
  products,
  initial,
  currency = "INR",
  name = "lines",
  error,
  rates = GST_RATES,
  taxName = "GST",
  defaultRate = 18,
}: {
  products: PoEditorProduct[];
  initial?: PoEditorLine[];
  currency?: string;
  name?: string;
  error?: string;
  /** Country tax rates (percent); defaults to India GST slabs. */
  rates?: readonly number[];
  taxName?: string;
  defaultRate?: number;
}) {
  const seed = initial?.length ? initial : [{ productId: 0, quantity: 1, unitCost: 0, taxRate: defaultRate }];
  const [counter, setCounter] = useState(seed.length);
  const [rows, setRows] = useState<Row[]>(() =>
    seed.map((l, i) => ({
      key: i,
      productId: l.productId ? String(l.productId) : "",
      quantity: String(l.quantity),
      unitCost: l.unitCost ? String(l.unitCost) : "",
      taxRate: String(l.taxRate),
    })),
  );

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const pickProduct = (key: number, productId: string) => {
    const p = products.find((x) => String(x.id) === productId);
    if (!p) return patch(key, { productId: "" });
    patch(key, { productId, unitCost: String(p.cost), taxRate: String(p.taxRate) });
  };

  const calc = useMemo(() => {
    const lines = rows.map((r) => {
      const amount = Math.round((Number(r.quantity) || 0) * (toMinor(r.unitCost) || 0));
      return { amount, tax: taxOf(amount, Number(r.taxRate) || 0) };
    });
    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const tax = lines.reduce((s, l) => s + l.tax, 0);
    return { lines, subtotal, tax, total: subtotal + tax };
  }, [rows]);

  const json = JSON.stringify(
    rows.map((r) => ({
      productId: r.productId ? Number(r.productId) : null,
      quantity: Number(r.quantity),
      unitCost: Number(String(r.unitCost).replace(/,/g, "") || 0),
      taxRate: Number(r.taxRate),
    })),
  );

  const rateOptions = [...new Set<number>([...rates, ...rows.map((r) => Number(r.taxRate))])].sort((a, b) => a - b);

  return (
    <div>
      <input type="hidden" name={name} value={json} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[11px] tracking-widest text-ink-mute uppercase">
              <th className="pb-2 pr-2 font-normal">Product</th>
              <th className="w-24 pb-2 pr-2 font-normal">Qty</th>
              <th className="w-32 pb-2 pr-2 font-normal">Unit cost</th>
              <th className="w-24 pb-2 pr-2 font-normal">{taxName} %</th>
              <th className="w-32 pb-2 pr-2 text-right font-normal">Line total</th>
              <th className="w-8 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="align-top">
                <td className="pr-2 pb-2">
                  <select aria-label="Product" value={r.productId} onChange={(e) => pickProduct(r.key, e.target.value)} className={cell}>
                    <option value="">Select product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </td>
                <td className="pr-2 pb-2">
                  <input aria-label="Quantity" inputMode="decimal" value={r.quantity} onChange={(e) => patch(r.key, { quantity: e.target.value })} className={cell} />
                </td>
                <td className="pr-2 pb-2">
                  <input aria-label="Unit cost" inputMode="decimal" value={r.unitCost} onChange={(e) => patch(r.key, { unitCost: e.target.value })} placeholder="0.00" className={cell} />
                </td>
                <td className="pr-2 pb-2">
                  <select aria-label={`${taxName} rate`} value={r.taxRate} onChange={(e) => patch(r.key, { taxRate: e.target.value })} className={cell}>
                    {rateOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}%
                      </option>
                    ))}
                  </select>
                </td>
                <td className="pr-2 pb-2 pt-2 text-right tabular-nums">
                  {formatMoney(calc.lines[i].amount + calc.lines[i].tax, currency)}
                  {calc.lines[i].tax > 0 && (
                    <span className="block text-[11px] text-ink-mute">
                      {taxName} {formatMoney(calc.lines[i].tax, currency)}
                    </span>
                  )}
                </td>
                <td className="pb-2 pt-1">
                  <button
                    type="button"
                    aria-label="Remove line"
                    disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    className="grid size-7 place-items-center rounded-full text-ink-mute transition hover:bg-signal/10 hover:text-signal disabled:opacity-30"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-1 text-xs text-signal">{error}</p>}

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <button
          type="button"
          onClick={() => {
            setCounter((c) => c + 1);
            setRows((rs) => [...rs, { key: counter, productId: "", quantity: "1", unitCost: "", taxRate: String(defaultRate) }]);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium transition hover:border-ink"
        >
          <Plus className="size-3.5" /> Add line
        </button>
        <dl className="min-w-56 space-y-1 text-sm">
          <div className="flex justify-between gap-6">
            <dt className="text-ink-soft">Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(calc.subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt className="text-ink-soft">{taxName}</dt>
            <dd className="tabular-nums">{formatMoney(calc.tax, currency)}</dd>
          </div>
          <div className="flex justify-between gap-6 border-t border-line pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(calc.total, currency)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
