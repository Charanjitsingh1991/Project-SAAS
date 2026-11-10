import { desc, eq, sql } from "drizzle-orm";
import { ActionButton } from "@/components/app/forms";
import { Badge, Card, PageHeader, Stat, Table, Td, Th, type Tone } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { requirePlatformAdmin } from "@/lib/tenancy";
import { accessFor, type AccessState } from "@/lib/trial";
import { expireTrial, extendTrial } from "./actions";

function stateBadge(a: AccessState): { tone: Tone; label: string } {
  switch (a.state) {
    case "paid":
      return { tone: "mint", label: "Paying" };
    case "past_due":
      return { tone: "butter", label: "Past due" };
    case "trial":
      return { tone: a.lastDay ? "rose" : "lime", label: `Trial · day ${a.day}` };
    case "locked":
      return { tone: "signal", label: "Deactivated" };
  }
}

export default async function AdminHome() {
  await requirePlatformAdmin();

  const [orgs, users, newEnquiries, memberCounts] = await Promise.all([
    db
      .select({ org: schema.organizations, owner: schema.users.name, ownerEmail: schema.users.email })
      .from(schema.organizations)
      .leftJoin(schema.users, eq(schema.organizations.ownerId, schema.users.id))
      .orderBy(desc(schema.organizations.createdAt)),
    db.$count(schema.users),
    db.$count(schema.enquiries, eq(schema.enquiries.status, "new")),
    db
      .select({ orgId: schema.memberships.orgId, n: sql<number>`count(*)` })
      .from(schema.memberships)
      .groupBy(schema.memberships.orgId),
  ]);

  const membersOf = new Map(memberCounts.map((m) => [m.orgId, m.n]));
  const rows = orgs.map((r) => ({ ...r, members: membersOf.get(r.org.id) ?? 0, access: accessFor(r.org) }));
  const count = (s: AccessState["state"]) => rows.filter((r) => r.access.state === s).length;

  return (
    <>
      <PageHeader title="Workspaces" description="Every company that signed up, their trial and subscription status." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Users" value={users} />
        <Stat label="Workspaces" value={rows.length} />
        <Stat label="In trial" value={count("trial")} tone="lime" />
        <Stat label="Paying" value={count("paid") + count("past_due")} tone="mint" />
        <Stat label="New enquiries" value={newEnquiries} tone="butter" hint={`${count("locked")} deactivated workspaces`} />
      </div>

      <Card title={`All workspaces (${rows.length})`} className="mt-6">
        <Table>
          <thead>
            <tr>
              <Th>Workspace</Th>
              <Th>Owner</Th>
              <Th>Members</Th>
              <Th>Status</Th>
              <Th>Trial ends</Th>
              <Th>Card</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ org, owner, ownerEmail, members, access }) => {
              const b = stateBadge(access);
              return (
                <tr key={org.id}>
                  <Td>
                    <p className="font-medium">{org.name}</p>
                    <p className="text-xs text-ink-mute">
                      Created {formatDate(org.createdAt)} · {org.plan}
                    </p>
                  </Td>
                  <Td>
                    <p>{owner ?? "—"}</p>
                    <p className="text-xs text-ink-mute">{ownerEmail}</p>
                  </Td>
                  <Td>{members}</Td>
                  <Td>
                    <Badge tone={b.tone}>{b.label}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(org.trialEndsAt)}</Td>
                  <Td className="whitespace-nowrap capitalize">{org.cardLast4 ? `${org.cardBrand} •${org.cardLast4}` : "—"}</Td>
                  <Td>
                    <div className="flex justify-end gap-1.5">
                      <ActionButton action={extendTrial} fields={{ orgId: org.id, days: 7 }}>
                        +7 days
                      </ActionButton>
                      {access.state === "trial" && (
                        <ActionButton action={expireTrial} fields={{ orgId: org.id }} confirm={`End ${org.name}'s trial now? Their workspace will be deactivated.`}>
                          End trial
                        </ActionButton>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
