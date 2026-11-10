import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { deleteCompany } from "../../actions";
import { getMembers } from "../../data";
import { ActivityForm, ActivityTimeline, CompanyForm, taxFields } from "../../parts";
import { QuoteList } from "../../_components/quote-status";
import { CRM_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const orgId = ws.org.id;
  const [company] = await db.select().from(schema.companies).where(and(eq(schema.companies.id, id), eq(schema.companies.orgId, orgId))).limit(1);
  if (!company) notFound();

  const [members, contacts, deals, activities, invoices, tickets, quotes] = await Promise.all([
    getMembers(orgId),
    db.select().from(schema.contacts).where(and(eq(schema.contacts.companyId, id), eq(schema.contacts.orgId, orgId))).orderBy(asc(schema.contacts.name)),
    db.select().from(schema.deals).where(and(eq(schema.deals.companyId, id), eq(schema.deals.orgId, orgId))).orderBy(desc(schema.deals.createdAt)),
    db.select().from(schema.crmActivities).where(and(eq(schema.crmActivities.companyId, id), eq(schema.crmActivities.orgId, orgId))).orderBy(desc(schema.crmActivities.createdAt)),
    db.select().from(schema.invoices).where(and(eq(schema.invoices.companyId, id), eq(schema.invoices.orgId, orgId))).orderBy(desc(schema.invoices.issueDate)),
    db.select().from(schema.tickets).where(and(eq(schema.tickets.companyId, id), eq(schema.tickets.orgId, orgId))).orderBy(desc(schema.tickets.createdAt)),
    db.select().from(schema.quotes).where(and(eq(schema.quotes.companyId, id), eq(schema.quotes.orgId, orgId))).orderBy(desc(schema.quotes.createdAt), desc(schema.quotes.id)),
  ]);
  const pack = packFor(ws);

  const cur = ws.org.currency;
  const live = invoices.filter((i) => i.status !== "void");
  const lifetime = live.reduce((s, i) => s + i.amountPaid, 0);
  const outstanding = live.filter((i) => i.status === "sent" || i.status === "partial").reduce((s, i) => s + (i.total - i.amountPaid), 0);
  const pipeline = deals.filter((d) => d.stage !== "won" && d.stage !== "lost").reduce((s, d) => s + d.value, 0);

  return (
    <>
      <PageHeader
        title={company.name}
        description={[company.industry, [company.city, company.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || undefined}
        tabs={CRM_TABS("companies")}
        actions={
          <ActionButton action={deleteCompany} fields={{ id: company.id }} confirm={`Delete ${company.name}? Contacts and deals are kept but unlinked.`}>
            <Trash2 className="size-3" /> Delete
          </ActionButton>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Lifetime revenue" value={formatMoney(lifetime, cur)} hint="Paid invoices" tone="mint" />
        <Stat label="Outstanding" value={formatMoney(outstanding, cur)} hint="Sent & partially paid" tone="butter" />
        <Stat label="Open pipeline" value={formatMoney(pipeline, cur)} hint={`${deals.length} deals`} tone="sky" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Details" className="xl:col-span-2">
          <CompanyForm company={company} members={members} tax={taxFields(pack)} />
        </Card>

        <Card title={`Contacts (${contacts.length})`}>
          {contacts.length === 0 ? (
            <EmptyState title="No contacts">Add contacts from the Contacts tab and link them to this company.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <Link href={`/app/crm/contacts/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-ink-mute">{[c.title, c.email].filter(Boolean).join(" · ")}</p>
                  </div>
                  <StatusBadge value={c.lifecycle} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Deals (${deals.length})`}>
          {deals.length === 0 ? (
            <EmptyState title="No deals" />
          ) : (
            <ul className="divide-y divide-line">
              {deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/app/crm/deals/${d.id}`} className="font-medium hover:underline">
                    {d.title}
                  </Link>
                  <span className="flex items-center gap-2">
                    {formatMoney(d.value, cur)} <StatusBadge value={d.stage} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Invoices (${invoices.length})`}>
          {invoices.length === 0 ? (
            <EmptyState title="No invoices yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>Total</Th>
                  <Th>Balance</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <Link href={`/app/finance/invoices/${i.id}`} className="font-medium hover:underline">
                        {i.number}
                      </Link>
                      <p className="text-xs text-ink-mute">{formatDate(i.issueDate)}</p>
                    </Td>
                    <Td>{formatMoney(i.total, cur)}</Td>
                    <Td>{i.status === "void" ? "—" : formatMoney(i.total - i.amountPaid, cur)}</Td>
                    <Td>
                      <StatusBadge value={i.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card
          title={`Quotes (${quotes.length})`}
          actions={
            <Link href={`/app/crm/quotes/new?companyId=${company.id}`} className="text-sm font-medium underline-offset-2 hover:underline">
              New quote
            </Link>
          }
        >
          <QuoteList quotes={quotes} currency={cur} today={todayYmd()} />
        </Card>

        <Card title={`Tickets (${tickets.length})`}>
          {tickets.length === 0 ? (
            <EmptyState title="No support tickets" />
          ) : (
            <ul className="divide-y divide-line">
              {tickets.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/app/helpdesk/tickets/${t.id}`} className="min-w-0 truncate hover:underline">
                    <span className="font-mono text-xs text-ink-mute">{t.number}</span> {t.subject}
                  </Link>
                  <StatusBadge value={t.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Activities" className="xl:col-span-2">
          <ActivityForm companyId={company.id} />
          <div className="mt-5 border-t border-line pt-2">
            <ActivityTimeline items={activities} today={todayYmd()} />
          </div>
        </Card>
      </div>
    </>
  );
}
