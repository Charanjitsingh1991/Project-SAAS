import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { Download, Plus } from "lucide-react";
import { Kanban, type KanbanColumn } from "@/components/app/kanban";
import { StatusSelect } from "@/components/app/forms";
import { Badge, Card, PageHeader, Stat } from "@/components/app/ui";
import { db, schema } from "@/db";
import { DEAL_STAGES, type DealStage } from "@/db/schema";
import { avgCycleDays, avgDealSize, daysSince, leadScore, STUCK_DAYS, valuePercentile, winRate } from "@/lib/crm";
import { formatDate, formatMoney, formatMoneyCompact, initials, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { moveDeal } from "./actions";
import { getCompanyOptions, getContactOptions, getMembers, getScoreContext, nowMs } from "./data";
import { DealForm, ScoreChip } from "./parts";
import { CRM_TABS } from "./tabs";

export const metadata: Metadata = { title: "Pipeline" };

const TONES: Record<DealStage, string> = { lead: "bg-card", qualified: "bg-sky", proposal: "bg-butter", negotiation: "bg-peach", won: "bg-mint", lost: "bg-rose" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ owner?: string; q?: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const sp = await searchParams;
  const mine = sp.owner === "me";
  const q = (sp.q ?? "").trim();
  const cur = ws.org.currency;
  const orgId = ws.org.id;

  const conds = [eq(schema.deals.orgId, orgId)];
  if (mine) conds.push(eq(schema.deals.ownerId, ws.user.id));
  if (q) conds.push(or(like(schema.deals.title, `%${q}%`), like(schema.companies.name, `%${q}%`))!);

  const nowMs = nowMs();
  const today = todayYmd();
  const [rows, members, companies, contacts, sc, contactRows] = await Promise.all([
    db
      .select({ deal: schema.deals, company: schema.companies.name, ownerName: schema.users.name })
      .from(schema.deals)
      .leftJoin(schema.companies, eq(schema.deals.companyId, schema.companies.id))
      .leftJoin(schema.users, eq(schema.deals.ownerId, schema.users.id))
      .where(and(...conds))
      .orderBy(desc(schema.deals.sortOrder), desc(schema.deals.createdAt)),
    getMembers(orgId),
    getCompanyOptions(orgId),
    getContactOptions(orgId),
    getScoreContext(orgId, nowMs),
    db.select({ id: schema.contacts.id, email: schema.contacts.email, phone: schema.contacts.phone }).from(schema.contacts).where(eq(schema.contacts.orgId, orgId)).orderBy(asc(schema.contacts.id)),
  ]);
  const contactById = new Map(contactRows.map((c) => [c.id, c]));

  const open = rows.filter((r) => r.deal.stage !== "won" && r.deal.stage !== "lost");
  const won = rows.filter((r) => r.deal.stage === "won");
  const lost = rows.filter((r) => r.deal.stage === "lost");
  const openValue = open.reduce((s, r) => s + r.deal.value, 0);
  const weighted = open.reduce((s, r) => s + Math.round((r.deal.value * r.deal.probability) / 100), 0);
  const rate = winRate(won.length, lost.length);
  const cycle = avgCycleDays(
    won.filter((r) => r.deal.closedAt).map((r) => ({ created: r.deal.createdAt.toISOString().slice(0, 10), closed: r.deal.closedAt!.toISOString().slice(0, 10) })),
  );

  const columns: KanbanColumn[] = DEAL_STAGES.map((s) => {
    const inStage = rows.filter((r) => r.deal.stage === s);
    return { key: s, label: s, tone: TONES[s], meta: formatMoneyCompact(inStage.reduce((t, r) => t + r.deal.value, 0), cur) };
  });

  const items = rows.map(({ deal: d, company, ownerName }) => {
    const days = daysSince(d.stageChangedAt, nowMs);
    const isOpen = d.stage !== "won" && d.stage !== "lost";
    const stuck = isOpen && days > STUCK_DAYS;
    const overdue = isOpen && !!d.expectedClose && d.expectedClose < today;
    const ct = d.contactId ? contactById.get(d.contactId) : undefined;
    const score = leadScore({
      hasEmail: !!ct?.email,
      hasPhone: !!ct?.phone,
      hasCompany: !!d.companyId,
      valuePercentile: valuePercentile(d.value, sc.allValues),
      recentActivity: sc.activeDeals.has(d.id),
      daysInStage: isOpen ? days : null,
    });
    return {
      id: d.id,
      column: d.stage,
      node: (
        <article className="rounded-2xl border border-line bg-card p-3 shadow-sm">
          <Link href={`/app/crm/deals/${d.id}`} className="block text-sm font-semibold hover:underline">
            {d.title}
          </Link>
          <p className="mt-0.5 truncate text-xs text-ink-soft">{company ?? "No company"}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="font-display text-base font-bold">{formatMoney(d.value, cur)}</span>
            {ownerName && (
              <span title={ownerName} className="grid size-7 place-items-center rounded-full bg-ink text-[10px] font-medium text-paper">
                {initials(ownerName)}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={cn(overdue ? "font-medium text-signal" : "text-ink-mute")}>{d.expectedClose ? `Close ${formatDate(d.expectedClose)}` : "No close date"}</span>
            {isOpen && <span className="text-ink-mute">· {days}d in stage</span>}
            {stuck && <Badge tone="rose">stuck</Badge>}
            <ScoreChip score={score} />
          </div>
          <div className="mt-2">
            <StatusSelect action={moveDeal} id={d.id} value={d.stage} options={DEAL_STAGES} name="stage" label={`Stage for ${d.title}`} />
          </div>
        </article>
      ),
    };
  });

  const chip = (href: string, active: boolean, label: string) => (
    <Link href={href} className={cn("rounded-full border px-3 py-1.5 text-sm", active ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}>
      {label}
    </Link>
  );
  const qs = (owner: string) => `/app/crm?${new URLSearchParams({ owner, ...(q ? { q } : {}) }).toString()}`;

  return (
    <>
      <PageHeader
        title="CRM"
        description="Drag deals through your pipeline. Winning one drafts the invoice and opens the project."
        tabs={CRM_TABS("pipeline")}
        actions={
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download */}
          <a href="/api/export/deals" className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
            <Download className="size-4" /> Export CSV
          </a>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Open pipeline" value={formatMoneyCompact(openValue, cur)} hint={`${open.length} open deals`} tone="sky" />
        <Stat label="Weighted forecast" value={formatMoneyCompact(weighted, cur)} hint="Value × probability" tone="butter" />
        <Stat label="Win rate" value={rate === null ? "—" : `${rate}%`} hint={`${won.length} won · ${lost.length} lost`} tone="mint" />
        <Stat label="Avg deal size" value={won.length ? formatMoneyCompact(avgDealSize(won.map((r) => r.deal.value)), cur) : "—"} hint="Won deals" />
        <Stat label="Avg sales cycle" value={cycle === null ? "—" : `${cycle}d`} hint="Created → won" />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {chip(qs("all"), !mine, "All deals")}
          {chip(qs("me"), mine, "My deals")}
        </div>
        <form className="flex gap-2">
          {mine && <input type="hidden" name="owner" value="me" />}
          <input name="q" defaultValue={q} placeholder="Search deals or companies" className="h-10 w-64 max-w-full rounded-full border border-line bg-paper/60 px-4 text-sm outline-none focus:border-ink" />
          <button className="h-10 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">Search</button>
        </form>
      </div>

      <Kanban columns={columns} items={items} onMove={moveDeal} field="stage" />

      <details className="mt-8 rounded-[20px] border border-line bg-card" id="new">
        <summary className="flex cursor-pointer items-center gap-2 px-5 py-3.5 font-display text-base font-semibold">
          <Plus className="size-4" /> New deal
        </summary>
        <div className="border-t border-line p-5">
          <DealForm companies={companies} contacts={contacts} members={members} ownerDefault={ws.user.id} />
        </div>
      </details>
      {rows.length === 0 && (
        <Card className="mt-6">
          <p className="text-sm text-ink-soft">{q || mine ? "No deals match these filters." : "No deals yet — create your first one above."}</p>
        </Card>
      )}
    </>
  );
}
