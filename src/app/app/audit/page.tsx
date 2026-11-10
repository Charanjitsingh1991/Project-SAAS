import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { auditFilters, auditRows } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { MODULES } from "@/lib/modules";
import { requireWorkspace } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Audit log" };

const field = "h-10 rounded-xl border border-line bg-card px-3 text-sm outline-none focus:border-ink";

export default async function AuditPage(props: PageProps<"/app/audit">) {
  const ws = await requireWorkspace({ manage: true, feature: "auditLog" });
  const sp = await props.searchParams;
  const f = auditFilters(sp);
  const [rows, members] = await Promise.all([
    auditRows(ws.org.id, f, 200),
    db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.orgId, ws.org.id)),
  ]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  const modules = [...MODULES.map((m) => ({ value: m.key, label: m.short })), { value: "settings", label: "Settings" }, { value: "billing", label: "Billing" }];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every create, update, approval and automation in this workspace, with who did it and when."
        actions={
          <a href={`/api/audit${qs ? `?${qs}` : ""}`} className="text-sm font-medium underline-offset-4 hover:underline">
            Export CSV
          </a>
        }
      />
      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-ink-soft">Module</span>
            <select name="module" defaultValue={f.module ?? ""} className={field}>
              <option value="">All</option>
              {modules.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-ink-soft">User</span>
            <select name="actor" defaultValue={f.actor ? String(f.actor) : ""} className={field}>
              <option value="">Anyone</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-ink-soft">From</span>
            <input type="date" name="from" defaultValue={f.from} className={field} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-ink-soft">To</span>
            <input type="date" name="to" defaultValue={f.to} className={field} />
          </label>
          <label className="grid flex-1 gap-1">
            <span className="text-xs font-medium text-ink-soft">Search</span>
            <input name="q" defaultValue={f.q} maxLength={100} placeholder="Summary or record type" className={field} />
          </label>
          <button className="h-10 rounded-full bg-ink px-5 font-medium text-paper">Filter</button>
        </form>
      </Card>
      <Card title={`${rows.length}${rows.length === 200 ? "+" : ""} events`}>
        {rows.length === 0 ? (
          <EmptyState title="No matching events" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>User</Th>
                <Th>Module</Th>
                <Th>Action</Th>
                <Th>Summary</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, actor }) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap text-ink-soft">{formatDateTime(a.createdAt)}</Td>
                  <Td>{actor ?? <span className="text-ink-mute">System</span>}</Td>
                  <Td className="capitalize">{a.module}</Td>
                  <Td className="font-mono text-xs">
                    {a.entityType}.{a.action}
                  </Td>
                  <Td>{a.summary}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
