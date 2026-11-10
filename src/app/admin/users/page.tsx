import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { Card, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { requirePlatformAdmin } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Users" };

export default async function AdminUsers() {
  await requirePlatformAdmin();
  const [users, links] = await Promise.all([
    db.select().from(schema.users).orderBy(desc(schema.users.createdAt)),
    db
      .select({ userId: schema.memberships.userId, role: schema.memberships.role, org: schema.organizations.name })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.memberships.orgId, schema.organizations.id)),
  ]);
  const wsByUser = new Map<number, string[]>();
  for (const l of links) wsByUser.set(l.userId, [...(wsByUser.get(l.userId) ?? []), `${l.org} (${l.role})`]);

  const enquiryCounts = await db
    .select({ email: schema.enquiries.email, n: sql<number>`count(*)` })
    .from(schema.enquiries)
    .groupBy(schema.enquiries.email);
  const byEmail = new Map(enquiryCounts.map((e) => [e.email, e.n]));

  return (
    <>
      <PageHeader title="Users" description="Everyone who has signed up, and the workspaces they belong to." />
      <Card title={`Sign-ups (${users.length})`}>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Workspaces</Th>
              <Th>Enquiries</Th>
              <Th>Signed up</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <Td className="font-medium">{user.name}</Td>
                <Td>{user.email}</Td>
                <Td className="text-ink-soft">{wsByUser.get(user.id)?.join(", ") ?? <span className="text-ink-mute">No workspace yet</span>}</Td>
                <Td>{byEmail.get(user.email) ?? 0}</Td>
                <Td className="whitespace-nowrap">{formatDate(user.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

