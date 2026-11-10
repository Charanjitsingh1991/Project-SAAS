import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ActionButton, Input, Select, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { decryptSecret, secretHint } from "@/lib/crypto";
import { formatDateTime } from "@/lib/format";
import { EVENT_GROUPS, parseEvents } from "@/lib/integrations/catalog";
import { CHAT_HOST_HINT } from "@/lib/integrations/security";
import { hasFeature, requireWorkspace } from "@/lib/tenancy";
import { deleteEndpoint, redeliverAction, rotateSecret, saveEndpoint, sendTestEvent, toggleEndpoint } from "./actions";
import { EndpointForm, RotateSecret } from "./secret-forms";

export const metadata: Metadata = { title: "Webhooks & chat alerts" };

const KIND_LABEL = { webhook: "Webhook", slack: "Slack", teams: "Microsoft Teams", google_chat: "Google Chat" } as const;

const NODE_VERIFY = `import crypto from "node:crypto";

// rawBody must be the exact request body string, before JSON.parse.
export function isValid(headers, rawBody, secret) {
  const ts = headers["x-saasmodels-timestamp"];
  const sig = headers["x-saasmodels-signature"] ?? "";
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay window: 5 minutes
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(ts + "." + rawBody).digest("hex");
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}`;

const SAMPLE_PAYLOAD = `{
  "id": "evt_5b0e9d2f4c1a47e8b3a6",
  "event": "invoice.paid",
  "created_at": "2026-04-02T09:30:11.000Z",
  "workspace": { "id": 12, "name": "Acme Traders", "currency": "INR" },
  "data": {
    "id": 481,
    "number": "INV-0042",
    "customer": "Globex Ltd",
    "total": 1180000,
    "url": "https://app.example.com/app/finance/invoices/481"
  }
}`;

