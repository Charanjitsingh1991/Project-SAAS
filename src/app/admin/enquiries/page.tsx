import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { StatusSelect } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDateTime } from "@/lib/format";
import { requirePlatformAdmin } from "@/lib/tenancy";
import { setEnquiryStatus } from "../actions";

export const metadata: Metadata = { title: "Enquiries" };

const STATUSES = ["new", "contacted", "closed"] as const;

export default async function AdminEnquiries(props: PageProps<"/admin/enquiries">) {
  await requirePlatformAdmin();
  const { status } = await props.searchParams;
  const filter = STATUSES.find((s) => s === status);

  const all = await db.select().from(schema.enquiries).orderBy(desc(schema.enquiries.createdAt));
  const rows = filter ? all.filter((e) => e.status === filter) : all;
  const count = (s: (typeof STATUSES)[number]) => all.filter((e) => e.status === s).length;

  return (
    <>
      <PageHeader
        title="Enquiries"
        description="Messages from the contact form on saas.tech. Update the status as you follow up."
        tabs={[
          { href: "/admin/enquiries", label: `All (${all.length})`, active: !filter },
          ...STATUSES.map((s) => ({ href: `/admin/enquiries?status=${s}`, label: `${s[0].toUpperCase()}${s.slice(1)} (${count(s)})`, active: filter === s })),
        ]}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="New" value={count("new")} tone="butter" />
        <Stat label="Contacted" value={count("contacted")} tone="sky" />
        <Stat label="Closed" value={count("closed")} tone="mint" />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nothing here">No enquiries with this status.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>From</Th>
                <Th>Interested in</Th>
                <Th>Message</Th>
                <Th>Received</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <p className="font-medium">{e.name}</p>
                    <Link href={`mailto:${e.email}`} className="text-xs text-ink-soft underline-offset-2 hover:underline">
                      {e.email}
                    </Link>
                    <p className="text-xs text-ink-mute">
                      {[e.company, e.teamSize && `${e.teamSize} people`].filter(Boolean).join(" · ")}
                    </p>
                  </Td>
                  <Td className="text-ink-soft">{e.interest || "—"}</Td>
                  <Td className="max-w-[320px] whitespace-pre-wrap text-ink-soft">{e.message}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(e.createdAt)}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <StatusBadge value={e.status} />
                      <StatusSelect action={setEnquiryStatus} id={e.id} value={e.status} options={STATUSES} label={`Status for ${e.name}`} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

