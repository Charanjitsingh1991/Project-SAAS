import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, like, or } from "drizzle-orm";
import { Download, Plus } from "lucide-react";
import { ActionForm, Input, Select, SubmitButton, Textarea } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { PRIORITIES, TICKET_CHANNELS } from "@/db/schema";
import { timeAgo } from "@/lib/format";
import { avg, avgMs, formatDuration, HELPDESK_CATEGORIES, isActive, slaCompliance, slaLabel, slaSortKey, ticketSla, wallClock } from "@/lib/helpdesk";
import { getMembers } from "@/lib/helpdesk-data";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { createTicketAction } from "./actions";
import { HELPDESK_TABS } from "./tabs";

export const metadata: Metadata = { title: "Helpdesk" };

const VIEWS = ["all", "unassigned", "mine", "overdue", "open", "pending", "on_hold", "resolved", "closed"] as const;
type View = (typeof VIEWS)[number];
const DAY = 86_400_000;

export default async function HelpdeskPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const view: View = VIEWS.find((v) => v === sp.view) ?? "all";
  const orgId = ws.org.id;
  const nowMs = wallClock();

  const conds = [eq(schema.tickets.orgId, orgId)];
  if (q) {
    const pat = `%${q}%`;
    conds.push(or(like(schema.tickets.subject, pat), like(schema.tickets.requesterName, pat), like(schema.tickets.requesterEmail, pat), like(schema.tickets.number, pat))!);
  }

  const [rows, all, members] = await Promise.all([
    db
      .select({ t: schema.tickets, company: schema.companies.name, assignee: schema.users.name })
      .from(schema.tickets)
      .leftJoin(schema.companies, eq(schema.tickets.companyId, schema.companies.id))
      .leftJoin(schema.users, eq(schema.tickets.assigneeId, schema.users.id))
      .where(and(...conds)),
    db.select().from(schema.tickets).where(eq(schema.tickets.orgId, orgId)),
    getMembers(orgId),
  ]);

  const active = all.filter((t) => isActive(t.status));
  const breachedNow = active.filter((t) => ticketSla(t, nowMs)?.state === "breached").length;
  const compliance = slaCompliance(all, nowMs - 30 * DAY);
  const frt = avgMs(all.filter((t) => t.firstRespondedAt).map((t) => ({ from: t.createdAt, to: t.firstRespondedAt })));
  const art = avgMs(all.filter((t) => t.resolvedAt).map((t) => ({ from: t.createdAt, to: t.resolvedAt })));
  const csatAvg = avg(all.map((t) => t.csatRating));
  const csatCount = all.filter((t) => t.csatRating != null).length;

  const filtered = rows
    .filter(({ t }) => {
      switch (view) {
        case "unassigned":
          return isActive(t.status) && !t.assigneeId;
        case "mine":
          return isActive(t.status) && t.assigneeId === ws.user.id;
        case "overdue":
          return isActive(t.status) && ticketSla(t, nowMs)?.state === "breached";
        case "all":
          return true;
        default:
          return t.status === view;
      }
    })
    .map((r) => ({ ...r, key: slaSortKey(r.t, nowMs), sla: ticketSla(r.t, nowMs) }))
    .sort((a, b) => {
      const ba = a.sla?.state === "breached" && isActive(a.t.status) ? 0 : 1;
      const bb = b.sla?.state === "breached" && isActive(b.t.status) ? 0 : 1;
      if (ba !== bb) return ba - bb;
      if (a.key !== b.key) return a.key - b.key;
      return b.t.updatedAt.getTime() - a.t.updatedAt.getTime();
    });

  const viewLink = (v: View) => `/app/helpdesk?${new URLSearchParams({ ...(v !== "all" ? { view: v } : {}), ...(q ? { q } : {}) }).toString()}`;

  return (
    <>
      <PageHeader
        title="Helpdesk"
        description="Every conversation, ranked by how close it is to breaching its SLA."
        tabs={HELPDESK_TABS("queue")}
        actions={
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download
          <a href="/api/export/tickets" className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
            <Download className="size-4" /> Export CSV
          </a>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Open" value={active.length} tone="peach" />
        <Stat label="Unassigned" value={active.filter((t) => !t.assigneeId).length} tone="butter" />
        <Stat label="SLA breached" value={breachedNow} tone={breachedNow ? "rose" : "mint"} hint="right now" />
        <Stat label="SLA compliance" value={compliance == null ? "—" : `${compliance}%`} tone="mint" hint="resolved, 30 days" />
        <Stat label="Avg first reply" value={frt == null ? "—" : formatDuration(frt)} tone="sky" />
        <Stat label="Avg resolution" value={art == null ? "—" : formatDuration(art)} tone="lilac" />
        <Stat label="CSAT" value={csatAvg == null ? "—" : csatAvg.toFixed(1)} tone="lime" hint={`${csatCount} rating${csatCount === 1 ? "" : "s"}`} />
      </div>

      <details className="mb-6 rounded-[20px] border border-line bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 font-display font-semibold">
          <Plus className="size-4" /> New ticket
        </summary>
        <div className="border-t border-line p-5">
          <ActionForm action={createTicketAction} className="grid gap-3 md:grid-cols-2">
            <Input label="Subject" name="subject" required maxLength={200} className="md:col-span-2" />
            <Input label="Requester name" name="requesterName" required maxLength={120} />
            <Input label="Requester email" name="requesterEmail" type="email" required maxLength={200} />
            <Select label="Channel" name="channel" options={TICKET_CHANNELS} defaultValue="email" />
            <Select label="Category" name="category" options={HELPDESK_CATEGORIES} placeholder="No category" defaultValue="" />
            <Select label="Priority" name="priority" options={PRIORITIES} defaultValue="medium" />
            <Select label="Assignee" name="assigneeId" options={members.map((m) => ({ value: m.id, label: m.name }))} placeholder="Unassigned" defaultValue="" />
            <Textarea label="Description" name="description" rows={4} maxLength={10000} className="md:col-span-2" />
            <div className="md:col-span-2">
              <SubmitButton>Create ticket</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </details>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <Link key={v} href={viewLink(v)} className={cn("rounded-full border px-3 py-1.5 text-sm capitalize", view === v ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}>
              {v === "overdue" ? "Overdue SLA" : v.replace("_", " ")}
            </Link>
          ))}
        </div>
        <form className="ml-auto flex gap-2">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <input name="q" defaultValue={q} placeholder="Search subject, requester, TCK-…" aria-label="Search tickets" className="h-10 w-64 max-w-full rounded-xl border border-line bg-card px-3 text-sm outline-none focus:border-ink" />
          <button className="h-10 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">Search</button>
        </form>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState title={all.length === 0 ? "No tickets yet" : "No tickets match"}>
            {all.length === 0 ? "Create one above, or share your support portal so customers can write in." : "Try another view or search."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Ticket</Th>
                <Th>Requester</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
                <Th>Assignee</Th>
                <Th>SLA</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ t, company, assignee, sla }) => (
                <tr key={t.id} className="hover:bg-paper/50">
                  <Td className="max-w-[320px]">
                    <Link href={`/app/helpdesk/tickets/${t.id}`} className="block font-medium hover:underline">
                      {t.subject}
                    </Link>
                    <span className="font-mono text-xs text-ink-mute">{t.number}</span>
                  </Td>
                  <Td>
                    {t.requesterName}
                    <span className="block text-xs text-ink-mute">{company ?? t.requesterEmail}</span>
                  </Td>
                  <Td>
                    <StatusBadge value={t.priority} />
                  </Td>
                  <Td>
                    <StatusBadge value={t.status} />
                  </Td>
                  <Td>{assignee ?? <span className="text-ink-mute">Unassigned</span>}</Td>
                  <Td>
                    {sla ? (
                      <span className="inline-flex flex-col items-start gap-0.5">
                        <StatusBadge value={sla.state === "met" ? "on_track" : sla.state} />
                        <span className="text-xs text-ink-mute">
                          {sla.kind === "response" ? "Reply" : "Resolve"} · {slaLabel(sla)}
                        </span>
                      </span>
                    ) : (
                      <Badge>—</Badge>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft">{timeAgo(t.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
