"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { TaxRateOption } from "@/lib/countries";
import { formatMoney, toMinor } from "@/lib/money";
import { computeQuoteLines } from "@/lib/quotes";

/** `price` is in major units. */
export type QuoteEditorProduct = { id: number; name: string; sku: string; price: number; taxRate: number };
/** `unitPrice` is in major units. */
export type QuoteEditorLine = { productId: number | null; description: string; quantity: number; unitPrice: number; discountPercent: number; taxCode: string };

type Row = { key: number; productId: string; description: string; quantity: string; unitPrice: string; discountPercent: string; taxCode: string };

const cell = "h-9 w-full rounded-lg border border-line bg-paper/60 px-2 text-sm outline-none focus:border-ink focus:bg-card";

/** Quote line rows with per-line country tax codes. Serialises to hidden JSON input `lines`. */
export function QuoteLinesEditor({
  products,
  initial,
  currency,
  rates,
  defaultCode,
  taxName,
  error,
}: {
  products: QuoteEditorProduct[];
  initial?: QuoteEditorLine[];
  currency: string;
  rates: TaxRateOption[];
  defaultCode: string;
  taxName: string;
  error?: string;
}) {
  const blank = (key: number): Row => ({ key, productId: "", description: "", quantity: "1", unitPrice: "", discountPercent: "", taxCode: defaultCode });
  const [seq, setSeq] = useState(() => Math.max(initial?.length ?? 0, 1));
  const [rows, setRows] = useState<Row[]>(() =>
    initial?.length
      ? initial.map((l, i) => ({
          key: i,
          productId: l.productId ? String(l.productId) : "",
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: l.unitPrice ? String(l.unitPrice) : "",
          discountPercent: l.discountPercent ? String(l.discountPercent) : "",
          taxCode: l.taxCode,
        }))
      : [blank(0)],
  );

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const pickProduct = (key: number, productId: string) => {
    const p = products.find((x) => String(x.id) === productId);
    if (!p) return patch(key, { productId: "" });
    // Products store a rate only; map it to the first standard code with that rate.
    const code = rates.find((r) => r.kind === "standard" && r.rate === p.taxRate)?.code ?? (p.taxRate === 0 ? rates.find((r) => r.kind === "zero")?.code : undefined) ?? defaultCode;
    patch(key, { productId, description: p.name, unitPrice: String(p.price), taxCode: code });
  };

  const calc = useMemo(
    () =>
      computeQuoteLines(
        rates,
        rows.map((r) => ({
          description: r.description,
          quantity: Number(r.quantity) || 0,
          unitPrice: toMinor(r.unitPrice) || 0,
          discountPercent: Math.min(100, Math.max(0, Number(r.discountPercent) || 0)),
          taxCode: r.taxCode,
        })),
      ),
    [rows, rates],
  );

  const json = JSON.stringify(
    rows.map((r) => ({
      productId: r.productId ? Number(r.productId) : null,
      description: r.description,
      quantity: Number(r.quantity),
      unitPrice: Number(String(r.unitPrice).replace(/,/g, "") || 0),
      discountPercent: Number(r.discountPercent || 0),
      taxCode: r.taxCode,
    })),
  );

  return (
    <div>
      <input type="hidden" name="lines" value={json} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[11px] tracking-widest text-ink-mute uppercase">
              <th className="pb-2 pr-2 font-normal">Product</th>
              <th className="pb-2 pr-2 font-normal">Description</th>
              <th className="w-20 pb-2 pr-2 font-normal">Qty</th>
              <th className="w-28 pb-2 pr-2 font-normal">Unit price</th>
              <th className="w-20 pb-2 pr-2 font-normal">Disc %</th>
              <th className="w-40 pb-2 pr-2 font-normal">{taxName}</th>
              <th className="w-32 pb-2 pr-2 text-right font-normal">Line total</th>
              <th className="w-8 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="align-top">
                <td className="pr-2 pb-2">
                  <select aria-label="Product" value={r.productId} onChange={(e) => pickProduct(r.key, e.target.value)} className={cell}>
                    <option value="">— Service / custom —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </td>
                <td className="pr-2 pb-2">
                  <input aria-label="Description" value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} placeholder="Description" className={cell} />
                </td>
                <td className="pr-2 pb-2">
                  <input aria-label="Quantity" inputMode="decimal" value={r.quantity} onChange={(e) => patch(r.key, { quantity: e.target.value })} className={cell} />
                </td>
                <td className="pr-2 pb-2">
                  <input aria-label="Unit price" inputMode="decimal" value={r.unitPrice} onChange={(e) => patch(r.key, { unitPrice: e.target.value })} placeholder="0.00" className={cell} />
                </td>
                <td className="pr-2 pb-2">
                  <input aria-label="Discount percent" inputMode="decimal" value={r.discountPercent} onChange={(e) => patch(r.key, { discountPercent: e.target.value })} placeholder="0" className={cell} />
                </td>
                <td className="pr-2 pb-2">
                  <select aria-label={`${taxName} rate`} value={r.taxCode} onChange={(e) => patch(r.key, { taxCode: e.target.value })} className={cell}>
                    {rates.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="pr-2 pb-2 pt-2 text-right tabular-nums">
                  {formatMoney(calc.lines[i].amount + calc.lines[i].taxAmount, currency)}
                  {calc.lines[i].taxAmount > 0 && (
                    <span className="block text-[11px] text-ink-mute">
                      {taxName} {formatMoney(calc.lines[i].taxAmount, currency)}
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
            setRows((rs) => [...rs, blank(seq)]);
            setSeq(seq + 1);
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
            <dd className="tabular-nums">{formatMoney(calc.taxTotal, currency)}</dd>
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
