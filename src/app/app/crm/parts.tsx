import { ActionForm, Input, Select, SubmitButton, Textarea, ActionButton } from "@/components/app/forms";
import { Badge, EmptyState } from "@/components/app/ui";
import { ACTIVITY_TYPES, DEAL_STAGES, LEAD_SOURCES, LIFECYCLES, type DealStage } from "@/db/schema";
import { formatDate, fromMinor } from "@/lib/format";
import { scoreTone } from "@/lib/crm";
import { addActivity, createCompany, createContact, createDeal, deleteActivity, toggleActivity, updateCompany, updateContact, updateDeal } from "./actions";
import { Check, Circle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Opt = { value: number; label: string };
type Member = { id: number; name: string };
const memberOpts = (m: Member[]) => m.map((x) => ({ value: x.id, label: x.name }));

export function ScoreChip({ score }: { score: number }) {
  return <Badge tone={scoreTone(score)}>Score {score}</Badge>;
}

export type DealFormValues = {
  id?: number;
  title?: string;
  value?: number;
  companyId?: number | null;
  contactId?: number | null;
  ownerId?: number | null;
  source?: string;
  expectedClose?: string | null;
  stage?: DealStage;
  probability?: number;
  lostReason?: string | null;
};

export function DealForm({ deal, companies, contacts, members, ownerDefault }: { deal?: DealFormValues; companies: Opt[]; contacts: Opt[]; members: Member[]; ownerDefault?: number }) {
  const editing = !!deal?.id;
  return (
    <ActionForm action={editing ? updateDeal : createDeal} resetOnSuccess={!editing} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {editing && <input type="hidden" name="id" value={deal!.id} />}
      <Input label="Title" name="title" defaultValue={deal?.title} placeholder="ERP rollout — Phase 1" className="sm:col-span-2" required />
      <Input label="Value (major units)" name="value" inputMode="decimal" defaultValue={deal ? fromMinor(deal.value) : undefined} placeholder="250000" />
      <Select label="Company" name="companyId" options={companies} placeholder="— None —" defaultValue={deal?.companyId ?? ""} />
      <Select label="Contact" name="contactId" options={contacts} placeholder="— None —" defaultValue={deal?.contactId ?? ""} />
      <Select label="Owner" name="ownerId" options={memberOpts(members)} placeholder="— Unassigned —" defaultValue={deal?.ownerId ?? ownerDefault ?? ""} />
      <Select label="Source" name="source" options={LEAD_SOURCES} defaultValue={deal?.source ?? "other"} />
      <Input label="Expected close" name="expectedClose" type="date" defaultValue={deal?.expectedClose ?? undefined} />
      <Select label="Stage" name="stage" options={DEAL_STAGES} defaultValue={deal?.stage ?? "lead"} />
      {editing && <Input label="Probability %" name="probability" type="number" min={0} max={100} defaultValue={deal!.probability} />}
      <Input label="Lost reason" name="lostReason" defaultValue={deal?.lostReason ?? undefined} placeholder="Required when stage is lost" />
      <div className="flex items-end">
        <SubmitButton>{editing ? "Save deal" : "Create deal"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CompanyForm({ company, members }: { company?: { id: number; name: string; industry: string | null; website: string | null; phone: string | null; gstin: string | null; billingAddress: string | null; city: string | null; state: string | null; country: string | null; ownerId: number | null }; members: Member[] }) {
  const editing = !!company;
  return (
    <ActionForm action={editing ? updateCompany : createCompany} resetOnSuccess={!editing} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {editing && <input type="hidden" name="id" value={company.id} />}
      <Input label="Name" name="name" defaultValue={company?.name} required />
      <Input label="Industry" name="industry" defaultValue={company?.industry ?? undefined} />
      <Input label="Website" name="website" defaultValue={company?.website ?? undefined} />
      <Input label="Phone" name="phone" defaultValue={company?.phone ?? undefined} />
      <Input label="GSTIN" name="gstin" defaultValue={company?.gstin ?? undefined} placeholder="27AABCU9603R1ZM" />
      <Select label="Owner" name="ownerId" options={memberOpts(members)} placeholder="— Unassigned —" defaultValue={company?.ownerId ?? ""} />
      <Input label="City" name="city" defaultValue={company?.city ?? undefined} />
      <Input label="State" name="state" defaultValue={company?.state ?? undefined} />
      <Input label="Country" name="country" defaultValue={company?.country ?? "India"} />
      <Textarea label="Billing address" name="billingAddress" defaultValue={company?.billingAddress ?? undefined} className="sm:col-span-2 lg:col-span-2" />
      <div className="flex items-end">
        <SubmitButton>{editing ? "Save company" : "Add company"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ContactForm({ contact, companies, members, companyId }: { contact?: { id: number; name: string; title: string | null; email: string | null; phone: string | null; companyId: number | null; ownerId: number | null; lifecycle: string; source: string }; companies: Opt[]; members: Member[]; companyId?: number }) {
  const editing = !!contact;
  return (
    <ActionForm action={editing ? updateContact : createContact} resetOnSuccess={!editing} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {editing && <input type="hidden" name="id" value={contact.id} />}
      <Input label="Name" name="name" defaultValue={contact?.name} required />
      <Input label="Title" name="title" defaultValue={contact?.title ?? undefined} />
      <Input label="Email" name="email" type="email" defaultValue={contact?.email ?? undefined} />
      <Input label="Phone" name="phone" defaultValue={contact?.phone ?? undefined} />
      <Select label="Company" name="companyId" options={companies} placeholder="— None —" defaultValue={contact?.companyId ?? companyId ?? ""} />
      <Select label="Owner" name="ownerId" options={memberOpts(members)} placeholder="— Unassigned —" defaultValue={contact?.ownerId ?? ""} />
      <Select label="Lifecycle" name="lifecycle" options={LIFECYCLES} defaultValue={contact?.lifecycle ?? "lead"} />
      <Select label="Source" name="source" options={LEAD_SOURCES} defaultValue={contact?.source ?? "other"} />
      <div className="flex items-end">
        <SubmitButton>{editing ? "Save contact" : "Add contact"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ActivityForm({ dealId, contactId, companyId }: { dealId?: number; contactId?: number; companyId?: number }) {
  return (
    <ActionForm action={addActivity} className="grid gap-3 sm:grid-cols-2">
      {dealId && <input type="hidden" name="dealId" value={dealId} />}
      {contactId && <input type="hidden" name="contactId" value={contactId} />}
      {companyId && <input type="hidden" name="companyId" value={companyId} />}
      <Select label="Type" name="type" options={ACTIVITY_TYPES} defaultValue="note" />
      <Input label="Due date (optional)" name="dueDate" type="date" />
      <Input label="Subject" name="subject" className="sm:col-span-2" required />
      <Textarea label="Details" name="body" className="sm:col-span-2" />
      <div>
        <SubmitButton>Add activity</SubmitButton>
      </div>
    </ActionForm>
  );
}

export type ActivityRow = { id: number; type: string; subject: string; body: string | null; dueDate: string | null; done: boolean; createdAt: Date };

export function ActivityTimeline({ items, today }: { items: ActivityRow[]; today: string }) {
  if (!items.length) return <EmptyState title="No activities yet">Log a call, meeting or task above.</EmptyState>;
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => {
        const overdue = !a.done && !!a.dueDate && a.dueDate < today;
        return (
          <li key={a.id} className="flex items-start gap-3 py-3">
            <form action={toggleActivity}>
              <input type="hidden" name="id" value={a.id} />
              <button aria-label={a.done ? "Mark open" : "Mark done"} className="mt-0.5 text-ink-soft hover:text-ink">
                {a.done ? <Check className="size-5 rounded-full bg-mint p-1" /> : <Circle className="size-5" />}
              </button>
            </form>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", a.done && "text-ink-mute line-through")}>
                <Badge>{a.type}</Badge> <span className="ml-1">{a.subject}</span>
              </p>
              {a.body && <p className="mt-1 text-sm whitespace-pre-line text-ink-soft">{a.body}</p>}
              <p className={cn("mt-1 text-xs", overdue ? "font-medium text-signal" : "text-ink-mute")}>
                {a.dueDate ? `${overdue ? "Overdue · " : "Due "}${formatDate(a.dueDate)}` : `Logged ${formatDate(a.createdAt.toISOString().slice(0, 10))}`}
              </p>
            </div>
            <ActionButton action={deleteActivity} fields={{ id: a.id }} confirm="Delete this activity?">
              <Trash2 className="size-3" />
            </ActionButton>
          </li>
        );
      })}
    </ul>
  );
}

