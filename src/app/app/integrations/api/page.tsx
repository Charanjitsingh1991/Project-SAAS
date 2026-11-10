import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { ActionButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { ENDPOINTS } from "@/lib/api/openapi";
import { RATE_LIMIT_PER_MINUTE } from "@/lib/api-keys";
import { formatDate, timeAgo } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";
import { createApiKey, revokeApiKey } from "./actions";
import { KeyForm } from "./key-form";

export const metadata: Metadata = { title: "REST API" };

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl bg-ink p-4 font-mono text-xs leading-relaxed text-paper">{children}</pre>;
}

export default async function ApiPage() {
  const ws = await requireWorkspace({ manage: true, feature: "developerApi" });
  const base = `${await appOrigin()}/api/v1`;
  const keys = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, ws.org.id)).orderBy(desc(schema.apiKeys.createdAt));

  const list = `curl ${base}/contacts?limit=25 \\
  -H "Authorization: Bearer sm_live_YOUR_KEY"`;
  const next = `curl "${base}/contacts?limit=25&cursor=NEXT_CURSOR" \\
  -H "Authorization: Bearer sm_live_YOUR_KEY"`;
  const create = `curl -X POST ${base}/contacts \\
  -H "Authorization: Bearer sm_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Asha Rao", "email": "asha@example.com", "lifecycle": "lead"}'`;
  const invoice = `curl -X POST ${base}/invoices \\
  -H "Authorization: Bearer sm_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"customer_name": "Acme Traders", "lines": [{"description": "Consulting", "quantity": 2, "unit_price": 500000, "tax_rate": 18}]}'`;
  const page = `{ "data": [ { "id": 1, "name": "Asha Rao", ... } ], "has_more": true, "next_cursor": "aWQ6MjU" }`;

  return (
    <>
      <PageHeader title="REST API" description="Connect your own tools, scripts and automation platforms to this workspace with an API key." />

      <div className="space-y-6">
        <Card title="Create an API key">
          <KeyForm action={createApiKey} />
          <p className="mt-3 text-xs text-ink-mute">
            Read-only keys can list data. Read + write keys can also create contacts, companies, deals, tickets and draft invoices. Treat keys like passwords; anyone with the key can act on this workspace.
          </p>
        </Card>

        <Card title={`API keys (${keys.length})`}>
          {keys.length === 0 ? (
            <EmptyState title="No keys yet">Create a key above to start calling the API.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Key</Th>
                  <Th>Access</Th>
                  <Th>Created</Th>
                  <Th>Last used</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <Td className="font-medium">{k.name}</Td>
                    <Td className="font-mono text-xs">{k.prefix}…</Td>
                    <Td>
                      <Badge tone={k.scope === "write" ? "butter" : "card"}>{k.scope === "write" ? "Read + write" : "Read only"}</Badge>
                    </Td>
                    <Td>{formatDate(k.createdAt)}</Td>
                    <Td>{k.lastUsedAt ? timeAgo(k.lastUsedAt) : "Never"}</Td>
                    <Td>
                      {k.revokedAt ? (
                        <Badge tone="rose">Revoked</Badge>
                      ) : (
                        <ActionButton action={revokeApiKey} fields={{ id: k.id }} confirm={`Revoke "${k.name}"? Anything using it will stop working.`}>
                          Revoke
                        </ActionButton>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="API reference" actions={<a href="/api/v1/openapi.json" className="text-sm font-medium underline underline-offset-4">OpenAPI 3.1 JSON</a>}>
          <div className="space-y-6 text-sm">
            <section className="space-y-2">
              <h3 className="font-semibold">Authentication</h3>
              <p className="text-ink-soft">
                Base URL <code className="font-mono text-xs">{base}</code>. Send your key in the <code className="font-mono text-xs">Authorization</code> header: <code className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</code>.
              </p>
              <Code>{list}</Code>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">Pagination</h3>
              <p className="text-ink-soft">
                List endpoints return up to <code className="font-mono text-xs">limit</code> items (default 25, max 100) in ascending id order. When <code className="font-mono text-xs">has_more</code> is true, pass <code className="font-mono text-xs">next_cursor</code> as <code className="font-mono text-xs">cursor</code> to get the next page.
              </p>
              <Code>{page}</Code>
              <Code>{next}</Code>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">Money, dates and errors</h3>
              <ul className="list-disc space-y-1 pl-5 text-ink-soft">
                <li>Money is an integer in minor units (paise, fils) next to a <code className="font-mono text-xs">currency</code> code. 500000 INR = ₹5,000.00.</li>
                <li>Dates are <code className="font-mono text-xs">YYYY-MM-DD</code>; timestamps are ISO 8601 UTC.</li>
                <li>
                  Errors look like <code className="font-mono text-xs">{`{"error":{"code":"…","message":"…"}}`}</code>: 400 bad request, 401 bad or revoked key, 403 plan, module, scope or deactivated workspace, 404 not found, 422 validation, 429 rate limit.
                </li>
                <li>Limit: {RATE_LIMIT_PER_MINUTE} requests per minute per key (best effort; counted per server instance). Check the <code className="font-mono text-xs">X-RateLimit-Remaining</code> header.</li>
                <li>Resources follow your enabled modules: a key cannot read a module that is switched off for the workspace.</li>
                <li>Employees never include salary, bank, tax-ID, passport or Emirates ID fields.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">Endpoints</h3>
              <Table compact>
                <thead>
                  <tr>
                    <Th>Method</Th>
                    <Th>Path</Th>
                    <Th>Description</Th>
                    <Th>Needs</Th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map((e) => (
                    <tr key={e.method + e.path}>
                      <Td>
                        <Badge tone={e.method === "GET" ? "sky" : "butter"}>{e.method}</Badge>
                      </Td>
                      <Td className="font-mono text-xs">{e.path}</Td>
                      <Td>
                        {e.summary}
                        {e.filters && <span className="block text-xs text-ink-mute">Filters: {e.filters.join(", ")}</span>}
                      </Td>
                      <Td className="text-xs">
                        {e.module} · {e.method === "GET" ? "read" : "write"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">Examples</h3>
              <p className="text-ink-soft">Create a contact (read + write key):</p>
              <Code>{create}</Code>
              <p className="text-ink-soft">Create a draft invoice. Prices are minor units; tax is computed from each line&apos;s rate. Drafts are not posted to the books until sent from the app.</p>
              <Code>{invoice}</Code>
            </section>
          </div>
        </Card>
      </div>
    </>
  );
}
