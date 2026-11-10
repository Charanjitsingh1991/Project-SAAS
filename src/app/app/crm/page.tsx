import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { ActionButton, ActionForm, Input, Select, StatusSelect, SubmitButton } from "@/components/app/forms";
import { Card, PageHeader, Stat, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { DEAL_STAGES } from "@/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { createDeal, deleteDeal, setDealStage } from "./actions";
import { CRM_TABS } from "./tabs";

export const metadata: Metadata = { title: "CRM pipeline" };

export default async function CrmPage() {
  const ws = await requireWorkspace({ module: "crm" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;

  const [rows, contacts] = await Promise.all([
    db
      .select({ deal: schema.deals, contactName: schema.contacts.name, company: schema.contacts.company })
      .from(schema.deals)
      .leftJoin(schema.contacts, eq(schema.deals.contactId, schema.contacts.id))
      .where(eq(schema.deals.orgId, orgId))
      .orderBy(desc(schema.deals.createdAt)),
    db
      .select({ id: schema.contacts.id, name: schema.contacts.name })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, orgId))
      .orderBy(schema.contacts.name),
  ]);

  const open = rows.filter((r) => r.deal.stage !== "won" && r.deal.stage !== "lost");
  const won = rows.filter((r) => r.deal.stage === "won");
  const lost = rows.filter((r) => r.deal.stage === "lost");
  const sum = (list: typeof rows) => list.reduce((s, r) => s + r.deal.value, 0);
  const closed = won.length + lost.length;
  const winRate = closed ? Math.round((won.length / closed) * 100) : 0;

  return (
    <>
      <PageHeader title="CRM" description="Track deals from first lead to closed-won." tabs={CRM_TABS("pipeline")} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat tone="mint" label="Open pipeline" value={formatMoney(sum(open), cur)} />
        <Stat tone="butter" label="Won value" value={formatMoney(sum(won), cur)} />
        <Stat tone="sky" label="Win rate" value={`${winRate}%`} hint={`${won.length} won · ${lost.length} lost`} />
        <Stat tone="lilac" label="Open deals" value={open.length} />
      </div>

      <div className="mb-6 flex gap-4 overflow-x-auto pb-2">
        {DEAL_STAGES.map((stage) => {
          const col = rows.filter((r) => r.deal.stage === stage);
          return (
            <div key={stage} className="w-72 shrink-0 rounded-[20px] border border-line bg-paper/40 p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <StatusBadge value={stage} />
                <span className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">
                  {col.length} · {formatMoney(sum(col), cur)}
                </span>
              </div>
              <div className="space-y-3">
                {col.length === 0 && <p className="px-1 py-4 text-center text-sm text-ink-mute">No deals</p>}
                {col.map(({ deal: d, contactName, company }) => (
                  <div key={d.id} className="rounded-2xl border border-line bg-card p-3">
                    <p className="font-medium">{d.title}</p>
                    <p className="text-sm text-ink-soft">
                      {contactName ?? "No contact"}
                      {company ? ` · ${company}` : ""}
                    </p>
                    <p className="mt-2 font-display text-lg font-bold">{formatMoney(d.value, cur)}</p>
                    <p className="text-xs text-ink-mute">Close: {d.expectedClose ? formatDate(d.expectedClose) : "—"}</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <StatusSelect action={setDealStage} id={d.id} value={d.stage} name="stage" options={DEAL_STAGES} label="Move deal to stage" />
                      <ActionButton action={deleteDeal} fields={{ id: d.id }} confirm={`Delete deal "${d.title}"?`}>
                        <Trash2 className="size-3" /> Delete
                      </ActionButton>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Card title="New deal">
        <ActionForm action={createDeal} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Input label="Title" name="title" />
          <Select label="Contact" name="contactId" placeholder="No contact" options={contacts.map((c) => ({ value: c.id, label: c.name }))} />
          <Input label="Value" name="value" type="number" min={0} defaultValue={0} />
          <Select label="Stage" name="stage" options={[...DEAL_STAGES]} defaultValue="lead" />
          <Input label="Expected close" name="expectedClose" type="date" />
          <div className="flex items-end">
            <SubmitButton className="w-full">Add deal</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
