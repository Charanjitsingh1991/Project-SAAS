import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, like, or } from "drizzle-orm";
import { Download, Plus, Upload } from "lucide-react";
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { LIFECYCLES } from "@/db/schema";
import { daysSince, leadScore, valuePercentile } from "@/lib/crm";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { getCompanyOptions, getMembers, getScoreContext, wallClock } from "../data";
import { ContactForm, ScoreChip } from "../parts";
import { CRM_TABS } from "../tabs";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; lifecycle?: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const lifecycle = LIFECYCLES.find((l) => l === sp.lifecycle);
  const orgId = ws.org.id;
  const nowMs = wallClock();

  const conds = [eq(schema.contacts.orgId, orgId)];
  if (lifecycle) conds.push(eq(schema.contacts.lifecycle, lifecycle));
  if (q) conds.push(or(like(schema.contacts.name, `%${q}%`), like(schema.contacts.email, `%${q}%`), like(schema.companies.name, `%${q}%`))!);

  const [rows, deals, sc, companies, members] = await Promise.all([
    db
      .select({ contact: schema.contacts, company: schema.companies.name })
      .from(schema.contacts)
      .leftJoin(schema.companies, eq(schema.contacts.companyId, schema.companies.id))
      .where(and(...conds))
      .orderBy(asc(schema.contacts.name)),
    db.select({ contactId: schema.deals.contactId, stage: schema.deals.stage, value: schema.deals.value, stageChangedAt: schema.deals.stageChangedAt }).from(schema.deals).where(eq(schema.deals.orgId, orgId)),
    getScoreContext(orgId, nowMs),
    getCompanyOptions(orgId),
    getMembers(orgId),
  ]);

  const dealsOf = new Map<number, typeof deals>();
  for (const d of deals) if (d.contactId) dealsOf.set(d.contactId, [...(dealsOf.get(d.contactId) ?? []), d]);

  const scored = rows.map(({ contact: c, company }) => {
    const mine = dealsOf.get(c.id) ?? [];
    const openDeals = mine.filter((d) => d.stage !== "won" && d.stage !== "lost");
    const best = [...openDeals].sort((a, b) => b.value - a.value)[0];
    const score = leadScore({
      hasEmail: !!c.email,
      hasPhone: !!c.phone,
      hasCompany: !!c.companyId,
      valuePercentile: best ? valuePercentile(best.value, sc.allValues) : 0,
      recentActivity: sc.activeContacts.has(c.id),
      daysInStage: openDeals.length ? Math.max(...openDeals.map((d) => daysSince(d.stageChangedAt, nowMs))) : null,
    });
    return { c, company, score, deals: mine.length };
  });

  const tab = (value: string | undefined, label: string) => (
    <Link
      key={label}
      href={`/app/crm/contacts?${new URLSearchParams({ ...(value ? { lifecycle: value } : {}), ...(q ? { q } : {}) }).toString()}`}
      className={cn("rounded-full border px-3 py-1.5 text-sm capitalize", lifecycle === value ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="CRM"
        description="People you sell to, ranked by a rule-based lead score."
        tabs={CRM_TABS("contacts")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/crm/contacts/import" className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
              <Upload className="size-4" /> Import CSV
            </Link>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download */}
            <a href="/api/export/contacts" className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
              <Download className="size-4" /> Export CSV
            </a>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {tab(undefined, "All")}
          {LIFECYCLES.map((l) => tab(l, l))}
        </div>
        <form className="flex gap-2">
          {lifecycle && <input type="hidden" name="lifecycle" value={lifecycle} />}
          <input name="q" defaultValue={q} placeholder="Search name, email or company" className="h-10 w-64 max-w-full rounded-full border border-line bg-paper/60 px-4 text-sm outline-none focus:border-ink" />
          <button className="h-10 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">Search</button>
        </form>
      </div>

      <Card title={`Contacts (${scored.length})`}>
        {scored.length === 0 ? (
          <EmptyState title={q || lifecycle ? "No contacts match" : "No contacts yet"}>{q || lifecycle ? "Try different filters." : "Add your first contact below."}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Company</Th>
                <Th>Email</Th>
                <Th>Lifecycle</Th>
                <Th>Source</Th>
                <Th>Deals</Th>
                <Th>Score</Th>
              </tr>
            </thead>
            <tbody>
              {scored.map(({ c, company, score, deals: n }) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/app/crm/contacts/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    {c.title && <p className="text-xs text-ink-mute">{c.title}</p>}
                  </Td>
                  <Td className="text-ink-soft">{company ?? "—"}</Td>
                  <Td className="text-ink-soft">{c.email ?? "—"}</Td>
                  <Td>
                    <StatusBadge value={c.lifecycle} />
                  </Td>
                  <Td className="text-ink-soft capitalize">{c.source}</Td>
                  <Td>{n}</Td>
                  <Td>
                    <ScoreChip score={score} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <details className="mt-8 rounded-[20px] border border-line bg-card">
        <summary className="flex cursor-pointer items-center gap-2 px-5 py-3.5 font-display text-base font-semibold">
          <Plus className="size-4" /> Add contact
        </summary>
        <div className="border-t border-line p-5">
          <ContactForm companies={companies} members={members} />
        </div>
      </details>
    </>
  );
}
