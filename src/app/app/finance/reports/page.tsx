import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/app/ui";
import { fiscalYearFor } from "@/lib/countries";
import { balanceSheet, cashMovement, gstSummary, profitAndLoss, receivables, trialBalance, type PlRow } from "@/lib/finance";
import { AGING_BUCKETS, AGING_LABEL, YMD } from "@/lib/finance-utils";
import { formatDate, formatMoney, formatPeriod, todayYmd } from "@/lib/format";
import { corporateTaxEstimate, taxReturn } from "@/lib/tax-return";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { FINANCE_TABS } from "../tabs";
import { loadTaxReturnInput } from "./tax-data";
import { CorporateTaxCard, TaxReturnView } from "./tax-return-view";

export const metadata: Metadata = { title: "Reports" };

const REPORT_KEYS = ["pl", "bs", "tb", "aging", "tax", "gst", "cash"] as const;
type ReportKey = (typeof REPORT_KEYS)[number];

/** First and last day of the calendar month / quarter containing `ymd`, shifted back `back` periods. */
function periodRange(ymd: string, months: 1 | 3, back = 0): [string, string] {
  const [y, m] = ymd.split("-").map(Number);
  const startMonth = Math.floor((m - 1) / months) * months - back * months;
  const start = new Date(Date.UTC(y, startMonth, 1));
  const end = new Date(Date.UTC(y, startMonth + months, 0));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <p className={cn("mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium", ok ? "bg-mint/70" : "bg-signal/10 text-signal")}>
    {ok ? "✓" : "✗"} {children}
  </p>
);

