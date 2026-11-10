import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { Card, EmptyState, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { ActivityTimeline } from "../parts";
import { CRM_TABS } from "../tabs";

export const metadata: Metadata = { title: "My follow-ups" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const all = (await searchParams).scope === "all";
  const today = todayYmd();

  const conds = [eq(schema.crmActivities.orgId, ws.org.id), eq(schema.crmActivities.done, false), isNotNull(schema.crmActivities.dueDate)];
  if (!all) conds.push(eq(schema.crmActivities.ownerId, ws.user.id));
  const rows = await db.select().from(schema.crmActivities).where(and(...conds)).orderBy(asc(schema.crmActivities.dueDate), asc(schema.crmActivities.id));

  const groups = [
    { key: "overdue", title: "Overdue", items: rows.filter((r) => r.dueDate! < today), tone: "border-signal/40" },
    { key: "today", title: "Today", items: rows.filter((r) => r.dueDate === today), tone: "border-ink/20" },
    { key: "upcoming", title: "Upcoming", items: rows.filter((r) => r.dueDate! > today), tone: "border-line" },
  ];

  const chip = (href: string, active: boolean, label: string) => (
    <Link href={href} className={cn("rounded-full border px-3 py-1.5 text-sm", active ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader title="CRM" description="Calls, meetings and tasks that need you." tabs={CRM_TABS("followups")} />
      <div className="mb-5 flex gap-2">
        {chip("/app/crm/activities", !all, "My follow-ups")}
        {chip("/app/crm/activities?scope=all", all, "Everyone")}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="You're all caught up">No open activities with a due date. Add one from a deal, contact or company.</EmptyState>
      ) : (
        <div className="space-y-6">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <Card key={g.key} title={`${g.title} (${g.items.length})`} className={g.tone}>
                <ActivityTimeline items={g.items} today={today} />
                <ul className="mt-3 flex flex-wrap gap-2 text-xs text-ink-mute">
                  {g.items
                    .filter((a) => a.dealId || a.contactId || a.companyId)
                    .map((a) => {
                      const href = a.dealId ? `/app/crm/deals/${a.dealId}` : a.contactId ? `/app/crm/contacts/${a.contactId}` : `/app/crm/companies/${a.companyId}`;
                      return (
                        <li key={a.id}>
                          <Link href={href} className="rounded-full border border-line px-2.5 py-1 hover:border-ink">
                            Open record for “{a.subject}”
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              </Card>
            ))}
        </div>
      )}
    </>
  );
}
