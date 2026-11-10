"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { countryPack, taxOption, type CountryPack } from "@/lib/countries";
import { formatMoney, taxOf, toMinor } from "@/lib/money";

export type EditorProduct = { id: number; name: string; sku: string; price: number; taxRate: number };
export type EditorLine = { productId: number | null; description: string; quantity: number; unitPrice: number; taxRate: number; taxCode?: string | null };

type Row = { key: number; productId: string; description: string; quantity: string; unitPrice: string; taxCode: string };

const cell = "h-9 w-full rounded-lg border border-line bg-paper/60 px-2 text-sm outline-none focus:border-ink focus:bg-card";

/** Effective rate of a tax option (zero-rated / exempt lines carry no tax). */
const rateOf = (pack: CountryPack, code: string) => {
  const o = taxOption(pack, code);
  return o.kind === "standard" ? o.rate : 0;
};

/**
 * Dynamic invoice line rows with a per-line tax picker from the country pack (India by default).
 * Serialises to a hidden JSON input (`name`, default "lines") with taxCode + taxRate per line.
 */
export function InvoiceLinesEditor({
  products,
  initial,
  currency = "INR",
  name = "lines",
  error,
  country = "IN",
}: {
  products: EditorProduct[];
  initial?: EditorLine[];
  currency?: string;
  name?: string;
  error?: string;
  /** Workspace country code; drives the tax options and labels. */
  country?: string | null;
}) {
  const pack = countryPack(country);
  const defaultCode = pack.tax.defaultCode;
  const [seq, setSeq] = useState(() => Math.max(initial?.length ?? 0, 1));
  const [rows, setRows] = useState<Row[]>(() =>
    (initial?.length ? initial : [{ productId: null, description: "", quantity: 1, unitPrice: 0, taxRate: rateOf(pack, defaultCode), taxCode: defaultCode }]).map((l, i) => ({
      key: i,
      productId: l.productId ? String(l.productId) : "",
      description: l.description,
      quantity: String(l.quantity),
      unitPrice: l.unitPrice ? String(l.unitPrice) : "",
      taxCode: taxOption(pack, l.taxCode, l.taxRate).code,
    })),
  );

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const pickProduct = (key: number, productId: string) => {
    const p = products.find((x) => String(x.id) === productId);
    if (!p) return patch(key, { productId: "" });
    patch(key, { productId, description: p.name, unitPrice: String(p.price), taxCode: taxOption(pack, null, p.taxRate).code });
  };

  const calc = useMemo(() => {
    const lines = rows.map((r) => {
      const qty = Number(r.quantity) || 0;
      const amount = Math.round(qty * (toMinor(r.unitPrice) || 0));
      return { amount, tax: taxOf(amount, rateOf(pack, r.taxCode)) };
    });
    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const tax = lines.reduce((s, l) => s + l.tax, 0);
    return { lines, subtotal, tax, total: subtotal + tax };
  }, [rows, pack]);

  const json = JSON.stringify(
    rows.map((r) => ({
      productId: r.productId ? Number(r.productId) : null,
      description: r.description,
      quantity: Number(r.quantity),
      unitPrice: Number(String(r.unitPrice).replace(/,/g, "") || 0),
      taxRate: rateOf(pack, r.taxCode),
      taxCode: r.taxCode,
    })),
  );

  return (
    <div>
      <input type="hidden" name={name} value={json} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[11px] tracking-widest text-ink-mute uppercase">
              <th className="pb-2 pr-2 font-normal">Product</th>
              <th className="pb-2 pr-2 font-normal">Description</th>
              <th className="w-20 pb-2 pr-2 font-normal">Qty</th>
              <th className="w-28 pb-2 pr-2 font-normal">Unit price</th>
              <th className="w-40 pb-2 pr-2 font-normal">{pack.tax.name}</th>
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
                  <select aria-label={`${pack.tax.name} rate`} value={r.taxCode} onChange={(e) => patch(r.key, { taxCode: e.target.value })} className={cell}>
                    {pack.tax.rates.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="pr-2 pb-2 pt-2 text-right tabular-nums">
                  {formatMoney(calc.lines[i].amount + calc.lines[i].tax, currency)}
                  {calc.lines[i].tax > 0 && (
                    <span className="block text-[11px] text-ink-mute">
                      {pack.tax.name} {formatMoney(calc.lines[i].tax, currency)}
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
            setRows((rs) => [...rs, { key: seq, productId: "", description: "", quantity: "1", unitPrice: "", taxCode: defaultCode }]);
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
            <dt className="text-ink-soft">{pack.tax.name}</dt>
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
