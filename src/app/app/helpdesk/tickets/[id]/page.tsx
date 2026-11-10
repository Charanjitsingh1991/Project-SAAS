import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { Star } from "lucide-react";
import { CopyLink } from "@/components/app/copy-link";
import { Card, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { PRIORITIES, TICKET_STATUSES } from "@/db/schema";
import { formatDateTime, timeAgo } from "@/lib/format";
import { HELPDESK_CATEGORIES, slaLabel, slaState, ticketSla, wallClock } from "@/lib/helpdesk";
import { getMembers } from "@/lib/helpdesk-data";
import { requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";
import { cn } from "@/lib/utils";
import { updateTicketAction } from "../../actions";
import { AutoSelect, ReplyComposer } from "../../parts";

export const metadata: Metadata = { title: "Ticket" };

export default async function TicketPage({ params }: PageProps<"/app/helpdesk/tickets/[id]">) {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const orgId = ws.org.id;

  const [t] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.id, id), eq(schema.tickets.orgId, orgId))).limit(1);
  if (!t) notFound();

  const [messages, members, canned, contact, company, origin] = await Promise.all([
    db.select().from(schema.ticketMessages).where(and(eq(schema.ticketMessages.ticketId, t.id), eq(schema.ticketMessages.orgId, orgId))).orderBy(asc(schema.ticketMessages.createdAt), asc(schema.ticketMessages.id)),
    getMembers(orgId),
    db.select().from(schema.cannedResponses).where(eq(schema.cannedResponses.orgId, orgId)).orderBy(asc(schema.cannedResponses.title)),
    t.contactId ? db.select({ id: schema.contacts.id, name: schema.contacts.name }).from(schema.contacts).where(and(eq(schema.contacts.id, t.contactId), eq(schema.contacts.orgId, orgId))).limit(1) : Promise.resolve([]),
    t.companyId ? db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(and(eq(schema.companies.id, t.companyId), eq(schema.companies.orgId, orgId))).limit(1) : Promise.resolve([]),
    appOrigin(),
  ]);

  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const sla = ticketSla(t, wallClock());
  const resp = t.firstResponseDueAt ? { due: t.firstResponseDueAt, done: t.firstRespondedAt } : null;
  const portalUrl = `${origin}/support/${ws.org.slug}/ticket/${t.publicToken}`;

  return (
    <>
      <Link href="/app/helpdesk" className="text-sm text-ink-soft hover:text-ink">
        ← Back to tickets
      </Link>
      <div className="mt-3 mb-8">
        <p className="font-mono text-xs tracking-widest text-ink-mute uppercase">{t.number}</p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t.subject}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge value={t.status} />
          <StatusBadge value={t.priority} />
          {sla && <StatusBadge value={sla.state === "met" ? "on_track" : sla.state} />}
          <span className="text-sm text-ink-soft">
            via {t.channel} · opened {timeAgo(t.createdAt)}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <div className="space-y-3">
            {messages.length === 0 && <p className="rounded-2xl border border-dashed border-ink/20 p-6 text-center text-sm text-ink-soft">No messages yet.</p>}
            {messages.map((m) => {
              if (m.authorType === "system")
                return (
                  <p key={m.id} className="text-center text-xs text-ink-mute">
                    {m.body} · {formatDateTime(m.createdAt)}
                  </p>
                );
              const requester = m.authorType === "requester";
              const author = requester ? t.requesterName : (m.authorId ? nameOf.get(m.authorId) : null) ?? "Agent";
              return (
                <div key={m.id} className={cn("flex", requester ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-[20px] border border-ink/10 px-4 py-3",
                      requester ? "rounded-bl-md bg-peach" : m.internal ? "rounded-br-md bg-butter" : "rounded-br-md bg-card",
                    )}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink/60">
                      <b className="text-ink">{author}</b>
                      {m.internal && <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-medium tracking-wide text-paper uppercase">Internal</span>}
                      <span>{formatDateTime(m.createdAt)}</span>
                    </div>
                    <p className="text-sm break-words whitespace-pre-wrap">{m.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <ReplyComposer ticketId={t.id} canned={canned.map((c) => ({ id: c.id, title: c.title, body: c.body }))} />
        </div>

        <aside className="space-y-4">
          <Card title="Details">
            <div className="space-y-3 text-sm">
              <Field label="Status">
                <AutoSelect action={updateTicketAction} id={t.id} name="status" value={t.status} label="Status" options={TICKET_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))} />
              </Field>
              <Field label="Priority">
                <AutoSelect action={updateTicketAction} id={t.id} name="priority" value={t.priority} label="Priority" options={PRIORITIES.map((s) => ({ value: s, label: s }))} />
              </Field>
              <Field label="Assignee">
                <AutoSelect
                  action={updateTicketAction}
                  id={t.id}
                  name="assigneeId"
                  value={t.assigneeId ? String(t.assigneeId) : ""}
                  label="Assignee"
                  options={[{ value: "", label: "Unassigned" }, ...members.map((m) => ({ value: String(m.id), label: m.name }))]}
                />
              </Field>
              <Field label="Category">
                <AutoSelect
                  action={updateTicketAction}
                  id={t.id}
                  name="category"
                  value={t.category ?? ""}
                  label="Category"
                  options={[{ value: "", label: "None" }, ...[...new Set([...HELPDESK_CATEGORIES, ...(t.category ? [t.category] : [])])].map((c) => ({ value: c, label: c }))]}
                />
              </Field>
            </div>
          </Card>

          <Card title="Requester">
            <p className="font-medium">{t.requesterName}</p>
            <a href={`mailto:${t.requesterEmail}`} className="text-sm text-ink-soft hover:underline">
              {t.requesterEmail}
            </a>
            <div className="mt-3 space-y-1 text-sm">
              {contact[0] ? (
                <p>
                  Contact:{" "}
                  <Link href={`/app/crm/contacts/${contact[0].id}`} className="underline underline-offset-4">
                    {contact[0].name}
                  </Link>
                </p>
              ) : (
                <p className="text-ink-mute">Not linked to a CRM contact</p>
              )}
              {company[0] && (
                <p>
                  Company:{" "}
                  <Link href={`/app/crm/companies/${company[0].id}`} className="underline underline-offset-4">
                    {company[0].name}
                  </Link>
                </p>
              )}
            </div>
          </Card>

          <Card title="SLA">
            <div className="space-y-3 text-sm">
              {resp && (
                <SlaRow
                  label="First response"
                  due={resp.due}
                  done={resp.done}
                  state={ticketSlaFor(t, "response", wallClock())}
                />
              )}
              {t.resolutionDueAt && <SlaRow label="Resolution" due={t.resolutionDueAt} done={t.resolvedAt ?? t.closedAt} state={ticketSlaFor(t, "resolution", wallClock())} />}
            </div>
          </Card>

          {t.csatRating != null && (
            <Card title="Customer satisfaction">
              <div className="flex gap-0.5" aria-label={`${t.csatRating} out of 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={cn("size-5", n <= t.csatRating! ? "fill-butter stroke-ink" : "stroke-ink-mute")} />
                ))}
              </div>
              {t.csatComment && <p className="mt-2 text-sm text-ink-soft">“{t.csatComment}”</p>}
            </Card>
          )}

          <Card title="Requester link">
            <p className="mb-2 text-xs text-ink-soft">Private page where the requester can follow and reply.</p>
            <CopyLink url={portalUrl} />
          </Card>
        </aside>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-ink-soft">{label}</p>
      {children}
    </div>
  );
}

function ticketSlaFor(t: typeof schema.tickets.$inferSelect, kind: "response" | "resolution", nowMs: number) {
  const dueAt = kind === "response" ? t.firstResponseDueAt! : t.resolutionDueAt!;
  const doneAt = kind === "response" ? t.firstRespondedAt : (t.resolvedAt ?? t.closedAt);
  const state = slaState({ createdAt: t.createdAt, dueAt, doneAt, nowMs });
  return { state, remainingMs: dueAt.getTime() - (doneAt?.getTime() ?? nowMs), kind, dueAt };
}

function SlaRow({ label, due, done, state }: { label: string; due: Date; done: Date | null; state: ReturnType<typeof ticketSlaFor> }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-soft">{label}</span>
        <StatusBadge value={state.state === "met" ? "on_track" : state.state} />
      </div>
      <p className="mt-0.5">Due {formatDateTime(due)}</p>
      <p className="text-xs text-ink-mute">{done ? `${state.state === "met" ? "Met" : "Missed"} · done ${formatDateTime(done)}` : slaLabel(state)}</p>
    </div>
  );
}
