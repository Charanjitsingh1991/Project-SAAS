import { Card, Stat, Table, Td, Th } from "@/components/app/ui";
import type { CountryPack } from "@/lib/countries";
import { formatDate, formatMoney } from "@/lib/format";
import type { CorporateTaxEstimate, GstReturn, TaxReturn, VatReturn } from "@/lib/tax-return";

const DISCLAIMER = "Estimate for review — not a filed return";

export function ReturnDisclaimer({ children }: { children?: React.ReactNode }) {
  return (
    <p className="mb-4 rounded-xl border border-butter bg-butter/40 px-4 py-2 text-sm">
      <span className="font-semibold">{DISCLAIMER}.</span> {children}
    </p>
  );
}

function GstView({ g, money }: { g: GstReturn; money: (v: number) => string }) {
  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Output GST" value={money(g.outward.tax)} hint="Net of credit notes" tone="peach" />
        <Stat label="Input tax credit" value={money(g.itc.tax)} hint="From bills & expenses" tone="mint" />
        <Stat label={g.net >= 0 ? "Net GST payable" : "Credit carried forward"} value={money(Math.abs(g.net))} tone={g.net >= 0 ? "butter" : "lime"} />
      </div>
      <div className="space-y-6">
        <Card title="3.1 Outward taxable supplies (by rate)">
          <Table>
            <thead>
              <tr>
                <Th>Rate</Th>
                <Th className="text-right">Taxable value</Th>
                <Th className="text-right">IGST</Th>
                <Th className="text-right">CGST</Th>
                <Th className="text-right">SGST / UTGST</Th>
                <Th className="text-right">Total tax</Th>
              </tr>
            </thead>
            <tbody>
              {g.byRate.length === 0 && (
                <tr>
                  <Td className="text-ink-mute">No taxable supplies in this period</Td>
                </tr>
              )}
              {g.byRate.map((r) => (
                <tr key={r.code}>
                  <Td>{r.label}</Td>
                  <Td className="text-right tabular-nums">{money(r.taxable)}</Td>
                  <Td className="text-right tabular-nums">{money(r.igst)}</Td>
                  <Td className="text-right tabular-nums">{money(r.cgst)}</Td>
                  <Td className="text-right tabular-nums">{money(r.sgst)}</Td>
                  <Td className="text-right tabular-nums">{money(r.igst + r.cgst + r.sgst)}</Td>
                </tr>
              ))}
              <tr className="bg-paper/40 font-semibold">
                <Td>(a) Total taxable outward supplies</Td>
                <Td className="text-right tabular-nums">{money(g.outward.taxable)}</Td>
                <Td className="text-right tabular-nums">{money(g.outward.igst)}</Td>
                <Td className="text-right tabular-nums">{money(g.outward.cgst)}</Td>
                <Td className="text-right tabular-nums">{money(g.outward.sgst)}</Td>
                <Td className="text-right tabular-nums">{money(g.outward.tax)}</Td>
              </tr>
              <tr>
                <Td>(c) Nil-rated supplies</Td>
                <Td className="text-right tabular-nums">{money(g.nilRated)}</Td>
                <td colSpan={4} className="border-b border-line/70" />
              </tr>
              <tr>
                <Td>(c) Exempt supplies</Td>
                <Td className="text-right tabular-nums">{money(g.exempt)}</Td>
                <td colSpan={4} className="border-b border-line/70" />
              </tr>
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-ink-mute">
            Inter-state taxable value {money(g.interState.taxable)} (IGST {money(g.interState.igst)}). Includes credit notes of {money(g.creditNotes.taxable)} taxable / {money(g.creditNotes.tax)} tax, deducted in the period they were issued. Place of supply is compared with your workspace state.
          </p>
        </Card>
        <Card title="4. Eligible input tax credit">
          <Table compact>
            <tbody>
              <tr>
                <Td>Taxable value of purchases with GST</Td>
                <Td className="text-right tabular-nums">{money(g.itc.taxable)}</Td>
              </tr>
              <tr>
                <Td>ITC available (all heads)</Td>
                <Td className="text-right tabular-nums">{money(g.itc.tax)}</Td>
              </tr>
              <tr className="bg-paper/40 font-semibold">
                <Td>Net tax payable (output − ITC)</Td>
                <Td className="text-right tabular-nums">{money(g.net)}</Td>
              </tr>
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-ink-mute">ITC isn&apos;t split into IGST/CGST/SGST because vendor states aren&apos;t recorded on bills — allocate heads when filing.</p>
        </Card>
      </div>
    </>
  );
}

