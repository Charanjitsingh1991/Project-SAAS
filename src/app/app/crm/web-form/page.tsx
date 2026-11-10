import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { CopyLink } from "@/components/app/copy-link";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDateTime } from "@/lib/format";
import { hasFeature, planOf, requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";
import { webFormEmbed, webFormUrl } from "@/lib/webforms";
import { CRM_TABS } from "../tabs";

export const metadata: Metadata = { title: "Web form" };

export default async function WebFormSettingsPage() {
  const ws = await requireWorkspace({ module: "crm" });

  if (!hasFeature(ws, "webForms")) {
    return (
      <>
        <PageHeader title="CRM" description="Capture leads straight from your website." tabs={CRM_TABS("webform")} />
        <Card>
          <p className="font-display text-lg font-semibold">Web-to-lead forms are part of the Growth plan</p>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">
            You&apos;re on {planOf(ws).name}. Upgrade to publish a hosted contact form that drops every enquiry into your pipeline as a lead with a follow-up task.
          </p>
          <Link href="/app/billing?upgrade=webForms" className="mt-4 inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink/85">
            See plans
          </Link>
        </Card>
      </>
    );
  }

  const url = webFormUrl(await appOrigin(), ws.org.slug);
  const recent = await db
    .select({ id: schema.deals.id, title: schema.deals.title, stage: schema.deals.stage, createdAt: schema.deals.createdAt, contact: schema.contacts.name, email: schema.contacts.email })
    .from(schema.deals)
    .leftJoin(schema.contacts, eq(schema.deals.contactId, schema.contacts.id))
    .where(and(eq(schema.deals.orgId, ws.org.id), eq(schema.deals.source, "website")))
    .orderBy(desc(schema.deals.createdAt), desc(schema.deals.id))
    .limit(10);

  return (
    <>
      <PageHeader title="CRM" description="A hosted contact form: each submission creates a contact, a lead-stage deal and a follow-up task." tabs={CRM_TABS("webform")} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Public link">
          <CopyLink url={url} />
          <a href={url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-medium underline-offset-2 hover:underline">
            Open the form ↗
          </a>
          <p className="mt-4 text-sm text-ink-soft">Bots are filtered with a hidden field, and repeat submissions from the same email within a minute are rejected.</p>
        </Card>
        <Card title="Embed on your website">
          <p className="mb-2 text-sm text-ink-soft">Paste this snippet into any page:</p>
          <pre className="overflow-x-auto rounded-xl bg-paper-2 p-3 font-mono text-xs whitespace-pre-wrap break-all">{webFormEmbed(url)}</pre>
        </Card>
        <Card title="Latest web leads" className="xl:col-span-2">
          {recent.length === 0 ? (
            <EmptyState title="No submissions yet">Share the link or embed the form to start collecting leads.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <Link href={`/app/crm/deals/${d.id}`} className="font-medium hover:underline">
                      {d.title}
                    </Link>
                    <p className="text-xs text-ink-mute">{[d.contact, d.email, formatDateTime(d.createdAt)].filter(Boolean).join(" · ")}</p>
                  </div>
                  <StatusBadge value={d.stage} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
