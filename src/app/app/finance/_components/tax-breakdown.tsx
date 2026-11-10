import { formatMoney } from "@/lib/format";
import type { TaxSummaryRow } from "@/lib/finance-utils";

/** Per-rate tax table for an invoice / credit note, using the country pack's split lines. */
export function TaxBreakdown({ rows, taxName, currency }: { rows: TaxSummaryRow[]; taxName: string; currency: string }) {
  if (!rows.length) return null;
  return (
    <table className="w-full max-w-md text-left text-xs">
      <thead>
        <tr className="font-mono tracking-widest text-ink-mute uppercase">
          <th className="pb-1 font-normal">{taxName}</th>
          <th className="pb-1 text-right font-normal">Taxable</th>
          <th className="pb-1 pl-3 font-normal">Tax</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.code} className="align-top">
            <td className="py-0.5">{r.label}</td>
            <td className="py-0.5 text-right tabular-nums">{formatMoney(r.taxable, currency)}</td>
            <td className="py-0.5 pl-3 tabular-nums">
              {r.split.length === 0 ? "—" : r.split.map((s) => <span key={s.label} className="block">{`${s.label}: ${formatMoney(s.amount, currency)}`}</span>)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
