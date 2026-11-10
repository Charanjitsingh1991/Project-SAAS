import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { ActionButton, SubmitButton } from "@/components/app/forms";
import { Badge, Card, PageHeader, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { DEAL_STAGES } from "@/db/schema";
import { daysSince, STUCK_DAYS } from "@/lib/crm";
import { formatDate, formatDateTime, formatMoney, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { deleteDeal, setDealStage } from "../../actions";
import { getCompanyOptions, getContactOptions, getMembers } from "../../data";
import { ActivityForm, ActivityTimeline, DealForm } from "../../parts";
import { CRM_TABS } from "../../tabs";

export const metadata: Metadata = { title: "Deal" };

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const orgId = ws.org.id;

  const [deal] = await db.select().from(schema.deals).where(and(eq(schema.deals.id, id), eq(schema.deals.orgId, orgId))).limit(1);
  if (!deal) notFound();

  const [members, companies, contacts, activities, history, invoice, project] = await Promise.all([
    getMembers(orgId),
    getCompanyOptions(orgId),
    getContactOptions(orgId),
    db.select().from(schema.crmActivities).where(and(eq(schema.crmActivities.dealId, id), eq(schema.crmActivities.orgId, orgId))).orderBy(desc(schema.crmActivities.createdAt)),
    db
      .select({ summary: schema.activityLog.summary, createdAt: schema.activityLog.createdAt, actor: schema.users.name })
      .from(schema.activityLog)
      .leftJoin(schema.users, eq(schema.activityLog.actorId, schema.users.id))
      .where(and(eq(schema.activityLog.orgId, orgId), eq(schema.activityLog.entityType, "deal"), eq(schema.activityLog.entityId, id)))
      .orderBy(desc(schema.activityLog.createdAt), desc(schema.activityLog.id)),
    deal.invoiceId
      ? db.select({ id: schema.invoices.id, number: schema.invoices.number, status: schema.invoices.status, total: schema.invoices.total }).from(schema.invoices).where(and(eq(schema.invoices.id, deal.invoiceId), eq(schema.invoices.orgId, orgId))).limit(1)
      : Promise.resolve([]),
    deal.projectId
      ? db.select({ id: schema.projects.id, code: schema.projects.code, name: schema.projects.name }).from(schema.projects).where(and(eq(schema.projects.id, deal.projectId), eq(schema.projects.orgId, orgId))).limit(1)
      : Promise.resolve([]),
  ]);

  const cur = ws.org.currency;
  const today = todayYmd();
  const isOpen = deal.stage !== "won" && deal.stage !== "lost";
  const days = daysSince(deal.stageChangedAt, Date.now());
  const stageIdx = DEAL_STAGES.indexOf(deal.stage);
  const flow = DEAL_STAGES.filter((s) => s !== "lost");

  return (
    <>
      <PageHeader
        title={deal.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge value={deal.stage} />
            <span>{formatMoney(deal.value, cur)}</span>
            <span className="text-ink-mute">· {deal.probability}% · {isOpen ? `${days}d in stage` : `closed ${deal.closedAt ? formatDate(deal.closedAt.toISOString().slice(0, 10)) : ""}`}</span>
            {isOpen && days > STUCK_DAYS && <Badge tone="rose">stuck</Badge>}
          </span>
        }
        tabs={CRM_TABS("pipeline")}
        actions={
          <ActionButton action={deleteDeal} fields={{ id: deal.id }} confirm={`Delete ${deal.title} and its activities?`}>
            <Trash2 className="size-3" /> Delete deal
          </ActionButton>
        }
      />

      <Card title="Stage" className="mb-6">
        <ol className="grid grid-cols-5 gap-1.5">
          {flow.map((s, i) => (
            <li key={s} className={cn("h-2 rounded-full", deal.stage !== "lost" && i <= stageIdx ? "bg-ink" : "bg-line")} title={s} />
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {flow.map((s) => (
            <form key={s} action={setDealStage}>
              <input type="hidden" name="id" value={deal.id} />
              <input type="hidden" name="stage" value={s} />
              <button
                disabled={deal.stage === s}
                className={cn("h-9 rounded-full border px-4 text-sm capitalize transition", deal.stage === s ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}
              >
                {s}
              </button>
            </form>
          ))}
          {deal.stage !== "lost" && (
            <form action={setDealStage} className="flex items-center gap-2">
              <input type="hidden" name="id" value={deal.id} />
              <input type="hidden" name="stage" value="lost" />
              <input name="lostReason" required placeholder="Reason for losing…" aria-label="Lost reason" className="h-9 w-52 rounded-full border border-line bg-paper/60 px-3 text-sm outline-none focus:border-ink" />
              <SubmitButton variant="outline" className="h-9 px-4">
                Mark lost
              </SubmitButton>
            </form>
          )}
        </div>
        {deal.stage === "lost" && (
          <p className={cn("mt-4 rounded-xl px-3 py-2 text-sm", deal.lostReason === "Not specified" ? "bg-butter/60" : "bg-rose/50")}>
            Lost reason: <strong>{deal.lostReason ?? "Not specified"}</strong>
            {deal.lostReason === "Not specified" && " — set a real reason in the details below."}
          </p>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title="Details">
            <DealForm deal={deal} companies={companies} contacts={contacts} members={members} />
          </Card>
          <Card title="Activities">
            <ActivityForm dealId={deal.id} />
            <div className="mt-5 border-t border-line pt-2">
              <ActivityTimeline items={activities} today={today} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Linked records">
            {!invoice[0] && !project[0] ? (
              <p className="text-sm text-ink-soft">Nothing linked yet. Winning the deal drafts an invoice and opens a project.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {invoice[0] && (
                  <li className="flex items-center justify-between gap-2">
                    <Link className="font-medium underline-offset-2 hover:underline" href={`/app/finance/invoices/${invoice[0].id}`}>
                      Invoice {invoice[0].number}
                    </Link>
                    <span className="flex items-center gap-2">
                      {formatMoney(invoice[0].total, cur)} <StatusBadge value={invoice[0].status} />
                    </span>
                  </li>
                )}
                {project[0] && (
                  <li>
                    <Link className="font-medium underline-offset-2 hover:underline" href={`/app/projects/${project[0].id}`}>
                      Project {project[0].code} · {project[0].name}
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </Card>
          <Card title="Stage history">
            {history.length === 0 ? (
              <p className="text-sm text-ink-soft">No history yet.</p>
            ) : (
              <ol className="space-y-3 border-l border-line pl-4">
                {history.map((h, i) => (
                  <li key={i} className="text-sm">
                    <p>{h.summary}</p>
                    <p className="text-xs text-ink-mute">
                      {h.actor ?? "System"} · {formatDateTime(h.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
