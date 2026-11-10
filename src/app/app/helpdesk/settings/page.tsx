import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { CopyLink } from "@/components/app/copy-link";
import { ActionButton, ActionForm, Input, SubmitButton, Textarea } from "@/components/app/forms";
import { Card, EmptyState, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { getAssignmentConfig, getHelpdeskAgents, getSlaPolicies } from "@/lib/helpdesk-data";
import { requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";
import { deleteCannedAction, saveAssignmentAction, saveCannedAction, saveSlaAction } from "../actions";
import { HELPDESK_TABS } from "../tabs";

export const metadata: Metadata = { title: "Helpdesk settings" };

export default async function HelpdeskSettingsPage() {
  const ws = await requireWorkspace({ module: "helpdesk", manage: true });
  const orgId = ws.org.id;
  const [policies, assignment, agents, canned, origin] = await Promise.all([
    getSlaPolicies(orgId),
    getAssignmentConfig(orgId),
    getHelpdeskAgents(orgId),
    db.select().from(schema.cannedResponses).where(eq(schema.cannedResponses.orgId, orgId)).orderBy(asc(schema.cannedResponses.title)),
    appOrigin(),
  ]);

  return (
    <>
      <PageHeader title="Helpdesk settings" description="SLA targets, canned responses and your public support portal." tabs={HELPDESK_TABS("settings")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Public support portal">
          <p className="mb-3 text-sm text-ink-soft">Share this link with customers: help center, request form and private ticket pages.</p>
          <CopyLink url={`${origin}/support/${ws.org.slug}`} />
        </Card>

        <Card title="SLA policies">
          <p className="mb-3 text-sm text-ink-soft">Targets in hours. Applied to new tickets and recalculated when a ticket&apos;s priority changes.</p>
          <ActionForm action={saveSlaAction} resetOnSuccess={false}>
            <div className="grid grid-cols-[80px_1fr_1fr] items-end gap-3">
              <span />
              <span className="text-xs font-medium text-ink-soft">First response (h)</span>
              <span className="text-xs font-medium text-ink-soft">Resolution (h)</span>
              {policies.map((p) => (
                <SlaRow key={p.priority} p={p} />
              ))}
            </div>
            <div className="mt-4">
              <SubmitButton>Save SLA policies</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>

      <Card title="Auto-assignment" className="mt-6">
        <p className="mb-3 text-sm text-ink-soft">New tickets without an assignee go to the next agent in the rotation (round-robin).</p>
        <ActionForm action={saveAssignmentAction} resetOnSuccess={false} className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="enabled" defaultChecked={assignment.enabled} /> Enable round-robin assignment
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {agents.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="agents" value={a.id} defaultChecked={assignment.memberUserIds.includes(a.id)} /> {a.name}
                <span className="text-xs capitalize text-ink-mute">{a.role}</span>
              </label>
            ))}
          </div>
          <SubmitButton>Save auto-assignment</SubmitButton>
        </ActionForm>
      </Card>

      <Card title="Canned responses" className="mt-6">
        <div className="space-y-3">
          {canned.length === 0 && <EmptyState title="No canned responses">Add reusable replies below.</EmptyState>}
          {canned.map((c) => (
            <details key={c.id} className="rounded-2xl border border-line bg-paper/40">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{c.title}</summary>
              <div className="border-t border-line p-4">
                <ActionForm action={saveCannedAction} resetOnSuccess={false} className="space-y-3">
                  <input type="hidden" name="id" value={c.id} />
                  <Input label="Title" name="title" defaultValue={c.title} required maxLength={80} />
                  <Textarea label="Response" name="body" defaultValue={c.body} rows={5} required maxLength={5000} />
                  <SubmitButton>Save</SubmitButton>
                </ActionForm>
                <div className="mt-3">
                  <ActionButton action={deleteCannedAction} fields={{ id: c.id }} confirm="Delete this canned response?" className="text-signal">
                    Delete
                  </ActionButton>
                </div>
              </div>
            </details>
          ))}
        </div>
        <ActionForm action={saveCannedAction} className="mt-5 space-y-3 border-t border-line pt-5">
          <p className="font-display font-semibold">Add a canned response</p>
          <Input label="Title" name="title" required maxLength={80} />
          <Textarea label="Response" name="body" rows={4} required maxLength={5000} />
          <SubmitButton>Add response</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}

function SlaRow({ p }: { p: { priority: string; firstResponseMins: number; resolutionMins: number } }) {
  return (
    <>
      <span className="pb-2 text-sm font-medium capitalize">{p.priority}</span>
      <Input label="" name={`${p.priority}_response`} type="number" step="0.25" min="0.25" defaultValue={p.firstResponseMins / 60} aria-label={`${p.priority} first response hours`} />
      <Input label="" name={`${p.priority}_resolution`} type="number" step="0.25" min="0.25" defaultValue={p.resolutionMins / 60} aria-label={`${p.priority} resolution hours`} />
    </>
  );
}
