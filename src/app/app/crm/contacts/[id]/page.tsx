import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { daysSince, leadScore, valuePercentile } from "@/lib/crm";
import { formatMoney, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { deleteContact } from "../../actions";
import { getCompanyOptions, getMembers, getScoreContext, nowMs } from "../../data";
import { ActivityForm, ActivityTimeline, ContactForm, ScoreChip } from "../../parts";
import { CRM_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const orgId = ws.org.id;
  const [contact] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, orgId))).limit(1);
  if (!contact) notFound();

  const nowMs = nowMs();
  const [companies, members, deals, activities, sc] = await Promise.all([
    getCompanyOptions(orgId),
    getMembers(orgId),
    db.select().from(schema.deals).where(and(eq(schema.deals.contactId, id), eq(schema.deals.orgId, orgId))).orderBy(desc(schema.deals.createdAt)),
    db.select().from(schema.crmActivities).where(and(eq(schema.crmActivities.contactId, id), eq(schema.crmActivities.orgId, orgId))).orderBy(desc(schema.crmActivities.createdAt)),
    getScoreContext(orgId, nowMs),
  ]);

  const openDeals = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const best = [...openDeals].sort((a, b) => b.value - a.value)[0];
  const score = leadScore({
    hasEmail: !!contact.email,
    hasPhone: !!contact.phone,
    hasCompany: !!contact.companyId,
    valuePercentile: best ? valuePercentile(best.value, sc.allValues) : 0,
    recentActivity: sc.activeContacts.has(contact.id),
    daysInStage: openDeals.length ? Math.max(...openDeals.map((d) => daysSince(d.stageChangedAt, nowMs))) : null,
  });

  return (
    <>
      <PageHeader
        title={contact.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge value={contact.lifecycle} />
            <ScoreChip score={score} />
            {contact.title && <span>{contact.title}</span>}
          </span>
        }
        tabs={CRM_TABS("contacts")}
        actions={
          <ActionButton action={deleteContact} fields={{ id: contact.id }} confirm={`Delete ${contact.name}? Their activities are removed; deals are kept.`}>
            <Trash2 className="size-3" /> Delete
          </ActionButton>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Details" className="xl:col-span-2">
          <ContactForm contact={contact} companies={companies} members={members} />
        </Card>

        <Card title={`Deals (${deals.length})`}>
          {deals.length === 0 ? (
            <EmptyState title="No deals">Create a deal from the pipeline and pick this contact.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/app/crm/deals/${d.id}`} className="font-medium hover:underline">
                    {d.title}
                  </Link>
                  <span className="flex items-center gap-2">
                    {formatMoney(d.value, ws.org.currency)} <StatusBadge value={d.stage} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Activities">
          <ActivityForm contactId={contact.id} />
          <div className="mt-5 border-t border-line pt-2">
            <ActivityTimeline items={activities} today={todayYmd()} />
          </div>
        </Card>
      </div>
    </>
  );
}