function VatView({ v, pack, money }: { v: VatReturn; pack: CountryPack; money: (v: number) => string }) {
  const letters = "abcdefg";
  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Output VAT (box 12)" value={money(v.standard.vat)} hint="Net of credit notes" tone="peach" />
        <Stat label="Recoverable VAT (box 13)" value={money(v.expenses.vat)} hint="From bills & expenses" tone="mint" />
        <Stat label={v.net >= 0 ? "Net VAT payable (box 14)" : "Net VAT refundable (box 14)"} value={money(Math.abs(v.net))} tone={v.net >= 0 ? "butter" : "lime"} />
      </div>
      <Card title="VAT on sales and all other outputs">
        <Table>
          <thead>
            <tr>
              <Th>Box</Th>
              <Th>Description</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">VAT amount</Th>
            </tr>
          </thead>
          <tbody>
            {v.byEmirate.map((e) => {
              const i = pack.regions.indexOf(e.emirate);
              return (
                <tr key={e.emirate}>
                  <Td className="text-ink-mute">{i >= 0 ? `1${letters[i]}` : "1"}</Td>
                  <Td>Standard rated supplies in {e.emirate}</Td>
                  <Td className="text-right tabular-nums">{money(e.taxable)}</Td>
                  <Td className="text-right tabular-nums">{money(e.vat)}</Td>
                </tr>
              );
            })}
            <tr>
              <Td className="text-ink-mute">4</Td>
              <Td>Zero rated supplies</Td>
              <Td className="text-right tabular-nums">{money(v.zeroRated)}</Td>
              <Td />
            </tr>
            <tr>
              <Td className="text-ink-mute">5</Td>
              <Td>Exempt supplies</Td>
              <Td className="text-right tabular-nums">{money(v.exempt)}</Td>
              <Td />
            </tr>
            <tr className="bg-paper/40 font-semibold">
              <Td>8</Td>
              <Td>Totals</Td>
              <Td className="text-right tabular-nums">{money(v.totalSupplies.taxable)}</Td>
              <Td className="text-right tabular-nums">{money(v.totalSupplies.vat)}</Td>
            </tr>
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-ink-mute">
          Includes credit notes of {money(v.creditNotes.taxable)} / VAT {money(v.creditNotes.tax)}, adjusted in the period issued. Supplies without a place of supply are reported under your workspace emirate. Tourist refunds (box 2), reverse charge (boxes 3 and 10) and import adjustments (boxes 6–7) aren&apos;t tracked — add them when filing.
        </p>
      </Card>
      <div className="mt-6">
        <Card title="VAT on expenses and all other inputs">
          <Table>
            <tbody>
              <tr>
                <Td className="text-ink-mute">9</Td>
                <Td>Standard rated expenses</Td>
                <Td className="text-right tabular-nums">{money(v.expenses.taxable)}</Td>
                <Td className="text-right tabular-nums">{money(v.expenses.vat)}</Td>
              </tr>
              <tr>
                <Td className="text-ink-mute">12</Td>
                <Td>Total value of due tax for the period</Td>
                <Td />
                <Td className="text-right tabular-nums">{money(v.standard.vat)}</Td>
              </tr>
              <tr>
                <Td className="text-ink-mute">13</Td>
                <Td>Total value of recoverable tax for the period</Td>
                <Td />
                <Td className="text-right tabular-nums">{money(v.expenses.vat)}</Td>
              </tr>
              <tr className="bg-paper/40 font-semibold">
                <Td>14</Td>
                <Td>{v.net >= 0 ? "Payable tax for the period" : "Refundable tax for the period"}</Td>
                <Td />
                <Td className="text-right tabular-nums">{money(Math.abs(v.net))}</Td>
              </tr>
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}

export function TaxReturnView({ ret, pack, currency, counts }: { ret: TaxReturn; pack: CountryPack; currency: string; counts: { invoices: number; creditNotes: number; expenses: number } }) {
  const money = (v: number) => formatMoney(v, currency);
  return (
    <>
      <ReturnDisclaimer>
        Built from {counts.invoices} sent invoice{counts.invoices === 1 ? "" : "s"}, {counts.creditNotes} credit note{counts.creditNotes === 1 ? "" : "s"} and {counts.expenses} expense
        {counts.expenses === 1 ? "" : "s"}/bill{counts.expenses === 1 ? "" : "s"} in this period. Check every figure before filing your {pack.tax.returnName}.
      </ReturnDisclaimer>
      {ret.kind === "GST" ? <GstView g={ret} money={money} /> : <VatView v={ret} pack={pack} money={money} />}
    </>
  );
}

export function CorporateTaxCard({ est, fy, note, currency }: { est: CorporateTaxEstimate; fy: [string, string]; note: string; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  return (
    <div className="mt-6">
      <Card title={`Corporate tax estimate · FY ${formatDate(fy[0])} – ${formatDate(fy[1])}`}>
        <Table compact>
          <tbody>
            <tr>
              <Td>Accounting profit (ledger, income − expenses)</Td>
              <Td className="text-right tabular-nums">{money(est.profit)}</Td>
            </tr>
            <tr>
              <Td>Taxed at 0% (up to threshold)</Td>
              <Td className="text-right tabular-nums">{money(est.zeroBand)}</Td>
            </tr>
            <tr>
              <Td>Taxed at {est.rate}%</Td>
              <Td className="text-right tabular-nums">{money(est.chargeable)}</Td>
            </tr>
            <tr className="bg-paper/40 font-semibold">
              <Td>Estimated corporate tax</Td>
              <Td className="text-right tabular-nums">{money(est.tax)}</Td>
            </tr>
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-ink-mute">
          {DISCLAIMER}. {note} Accounting profit is used as a proxy for taxable income — adjust for non-deductible expenses, exempt income and reliefs.
        </p>
      </Card>
    </div>
  );
}
