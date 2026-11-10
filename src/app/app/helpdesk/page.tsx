import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { ActionForm, Input, Select, StatusSelect, SubmitButton, Textarea } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { createTicket, setTicketPriority, setTicketStatus } from "./actions";

export const metadata: Metadata = { title: "Helpdesk" };

const STATUSES = ["open", "pending", "resolved"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export default async function HelpdeskPage(props: PageProps<"/app/helpdesk">) {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const sp = await props.searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const filter = STATUSES.find((s) => s === raw);

  const all = await db.select().from(schema.tickets).where(eq(schema.tickets.orgId, ws.org.id));

  const count = (s: string) => all.filter((t) => t.status === s).length;
  const urgentOpen = all.filter((t) => t.status === "open" && t.priority === "urgent").length;

  const rows = all
    .filter((t) => !filter || t.status === filter)
    .sort(
      (a, b) =>
        Number(a.status === "resolved") - Number(b.status === "resolved") ||
        RANK[a.priority] - RANK[b.priority] ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );

  const tabs = [
    { href: "/app/helpdesk", label: "All", active: !filter },
    ...STATUSES.map((s) => ({ href: `/app/helpdesk?status=${s}`, label: s[0].toUpperCase() + s.slice(1), active: filter === s })),
  ];

  return (
    <>
      <PageHeader title="Helpdesk" description="Track customer tickets and resolve them." tabs={tabs} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat tone="peach" label="Open" value={count("open")} />
        <Stat tone="butter" label="Pending" value={count("pending")} />
        <Stat tone="mint" label="Resolved" value={count("resolved")} />
        <Stat tone="rose" label="Urgent open" value={urgentOpen} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title={`Tickets (${rows.length})`}>
          {rows.length === 0 ? (
            <EmptyState title="No tickets" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Ticket</Th>
                  <Th>Customer</Th>
                  <Th>Priority</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <Td className="max-w-[260px]">
                      <p className="font-medium">{t.subject}</p>
                      {t.description && <p className="truncate text-xs text-ink-soft">{t.description}</p>}
                    </Td>
                    <Td className="text-ink-soft">{t.customerEmail}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={t.priority} />
                        <StatusSelect action={setTicketPriority} id={t.id} value={t.priority} name="priority" options={PRIORITIES} label="Change priority" />
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={t.status} />
                        <StatusSelect action={setTicketStatus} id={t.id} value={t.status} options={STATUSES} />
                      </div>
                    </Td>
                    <Td className="text-ink-soft">{formatDate(t.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="New ticket">
          <ActionForm action={createTicket} className="space-y-3">
            <Input label="Subject" name="subject" />
            <Input label="Customer email" name="customerEmail" type="email" />
            <Select label="Priority" name="priority" options={[...PRIORITIES]} defaultValue="medium" />
            <Textarea label="Description" name="description" />
            <SubmitButton className="w-full">Create ticket</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