export default async function ReportsPage({ searchParams }: PageProps<"/app/finance/reports">) {
  const ws = await requireWorkspace({ module: "finance" });
  const sp = await searchParams;
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const pack = packFor(ws);
  const REPORTS: { key: ReportKey; label: string }[] = [
    { key: "pl", label: "Profit & loss" },
    { key: "bs", label: "Balance sheet" },
    { key: "tb", label: "Trial balance" },
    { key: "aging", label: "Receivables aging" },
    { key: "tax", label: pack.tax.returnName },
    { key: "gst", label: `${pack.tax.name} by month` },
    { key: "cash", label: "Cash" },
  ];
  const today = todayYmd();
  const [fyFrom, fyTo] = fiscalYearFor(today, ws.org.fiscalYearStart);
  const r: ReportKey = (REPORT_KEYS as readonly string[]).includes(String(sp.r)) ? (sp.r as ReportKey) : "pl";
  // Returns default to last month; other reports to the fiscal year.
  const [defFrom, defTo] = r === "tax" ? periodRange(today, 1, 1) : [fyFrom, fyTo];
  let from = typeof sp.from === "string" && YMD.test(sp.from) ? sp.from : defFrom;
  let to = typeof sp.to === "string" && YMD.test(sp.to) ? sp.to : defTo;
  if (to < from) [from, to] = [to, from];
  const money = (v: number) => formatMoney(v, cur);
  const range = `${formatDate(from)} – ${formatDate(to)}`;
  const q = (key: string) => `/app/finance/reports?${new URLSearchParams({ r: key, from, to })}`;

  let body: React.ReactNode;

  if (r === "pl") {
    const p = await profitAndLoss(orgId, from, to);
    const cols = p.months;
    const section = (title: string, rows: PlRow[]) => (
      <>
        <tr>
          <td colSpan={cols.length + 2} className="bg-paper/70 px-5 py-2 font-mono text-[11px] tracking-widest text-ink-mute uppercase">
            {title}
          </td>
        </tr>
        {rows.length === 0 && (
          <tr>
            <td className="border-b border-line/70 px-5 py-3 text-ink-mute" colSpan={cols.length + 2}>
              None in this period
            </td>
          </tr>
        )}
        {rows.map((row) => (
          <tr key={row.id}>
            <Td className="whitespace-nowrap">
              <span className="text-ink-mute">{row.code}</span> {row.name}
            </Td>
            {cols.map((m) => (
              <Td key={m} className="text-right tabular-nums">
                {row.byMonth[m] ? money(row.byMonth[m]) : "—"}
              </Td>
            ))}
            <Td className="text-right font-medium tabular-nums">{money(row.total)}</Td>
          </tr>
        ))}
      </>
    );
    const totalRow = (label: string, t: { byMonth: Record<string, number>; total: number }, strong = false) => (
      <tr className={cn("bg-paper/40", strong && "bg-lime/30")}>
        <Td className="font-semibold">{label}</Td>
        {cols.map((m) => (
          <Td key={m} className="text-right font-semibold tabular-nums">
            {money(t.byMonth[m] ?? 0)}
          </Td>
        ))}
        <Td className="text-right font-bold tabular-nums">{money(t.total)}</Td>
      </tr>
    );
    body = (
      <>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Income" value={money(p.totals.income.total)} tone="mint" />
          <Stat label="Gross profit" value={money(p.totals.gross.total)} tone="sky" />
          <Stat label="Net profit" value={money(p.totals.net.total)} tone={p.totals.net.total >= 0 ? "lime" : "rose"} />
        </div>
        <Card>
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr>
                  <Th>Account</Th>
                  {cols.map((m) => (
                    <Th key={m} className="text-right">
                      {formatPeriod(m)}
                    </Th>
                  ))}
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {section("Income", p.income)}
                {totalRow("Total income", p.totals.income)}
                {section("Cost of goods sold", p.cogs)}
                {totalRow("Gross profit", p.totals.gross)}
                {section("Expenses", p.expenses)}
                {totalRow("Total expenses", p.totals.expenses)}
                {totalRow("Net profit", p.totals.net, true)}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  } else if (r === "bs") {
    const b = await balanceSheet(orgId, from, to);
    const list = (rows: { id: number; code: string; name: string; balance: number }[]) =>
      rows.map((a) => (
        <tr key={a.id}>
          <Td>
            <span className="text-ink-mute">{a.code}</span> {a.name}
          </Td>
          <Td className="text-right tabular-nums">{money(a.balance)}</Td>
        </tr>
      ));
    const total = (label: string, v: number) => (
      <tr className="bg-paper/40">
        <Td className="font-semibold">{label}</Td>
        <Td className="text-right font-bold tabular-nums">{money(v)}</Td>
      </tr>
    );
    body = (
      <>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Assets">
            <Table compact>
              <tbody>
                {list(b.assets)}
                {total("Total assets", b.totals.assets)}
              </tbody>
            </Table>
          </Card>
          <div className="space-y-6">
            <Card title="Liabilities">
              <Table compact>
                <tbody>
                  {list(b.liabilities)}
                  {total("Total liabilities", b.totals.liabilities)}
                </tbody>
              </Table>
            </Card>
            <Card title="Equity">
              <Table compact>
                <tbody>
                  {list(b.equity)}
                  <tr>
                    <Td>Retained earnings (before {formatDate(from)})</Td>
                    <Td className="text-right tabular-nums">{money(b.priorEarnings)}</Td>
                  </tr>
                  <tr>
                    <Td>Current-period earnings</Td>
                    <Td className="text-right tabular-nums">{money(b.currentEarnings)}</Td>
                  </tr>
                  {total("Total equity", b.totals.equity)}
                </tbody>
              </Table>
            </Card>
          </div>
        </div>
        <Check ok={b.balanced}>
          Assets {money(b.totals.assets)} = Liabilities {money(b.totals.liabilities)} + Equity {money(b.totals.equity)}
        </Check>
      </>
    );
  } else if (r === "tb") {
    const t = await trialBalance(orgId, to);
    body = (
      <>
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Account</Th>
                <Th>Type</Th>
                <Th className="text-right">Debit</Th>
                <Th className="text-right">Credit</Th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((a) => (
                <tr key={a.id}>
                  <Td className="text-ink-mute">{a.code}</Td>
                  <Td>
                    <Link href={`/app/finance/accounts/${a.id}`} className="hover:underline">
                      {a.name}
                    </Link>
                  </Td>
                  <Td className="capitalize text-ink-soft">{a.type}</Td>
                  <Td className="text-right tabular-nums">{a.debitBal ? money(a.debitBal) : "—"}</Td>
                  <Td className="text-right tabular-nums">{a.creditBal ? money(a.creditBal) : "—"}</Td>
                </tr>
              ))}
              <tr className="bg-paper/40 font-semibold">
                <Td />
                <Td>Total</Td>
                <Td />
                <Td className="text-right tabular-nums">{money(t.debit)}</Td>
                <Td className="text-right tabular-nums">{money(t.credit)}</Td>
              </tr>
            </tbody>
          </Table>
        </Card>
        <Check ok={t.balanced}>
          Debits {money(t.debit)} = Credits {money(t.credit)}
        </Check>
      </>
    );
  } else if (r === "aging") {
    const a = await receivables(orgId, today);
    body =
      a.customers.length === 0 ? (
        <EmptyState title="No outstanding receivables" />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                {AGING_BUCKETS.map((b) => (
                  <Th key={b} className="text-right">
                    {AGING_LABEL[b]}
                  </Th>
                ))}
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {a.customers.map((c) => (
                <tr key={c.customer}>
                  <Td className="font-medium">{c.customer}</Td>
                  {AGING_BUCKETS.map((b) => (
                    <Td key={b} className="text-right tabular-nums">
                      {c.buckets[b] ? money(c.buckets[b]) : "—"}
                    </Td>
                  ))}
                  <Td className="text-right font-medium tabular-nums">{money(c.total)}</Td>
                </tr>
              ))}
              <tr className="bg-paper/40 font-semibold">
                <Td>Total</Td>
                {AGING_BUCKETS.map((b) => (
                  <Td key={b} className="text-right tabular-nums">
                    {money(a.totals[b])}
                  </Td>
                ))}
                <Td className="text-right tabular-nums">{money(a.total)}</Td>
              </tr>
            </tbody>
          </Table>
        </Card>
      );
  } else if (r === "tax") {
    const { input, counts } = await loadTaxReturnInput(orgId, ws.org.state, from, to);
    const ret = taxReturn(pack, input);
    let ct: React.ReactNode = null;
    if (pack.corporateTax) {
      const fy = fiscalYearFor(to, ws.org.fiscalYearStart);
      const p = await profitAndLoss(orgId, fy[0], fy[1]);
      ct = <CorporateTaxCard est={corporateTaxEstimate(p.totals.net.total, pack.corporateTax)} fy={fy} note={pack.corporateTax.note} currency={cur} />;
    }
    const quick: [string, [string, string]][] = [
      ["This month", periodRange(today, 1)],
      ["Last month", periodRange(today, 1, 1)],
      ["This quarter", periodRange(today, 3)],
      ["Last quarter", periodRange(today, 3, 1)],
    ];
    body = (
      <>
        <div className="mb-4 flex flex-wrap gap-1.5 print:hidden">
          {quick.map(([label, [f, t]]) => (
            <Link
              key={label}
              href={`/app/finance/reports?${new URLSearchParams({ r: "tax", from: f, to: t })}`}
              className={cn("rounded-full border px-3 py-1 text-xs transition", f === from && t === to ? "border-ink bg-ink/5 font-medium" : "border-line hover:border-ink")}
            >
              {label}
            </Link>
          ))}
        </div>
        <TaxReturnView ret={ret} pack={pack} currency={cur} counts={counts} />
        {ct}
      </>
    );
  } else if (r === "gst") {
    const g = await gstSummary(orgId, from, to);
    body = (
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Month</Th>
              <Th className="text-right">Output {pack.tax.name} (collected)</Th>
              <Th className="text-right">Input {pack.tax.name} (credit)</Th>
              <Th className="text-right">Net payable</Th>
            </tr>
          </thead>
          <tbody>
            {g.rows.map((row) => (
              <tr key={row.month}>
                <Td>{formatPeriod(row.month)}</Td>
                <Td className="text-right tabular-nums">{money(row.output)}</Td>
                <Td className="text-right tabular-nums">{money(row.input)}</Td>
                <Td className="text-right tabular-nums">{money(row.net)}</Td>
              </tr>
            ))}
            <tr className="bg-paper/40 font-semibold">
              <Td>Total</Td>
              <Td className="text-right tabular-nums">{money(g.totals.output)}</Td>
              <Td className="text-right tabular-nums">{money(g.totals.input)}</Td>
              <Td className="text-right tabular-nums">{money(g.totals.net)}</Td>
            </tr>
          </tbody>
        </Table>
      </Card>
    );
  } else {
    const c = await cashMovement(orgId, from, to);
    body = (
      <>
        <div className="mb-4 grid gap-4 sm:grid-cols-4">
          <Stat label="Opening" value={money(c.opening)} tone="card" />
          <Stat label="Inflow" value={money(c.inflow)} tone="mint" />
          <Stat label="Outflow" value={money(c.outflow)} tone="peach" />
          <Stat label="Closing" value={money(c.closing)} tone="lime" />
        </div>
        <Card>
          {c.lines.length === 0 ? (
            <EmptyState title="No bank movements in this period" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Memo</Th>
                  <Th className="text-right">In</Th>
                  <Th className="text-right">Out</Th>
                  <Th className="text-right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-paper/40">
                  <td colSpan={4} className="border-b border-line/70 px-5 py-3 text-ink-soft">
                    Opening balance
                  </td>
                  <Td className="text-right tabular-nums">{money(c.opening)}</Td>
                </tr>
                {c.lines.map((l) => (
                  <tr key={l.lineId}>
                    <Td className="whitespace-nowrap">{formatDate(l.date)}</Td>
                    <Td>{l.memo}</Td>
                    <Td className="text-right tabular-nums">{l.debit ? money(l.debit) : "—"}</Td>
                    <Td className="text-right tabular-nums">{l.credit ? money(l.credit) : "—"}</Td>
                    <Td className="text-right tabular-nums">{money(l.balance)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </>
    );
  }

  const asOfOnly = r === "bs" || r === "tb";
  return (
    <>
      <PageHeader
        title="Reports"
        description={`${REPORTS.find((x) => x.key === r)?.label} · ${r === "aging" ? `as of ${formatDate(today)}` : asOfOnly ? `as of ${formatDate(to)}` : range}`}
        tabs={FINANCE_TABS("reports")}
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap gap-1.5">
          {REPORTS.map((x) => (
            <Link key={x.key} href={q(x.key)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", r === x.key ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}>
              {x.label}
            </Link>
          ))}
        </div>
        {r !== "aging" && (
          <form action="/app/finance/reports" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="r" value={r} />
            <label className="text-xs text-ink-soft">
              From
              <input type="date" name="from" defaultValue={from} className="mt-1 block h-9 rounded-xl border border-line bg-paper/60 px-2 text-sm" />
            </label>
            <label className="text-xs text-ink-soft">
              To
              <input type="date" name="to" defaultValue={to} className="mt-1 block h-9 rounded-xl border border-line bg-paper/60 px-2 text-sm" />
            </label>
            <button className="h-9 rounded-full border border-ink/20 px-4 text-sm font-medium hover:border-ink">Apply</button>
          </form>
        )}
      </div>
      {body}
    </>
  );
}
