import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/app/forms";
import { Badge, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rateTicketAction, requesterReplyAction } from "../../../actions";
import { getPortalOrg, PortalShell } from "../../../parts";

export const metadata: Metadata = { title: "Your request", robots: { index: false, follow: false } };

export default async function RequesterTicketPage({ params }: PageProps<"/support/[slug]/ticket/[token]">) {
  const p = await params;
  const org = await getPortalOrg(p.slug);
  const [t] = await db
    .select()
    .from(schema.tickets)
    .where(and(eq(schema.tickets.orgId, org.id), eq(schema.tickets.publicToken, p.token)))
    .limit(1);
  if (!t) notFound();

  const messages = await db
    .select({ id: schema.ticketMessages.id, authorType: schema.ticketMessages.authorType, body: schema.ticketMessages.body, createdAt: schema.ticketMessages.createdAt, authorId: schema.ticketMessages.authorId })
    .from(schema.ticketMessages)
    .where(and(eq(schema.ticketMessages.ticketId, t.id), eq(schema.ticketMessages.orgId, org.id), eq(schema.ticketMessages.internal, false)))
    .orderBy(asc(schema.ticketMessages.createdAt), asc(schema.ticketMessages.id));
  const visible = messages.filter((m) => m.authorType !== "system");
  const finished = t.status === "resolved" || t.status === "closed";

  return (
    <PortalShell org={org}>
      <p className="font-mono text-xs tracking-widest text-ink-mute uppercase">{t.number}</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight md:text-4xl">{t.subject}</h1>
      <div className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
        <StatusBadge value={t.status} /> Opened {formatDateTime(t.createdAt)}
      </div>
      <p className="mt-2 text-sm text-ink-mute">Keep this page&apos;s link private: anyone with it can view and reply to this request.</p>

      <div className="mt-8 space-y-3">
        {visible.map((m) => {
          const mine = m.authorType === "requester";
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-[20px] border border-ink/10 px-4 py-3", mine ? "rounded-br-md bg-peach" : "rounded-bl-md bg-card")}>
                <div className="mb-1 flex items-center gap-2 text-xs text-ink/60">
                  <b className="text-ink">{mine ? t.requesterName : `${org.name} support`}</b>
                  <span>{formatDateTime(m.createdAt)}</span>
                </div>
                <p className="text-sm break-words whitespace-pre-wrap">{m.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {finished && t.csatRating == null && (
        <section className="mt-8 rounded-[20px] border border-ink/10 bg-mint/60 p-5">
          <h2 className="font-display text-lg font-semibold">How did we do?</h2>
          <ActionForm action={rateTicketAction} className="mt-3 space-y-3">
            <input type="hidden" name="slug" value={org.slug} />
            <input type="hidden" name="token" value={t.publicToken} />
            <fieldset className="flex gap-2">
              <legend className="sr-only">Rating</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="cursor-pointer">
                  <input type="radio" name="rating" value={n} className="peer sr-only" required />
                  <span className="inline-flex size-11 items-center justify-center rounded-full border border-ink/20 bg-card font-display text-lg font-semibold peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:ring-4 peer-focus-visible:ring-ink/20">{n}</span>
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-ink-soft">1 = very unhappy, 5 = delighted</p>
            <textarea name="comment" rows={3} maxLength={1000} aria-label="Comment (optional)" placeholder="Anything to add? (optional)" className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm outline-none focus:border-ink" />
            <SubmitButton>Send feedback</SubmitButton>
          </ActionForm>
        </section>
      )}
      {t.csatRating != null && (
        <p className="mt-8 rounded-[20px] border border-ink/10 bg-mint/60 p-4 text-sm">
          Thanks for rating this request <Badge tone="card">{t.csatRating}/5</Badge>
        </p>
      )}

      {t.status === "closed" ? (
        <p className="mt-8 text-sm text-ink-soft">This request is closed. Need more help? Submit a new request from the help center.</p>
      ) : (
        <section className="mt-8 rounded-[20px] border border-line bg-card p-5">
          <h2 className="font-display text-lg font-semibold">{finished ? "Still need help? Reply to reopen" : "Reply"}</h2>
          <ActionForm action={requesterReplyAction} className="mt-3 space-y-3">
            <input type="hidden" name="slug" value={org.slug} />
            <input type="hidden" name="token" value={t.publicToken} />
            <textarea name="body" rows={5} required maxLength={5000} aria-label="Your reply" className="w-full rounded-xl border border-line bg-paper/60 px-3 py-2 text-sm outline-none focus:border-ink focus:bg-card" />
            <SubmitButton>Send reply</SubmitButton>
          </ActionForm>
        </section>
      )}
    </PortalShell>
  );
}