function EventPicker({ selected = [] }: { selected?: string[] }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-medium text-ink-soft">Events</legend>
      {EVENT_GROUPS.map((g) => (
        <div key={g.module}>
          <p className="font-mono text-[10px] tracking-widest text-ink-mute uppercase">{g.module}</p>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {g.events.map((e) => (
              <label key={e.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="events" value={e.key} defaultChecked={selected.includes(e.key)} className="size-4 accent-ink" />
                {e.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

function Pre({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl bg-ink p-4 font-mono text-[12px] leading-relaxed text-paper">{children}</pre>;
}

export default async function WebhooksPage({ searchParams }: { searchParams: Promise<{ endpoint?: string }> }) {
  const ws = await requireWorkspace({ manage: true });
  const orgId = ws.org.id;
  const sp = await searchParams;
  const canWebhook = hasFeature(ws, "developerApi");

  const [endpoints, recent] = await Promise.all([
    db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.orgId, orgId)).orderBy(desc(schema.webhookEndpoints.createdAt)),
    db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.orgId, orgId)).orderBy(desc(schema.webhookDeliveries.id)).limit(300),
  ]);
  const lastBy = new Map<number, (typeof recent)[number]>();
  for (const d of recent) if (!lastBy.has(d.endpointId)) lastBy.set(d.endpointId, d);

  const selected = endpoints.find((e) => String(e.id) === sp.endpoint) ?? null;
  const log = selected
    ? await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.endpointId, selected.id)).orderBy(desc(schema.webhookDeliveries.id)).limit(50)
    : [];

  const kinds = (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[])
    .filter((k) => k !== "webhook" || canWebhook)
    .map((k) => ({ value: k, label: KIND_LABEL[k] }));

  return (
    <>
      <PageHeader
        title="Webhooks & chat alerts"
        description="Send events from your workspace to Zapier, Make, n8n or your own server, or post them to Slack, Microsoft Teams and Google Chat."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card title={`Integrations (${endpoints.length})`}>
            {endpoints.length === 0 ? (
              <EmptyState title="Nothing connected yet">Add a Slack, Teams or Google Chat channel, or a webhook URL, using the form.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {endpoints.map((e) => {
                  const last = lastBy.get(e.id);
                  const events = parseEvents(e.events);
                  const secret = e.kind === "webhook" ? decryptSecret(e.secretEnc) : null;
                  const blocked = e.kind === "webhook" && !canWebhook;
                  return (
                    <li key={e.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {e.name} <Badge>{KIND_LABEL[e.kind]}</Badge>{" "}
                            {blocked ? <Badge tone="butter">Needs Growth plan</Badge> : <Badge tone={e.active ? "mint" : "rose"}>{e.active ? "Active" : "Disabled"}</Badge>}
                          </p>
                          <p className="mt-1 truncate font-mono text-xs text-ink-mute">{e.urlHint}</p>
                          {secret && <p className="font-mono text-xs text-ink-mute">Secret {secretHint(secret)}</p>}
                          <p className="mt-1 text-xs text-ink-soft">{events.length ? events.join(", ") : "No events"}</p>
                          <p className="mt-1 text-xs text-ink-mute">
                            {last ? (
                              <>
                                Last delivery {formatDateTime(last.createdAt)} ·{" "}
                                <Badge tone={last.status === "succeeded" ? "mint" : last.status === "failed" ? "rose" : "butter"}>{last.status}</Badge>
                                {last.responseStatus ? ` HTTP ${last.responseStatus}` : ""}
                              </>
                            ) : (
                              "No deliveries yet"
                            )}
                            {e.failureCount > 0 && ` · ${e.failureCount} consecutive failure${e.failureCount === 1 ? "" : "s"}`}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <ActionButton action={sendTestEvent} fields={{ id: e.id }}>
                            Send test event
                          </ActionButton>
                          <ActionButton action={toggleEndpoint} fields={{ id: e.id }}>
                            {e.active ? "Disable" : "Enable"}
                          </ActionButton>
                          <Link href={`?endpoint=${e.id}`} className="inline-flex h-8 items-center rounded-full border border-line px-3 text-xs font-medium hover:border-ink">
                            Deliveries
                          </Link>
                          <ActionButton action={deleteEndpoint} fields={{ id: e.id }} confirm={`Delete “${e.name}” and its delivery history?`}>
                            Delete
                          </ActionButton>
                        </div>
                      </div>
                      <details className="rounded-xl border border-line px-3 py-2">
                        <summary className="cursor-pointer text-xs font-medium">Edit</summary>
                        <EndpointForm action={saveEndpoint} className="mt-3 space-y-3" resetOnSuccess={false}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="kind" value={e.kind} />
                          <Input label="Name" name="name" defaultValue={e.name} />
                          <Input label="New URL (leave blank to keep the current one)" name="url" placeholder={e.urlHint} autoComplete="off" />
                          <EventPicker selected={events} />
                          <SubmitButton variant="outline">Save changes</SubmitButton>
                        </EndpointForm>
                        {e.kind === "webhook" && (
                          <div className="mt-3 border-t border-line pt-3">
                            <RotateSecret id={e.id} action={rotateSecret} />
                          </div>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {selected && (
            <Card title={`Deliveries — ${selected.name}`} actions={<Link href="?" className="text-xs underline">Close</Link>}>
              {log.length === 0 ? (
                <EmptyState title="No deliveries yet">Events show up here as soon as they are sent.</EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Event</Th>
                      <Th>Status</Th>
                      <Th>HTTP</Th>
                      <Th>Attempts</Th>
                      <Th>Response</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((d) => (
                      <tr key={d.id}>
                        <Td className="whitespace-nowrap">{formatDateTime(d.createdAt)}</Td>
                        <Td className="font-mono text-xs">{d.event}</Td>
                        <Td>
                          <Badge tone={d.status === "succeeded" ? "mint" : d.status === "failed" ? "rose" : "butter"}>{d.status}</Badge>
                          {d.status === "pending" && d.nextAttemptAt && <p className="mt-1 text-[11px] text-ink-mute">retry {formatDateTime(d.nextAttemptAt)}</p>}
                        </Td>
                        <Td>{d.responseStatus ?? "—"}</Td>
                        <Td>{d.attempts}</Td>
                        <Td className="max-w-[220px] truncate text-xs text-ink-mute">
                          <span title={d.responseBody ?? undefined}>{d.responseBody || "—"}</span>
                        </Td>
                        <Td className="text-right">
                          <ActionButton action={redeliverAction} fields={{ id: d.id }}>
                            Redeliver
                          </ActionButton>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Add an integration">
            <EndpointForm action={saveEndpoint} className="space-y-3">
              <Select label="Type" name="kind" defaultValue={kinds[0]?.value} options={kinds} />
              <Input label="Name" name="name" placeholder="e.g. #sales-alerts or Zapier" />
              <Input label="Destination URL" name="url" placeholder="https://…" autoComplete="off" />
              <EventPicker />
              <SubmitButton className="w-full">Add integration</SubmitButton>
              {!canWebhook && <p className="text-xs text-ink-mute">Generic webhooks (Zapier, Make, n8n, your own server) are part of the Growth plan. Chat alerts work on every plan.</p>}
              <p className="text-xs text-ink-mute">
                Chat URLs are stored encrypted. Expected hosts: Slack {CHAT_HOST_HINT.slack}, Teams {CHAT_HOST_HINT.teams}, Google Chat {CHAT_HOST_HINT.google_chat}.
              </p>
            </EndpointForm>
          </Card>

          <Card title="Connect your tools">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-medium">Zapier</dt>
                <dd className="text-ink-soft">Create a Zap with “Webhooks by Zapier” → “Catch Hook”, copy its URL here as a Webhook.</dd>
              </div>
              <div>
                <dt className="font-medium">Make</dt>
                <dd className="text-ink-soft">Add a “Custom webhook” module to a scenario and paste its address.</dd>
              </div>
              <div>
                <dt className="font-medium">n8n</dt>
                <dd className="text-ink-soft">Add a “Webhook” node (method POST) and use its production URL.</dd>
              </div>
              <div>
                <dt className="font-medium">Slack</dt>
                <dd className="text-ink-soft">Add the “Incoming Webhooks” app to your workspace, pick a channel and copy the URL (hooks.slack.com).</dd>
              </div>
              <div>
                <dt className="font-medium">Microsoft Teams</dt>
                <dd className="text-ink-soft">In the channel choose Workflows → “Post to a channel when a webhook request is received”, then copy the generated URL.</dd>
              </div>
              <div>
                <dt className="font-medium">Google Chat</dt>
                <dd className="text-ink-soft">In the space open Apps &amp; integrations → Webhooks, add one and copy its URL.</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      <div className="mt-6">
        <Card title="Payload & signature verification">
          <div className="space-y-4 text-sm text-ink-soft">
            <p>
              Webhooks receive a JSON <code>POST</code> with the headers <code>X-Saasmodels-Event</code>, <code>X-Saasmodels-Delivery</code> (unique event id, use it to de-duplicate),{" "}
              <code>X-Saasmodels-Timestamp</code> (unix seconds) and <code>X-Saasmodels-Signature</code> = <code>sha256=</code> + HMAC-SHA256 of <code>timestamp + &quot;.&quot; + body</code> with your signing
              secret. Amounts are in minor units (paise/cents). Respond with any 2xx within 10 seconds; failures are retried after 1 min, 5 min, 30 min, 2 h and 12 h, and an endpoint is switched off after 20
              consecutive failures.
            </p>
            <Pre>{SAMPLE_PAYLOAD}</Pre>
            <p>Verify the signature in Node:</p>
            <Pre>{NODE_VERIFY}</Pre>
          </div>
        </Card>
      </div>
    </>
  );
}
