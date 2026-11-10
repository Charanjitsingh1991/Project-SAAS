import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Stat } from "@/components/app/ui";
import { db, schema } from "@/db";
import { avgCycleDays, avgDealSize, monthKeys, weightedForecast, winRate } from "@/lib/crm";
import { formatMoney, formatMoneyCompact, formatPeriod, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { CRM_TABS } from "../tabs";

export const metadata: Metadata = { title: "Forecast" };

function Bar({ pct, className = "bg-ink" }: { pct: number; className?: string }) {
  return (
    <div className="h-3 flex-1 overflow-hidden rounded-full bg-paper-2">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

export default async function ForecastPage() {
  const ws = await requireWorkspace({ module: "crm" });
  const cur = ws.org.currency;
  const orgId = ws.org.id;
  const today = todayYmd();

  const [deals, companies] = await Promise.all([
    db.select().from(schema.deals).where(eq(schema.deals.orgId, orgId)),
    db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.orgId, orgId)),
  ]);

  const open = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const won = deals.filter((d) => d.stage === "won");
  const lost = deals.filter((d) => d.stage === "lost");
  const months = weightedForecast(open, monthKeys(today, 6));
  const maxMonth = Math.max(1, ...months.map((m) => m.total));
  const outside = open.filter((d) => !d.expectedClose || !months.some((m) => m.month === d.expectedClose!.slice(0, 7)));

  const cycle = avgCycleDays(won.filter((d) => d.closedAt).map((d) => ({ created: d.createdAt.toISOString().slice(0, 10), closed: d.closedAt!.toISOString().slice(0, 10) })));
  const rate = winRate(won.length, lost.length);

  const reasons = new Map<string, { n: number; value: number }>();
  for (const d of lost) {
    const k = d.lostReason || "Not specified";
    const r = reasons.get(k) ?? { n: 0, value: 0 };
    r.n++;
    r.value += d.value;
    reasons.set(k, r);
  }
  const reasonRows = [...reasons.entries()].sort((a, b) => b[1].n - a[1].n);

  const sources = new Map<string, { n: number; value: number; won: number }>();
  for (const d of deals) {
    const s = sources.get(d.source) ?? { n: 0, value: 0, won: 0 };
    s.n++;
    s.value += d.value;
    if (d.stage === "won") s.won++;
    sources.set(d.source, s);
  }
  const sourceRows = [...sources.entries()].sort((a, b) => b[1].value - a[1].value);
  const maxSource = Math.max(1, ...sourceRows.map(([, s]) => s.value));

  const byCompany = new Map<number, number>();
  for (const d of open) if (d.companyId) byCompany.set(d.companyId, (byCompany.get(d.companyId) ?? 0) + d.value);
  const nameOf = new Map(companies.map((c) => [c.id, c.name]));
  const top = [...byCompany.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxTop = Math.max(1, ...top.map(([, v]) => v));

  return (
    <>
      <PageHeader title="CRM" description="Weighted pipeline by expected-close month, and how you win and lose." tabs={CRM_TABS("forecast")} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Weighted (6 mo)" value={formatMoneyCompact(months.reduce((s, m) => s + m.weighted, 0), cur)} tone="butter" hint={`${months.reduce((s, m) => s + m.count, 0)} deals closing`} />
        <Stat label="Win rate" value={rate === null ? "—" : `${rate}%`} tone="mint" hint={`${won.length} won · ${lost.length} lost`} />
        <Stat label="Avg deal size" value={won.length ? formatMoneyCompact(avgDealSize(won.map((d) => d.value)), cur) : "—"} hint="Won deals" />
        <Stat label="Sales cycle" value={cycle === null ? "—" : `${cycle} days`} hint="Created → won" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Weighted pipeline by expected close" className="xl:col-span-2">
          <ul className="space-y-3">
            {months.map((m) => (
              <li key={m.month} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[88px_1fr_220px]">
                <span className="font-mono text-xs text-ink-soft">{formatPeriod(m.month)}</span>
                <div className="relative flex h-3 items-center">
                  <div className="absolute inset-0 overflow-hidden rounded-full bg-paper-2">
                    <div className="h-full rounded-full bg-ink/20" style={{ width: `${(m.total / maxMonth) * 100}%` }} />
                  </div>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${(m.weighted / maxMonth) * 100}%` }} />
                </div>
                <span className="text-right whitespace-nowrap">
                  <strong>{formatMoney(m.weighted, cur)}</strong> <span className="text-xs text-ink-mute">of {formatMoneyCompact(m.total, cur)} · {m.count}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-mute">
            Dark bar = weighted (value × probability), light bar = total value.
            {outside.length > 0 && ` ${outside.length} open deal${outside.length === 1 ? "" : "s"} without an expected close in this window are excluded.`}
          </p>
        </Card>

        <Card title="Lost reasons">
          {reasonRows.length === 0 ? (
            <EmptyState title="No lost deals" />
          ) : (
            <ul className="space-y-3 text-sm">
              {reasonRows.map(([reason, r]) => (
                <li key={reason} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate" title={reason}>{reason}</span>
                  <Bar pct={(r.n / lost.length) * 100} className="bg-signal" />
                  <span className="w-24 text-right text-xs text-ink-soft">{r.n} · {formatMoneyCompact(r.value, cur)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Deals by source">
          {sourceRows.length === 0 ? (
            <EmptyState title="No deals yet" />
          ) : (
            <ul className="space-y-3 text-sm">
              {sourceRows.map(([source, s]) => (
                <li key={source} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 capitalize">{source}</span>
                  <Bar pct={(s.value / maxSource) * 100} />
                  <span className="w-32 text-right text-xs text-ink-soft">{s.n} deals · {formatMoneyCompact(s.value, cur)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Top companies by open pipeline" className="xl:col-span-2">
          {top.length === 0 ? (
            <EmptyState title="No open pipeline" />
          ) : (
            <ul className="space-y-3 text-sm">
              {top.map(([id, value]) => (
                <li key={id} className="flex items-center gap-3">
                  <Link href={`/app/crm/companies/${id}`} className="w-48 shrink-0 truncate font-medium hover:underline">
                    {nameOf.get(id) ?? "Unknown"}
                  </Link>
                  <Bar pct={(value / maxTop) * 100} className="bg-ink" />
                  <span className="w-24 text-right text-xs text-ink-soft">{formatMoney(value, cur)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
