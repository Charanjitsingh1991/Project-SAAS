import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { PageHeader, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { fiscalYearFor } from "@/lib/countries";
import { AGING_BUCKETS, AGING_LABEL } from "@/lib/finance-utils";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { buildStatement } from "@/lib/statements";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { PrintButton } from "../../_components/print-button";
import { FINANCE_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Customer statement" };

const validYmd = (v: string | string[] | undefined) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null;

export default async function StatementPage({ params, searchParams }: PageProps<"/app/finance/statements/[companyId]">) {
  const ws = await requireWorkspace({ module: "finance" });
  const companyId = Number((await params).companyId);
  if (!Number.isInteger(companyId)) notFound();
  const orgId = ws.org.id;
  const [company] = await db.select().from(schema.companies).where(and(eq(schema.companies.id, companyId), eq(schema.companies.orgId, orgId))).limit(1);
  if (!company) notFound();

  const sp = await searchParams;
  const today = todayYmd();
  let from = validYmd(sp.from) ?? fiscalYearFor(today, ws.org.fiscalYearStart)[0];
  let to = validYmd(sp.to) ?? today;
  if (from > to) [from, to] = [to, from];

  const pack = packFor(ws);
  const cur = ws.org.currency;
  const invoices = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.orgId, orgId), eq(schema.invoices.companyId, company.id)))
    .orderBy(asc(schema.invoices.issueDate));
  const ids = invoices.map((i) => i.id);
  const [payments, creditNotes] = ids.length
    ? await Promise.all([
        db.select().from(schema.payments).where(and(eq(schema.payments.orgId, orgId), inArray(schema.payments.invoiceId, ids))),
        db.select().from(schema.creditNotes).where(and(eq(schema.creditNotes.orgId, orgId), inArray(schema.creditNotes.invoiceId, ids))),
      ])
    : [[], []];

  const st = buildStatement({ invoices, payments, creditNotes }, from, to);
  const address = company.billingAddress || [company.city, company.state].filter(Boolean).join(", ");

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Statement · ${company.name}`}
          description={`${formatDate(from)} – ${formatDate(to)}`}
          tabs={FINANCE_TABS("statements")}
          actions={
            <>
              <PrintButton />
              <Link href="/app/finance/statements" className="inline-flex h-9 items-center rounded-full border border-ink/20 px-4 text-sm font-medium hover:border-ink">
                All customers
              </Link>
            </>
          }
        />
        <form method="get" className="mb-6 flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-ink-soft">From</span>
            <input type="date" name="from" defaultValue={from} className="h-9 rounded-full border border-ink/20 bg-card px-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-soft">To</span>
            <input type="date" name="to" defaultValue={to} className="h-9 rounded-full border border-ink/20 bg-card px-3" />
          </label>
          <button type="submit" className="h-9 rounded-full bg-ink px-5 font-medium text-paper hover:bg-ink/85">
            Apply
          </button>
        </form>
      </div>

      <article className="rounded-[20px] border border-line bg-card p-6 md:p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
          <div>
            <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Statement of account</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">{ws.org.name}</h2>
            {ws.org.address && <p className="mt-1 max-w-xs text-sm whitespace-pre-line text-ink-soft">{ws.org.address}</p>}
            <p className="mt-1 text-sm text-ink-soft">
              {ws.org.gstin && (
                <>
                  {pack.tax.idLabel} {ws.org.gstin}
                </>
              )}
              {ws.org.gstin && ws.org.state && " · "}
              {ws.org.state}
            </p>
          </div>
          <dl className="text-sm">
            <div className="flex justify-between gap-8">
              <dt className="text-ink-soft">Period</dt>
              <dd>
                {formatDate(from)} – {formatDate(to)}
              </dd>
            </div>
            <div className="flex justify-between gap-8">
              <dt className="text-ink-soft">Statement date</dt>
              <dd>{formatDate(today)}</dd>
            </div>
          </dl>
        </header>

        <section className="border-b border-line py-6">
          <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Customer</p>
          <p className="mt-1 font-medium">{company.name}</p>
          {address && <p className="text-sm whitespace-pre-line text-ink-soft">{address}</p>}
          {company.gstin && (
            <p className="text-sm text-ink-soft">
              {pack.tax.idLabel} {company.gstin}
            </p>
          )}
        </section>

        <div className="overflow-x-auto py-6">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr>
                <Th className="px-2">Date</Th>
                <Th className="px-2">Reference</Th>
                <Th className="px-2">Description</Th>
                <Th className="px-2 text-right">Debit</Th>
                <Th className="px-2 text-right">Credit</Th>
                <Th className="px-2 text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td className="px-2 whitespace-nowrap">{formatDate(from)}</Td>
                <Td className="px-2" />
                <Td className="px-2 text-ink-soft">Opening balance</Td>
                <Td className="px-2" />
                <Td className="px-2" />
                <Td className="px-2 text-right font-medium tabular-nums">{formatMoney(st.openingBalance, cur)}</Td>
              </tr>
              {st.rows.map((r, i) => (
                <tr key={i}>
                  <Td className="px-2 whitespace-nowrap">{formatDate(r.date)}</Td>
                  <Td className="px-2">{r.ref}</Td>
                  <Td className="px-2 text-ink-soft">{r.description}</Td>
                  <Td className="px-2 text-right tabular-nums">{r.debit ? formatMoney(r.debit, cur) : ""}</Td>
                  <Td className="px-2 text-right tabular-nums">{r.credit ? formatMoney(r.credit, cur) : ""}</Td>
                  <Td className="px-2 text-right tabular-nums">{formatMoney(r.balance, cur)}</Td>
                </tr>
              ))}
              {st.rows.length === 0 && (
                <tr>
                  <Td className="px-2 text-ink-soft" />
                  <Td className="px-2 text-ink-soft" />
                  <Td className="px-2 text-ink-soft">No transactions in this period.</Td>
                  <Td className="px-2" />
                  <Td className="px-2" />
                  <Td className="px-2" />
                </tr>
              )}
              <tr className="font-semibold">
                <Td className="px-2" />
                <Td className="px-2" />
                <Td className="px-2">Closing balance</Td>
                <Td className="px-2 text-right tabular-nums">{formatMoney(st.totalDebit, cur)}</Td>
                <Td className="px-2 text-right tabular-nums">{formatMoney(st.totalCredit, cur)}</Td>
                <Td className="px-2 text-right tabular-nums">{formatMoney(st.closingBalance, cur)}</Td>
              </tr>
            </tbody>
          </table>
        </div>

        <section className="border-t border-line pt-6">
          <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Aging of open invoices as of {formatDate(to)}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
            {AGING_BUCKETS.map((b) => (
              <div key={b}>
                <p className="text-ink-soft">{AGING_LABEL[b]}</p>
                <p className="font-medium tabular-nums">{formatMoney(st.aging[b], cur)}</p>
              </div>
            ))}
            <div>
              <p className="text-ink-soft">Total due</p>
              <p className="font-semibold tabular-nums">{formatMoney(st.agingTotal, cur)}</p>
            </div>
          </div>
        </section>
      </article>
    </>
  );
}
