import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, like, or } from "drizzle-orm";
import { Download, Plus } from "lucide-react";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { getMembers } from "../data";
import { CompanyForm } from "../parts";
import { CRM_TABS } from "../tabs";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const q = ((await searchParams).q ?? "").trim();
  const orgId = ws.org.id;

  const conds = [eq(schema.companies.orgId, orgId)];
  if (q) conds.push(or(like(schema.companies.name, `%${q}%`), like(schema.companies.industry, `%${q}%`), like(schema.companies.city, `%${q}%`))!);

  const [companies, contacts, deals, members] = await Promise.all([
    db.select().from(schema.companies).where(and(...conds)).orderBy(asc(schema.companies.name)),
    db.select({ companyId: schema.contacts.companyId }).from(schema.contacts).where(eq(schema.contacts.orgId, orgId)),
    db.select({ companyId: schema.deals.companyId, stage: schema.deals.stage, value: schema.deals.value }).from(schema.deals).where(eq(schema.deals.orgId, orgId)),
    getMembers(orgId),
  ]);

  const stats = new Map<number, { contacts: number; deals: number; pipeline: number }>();
  const get = (id: number) => stats.get(id) ?? stats.set(id, { contacts: 0, deals: 0, pipeline: 0 }).get(id)!;
  for (const c of contacts) if (c.companyId) get(c.companyId).contacts++;
  for (const d of deals) {
    if (!d.companyId) continue;
    const s = get(d.companyId);
    s.deals++;
    if (d.stage !== "won" && d.stage !== "lost") s.pipeline += d.value;
  }

  return (
    <>
      <PageHeader
        title="CRM"
        description="Accounts you sell to, with every contact, deal, invoice and ticket in one place."
        tabs={CRM_TABS("companies")}
        actions={
          <a href="/api/export/companies" className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
            <Download className="size-4" /> Export CSV
          </a>
        }
      />

      <form className="mb-5 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, industry or city" className="h-10 w-72 max-w-full rounded-full border border-line bg-paper/60 px-4 text-sm outline-none focus:border-ink" />
        <button className="h-10 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">Search</button>
      </form>

      <Card title={`Companies (${companies.length})`}>
        {companies.length === 0 ? (
          <EmptyState title={q ? "No companies match" : "No companies yet"}>{q ? "Try a different search." : "Add your first account below."}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th>Industry</Th>
                <Th>Location</Th>
                <Th>Contacts</Th>
                <Th>Deals</Th>
                <Th className="text-right">Open pipeline</Th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const s = stats.get(c.id);
                return (
                  <tr key={c.id}>
                    <Td>
                      <Link href={`/app/crm/companies/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {c.gstin && <p className="font-mono text-xs text-ink-mute">{c.gstin}</p>}
                    </Td>
                    <Td className="text-ink-soft">{c.industry ?? "—"}</Td>
                    <Td className="text-ink-soft">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</Td>
                    <Td>{s?.contacts ?? 0}</Td>
                    <Td>{s?.deals ?? 0}</Td>
                    <Td className="text-right">{formatMoney(s?.pipeline ?? 0, ws.org.currency)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <details className="mt-8 rounded-[20px] border border-line bg-card">
        <summary className="flex cursor-pointer items-center gap-2 px-5 py-3.5 font-display text-base font-semibold">
          <Plus className="size-4" /> Add company
        </summary>
        <div className="border-t border-line p-5">
          <CompanyForm members={members} />
        </div>
      </details>
    </>
  );
}
