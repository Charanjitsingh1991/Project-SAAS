import { desc, eq, sql } from "drizzle-orm";
import { ActionButton } from "@/components/app/forms";
import { Badge, Card, PageHeader, Stat, Table, Td, Th, type Tone } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { planDef } from "@/lib/plans";
import { PLAN_PRICES } from "@/lib/stripe";
import { isPlatformAdmin, requirePlatformAdmin } from "@/lib/tenancy";
import { accessFor, type AccessState } from "@/lib/trial";
import { expireTrial, extendTrial, grantFreeAccess, revokeFreeAccess } from "./actions";

function stateBadge(a: AccessState): { tone: Tone; label: string } {
  switch (a.state) {
    case "comped":
      return { tone: "lilac", label: "Free access" };
    case "paid":
      return { tone: "mint", label: a.status === "trialing" ? "Paying · card added" : "Paying" };
    case "past_due":
      return { tone: "butter", label: "Payment failed" };
    case "trial":
      return { tone: a.lastDay ? "rose" : "lime", label: `Trial · day ${a.day}` };
    case "locked":
      return { tone: "signal", label: a.reason === "trial_ended" ? "Trial ended" : "Subscription ended" };
  }
}

type Org = typeof schema.organizations.$inferSelect;

/** Monthly equivalent in USD for a paying workspace (yearly prices are shown per month). */
function monthlyUsd(org: Org, seats: number) {
  if (org.plan === "enterprise") return null;
  return PLAN_PRICES[org.plan][org.billingInterval ?? "month"] * Math.max(1, seats);
}

function billingLine(org: Org, access: AccessState) {
  switch (access.state) {
    case "comped":
      return `Since ${formatDate(org.compedAt!)}`;
    case "trial":
      return `Trial ends ${formatDate(new Date(access.endsAt.getTime() - 1))}`;
    case "locked":
      return `Since ${formatDate(access.endedAt)}`;
    default:
      if (!org.currentPeriodEnd) return org.billingInterval === "year" ? "Billed yearly" : "Billed monthly";
      return `${org.billingInterval === "year" ? "Yearly" : "Monthly"} · ${org.cancelAtPeriodEnd ? "ends" : org.subscriptionStatus === "trialing" ? "first charge" : "renews"} ${formatDate(org.currentPeriodEnd)}`;
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
  const mrr = rows
    .filter((r) => r.access.state === "paid" && r.org.subscriptionStatus === "active")
    .reduce((sum, r) => sum + (monthlyUsd(r.org, r.members) ?? 0), 0);

  return (
    <>
      <PageHeader title="Workspaces" description="Every company that signed up: trial, payment and access status." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Users" value={users} hint={`${rows.length} workspaces`} />
        <Stat label="In trial" value={count("trial")} tone="lime" />
        <Stat label="Paying" value={count("paid")} tone="mint" hint={`${count("past_due")} payment failed`} />
        <Stat label="Est. MRR" value={`$${mrr.toLocaleString("en-US")}`} tone="sky" hint="Active subscriptions, list price" />
        <Stat label="Free access" value={count("comped")} tone="lilac" hint={`${count("locked")} deactivated`} />
        <Stat label="New enquiries" value={newEnquiries} tone="butter" />
      </div>

      <Card title={`All workspaces (${rows.length})`} className="mt-6">
        <Table>
          <thead>
            <tr>
              <Th>Workspace</Th>
              <Th>Owner</Th>
              <Th>Members</Th>
              <Th>Status</Th>
              <Th>Plan &amp; billing</Th>
              <Th>Card</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ org, owner, ownerEmail, members, access }) => {
              const b = stateBadge(access);
              const adminOwned = Boolean(ownerEmail && isPlatformAdmin(ownerEmail));
              const usd = access.state === "paid" || access.state === "past_due" ? monthlyUsd(org, members) : null;
              return (
                <tr key={org.id}>
                  <Td>
                    <p className="font-medium">{org.name}</p>
                    <p className="text-xs text-ink-mute">
                      Created {formatDate(org.createdAt)} · {org.country}
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
                  <Td className="whitespace-nowrap">
                    <p>
                      {planDef(org.plan).name}
                      {usd !== null && <span className="text-ink-mute"> · ${usd}/mo</span>}
                    </p>
                    <p className="text-xs text-ink-mute">{billingLine(org, access)}</p>
                  </Td>
                  <Td className="whitespace-nowrap capitalize">
                    {org.cardLast4 ? `${org.cardBrand} •${org.cardLast4}` : "—"}
                    {org.stripeCustomerId && (
                      <a
                        href={`https://dashboard.stripe.com/customers/${org.stripeCustomerId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-xs normal-case text-ink-soft underline underline-offset-2 hover:text-ink"
                      >
                        Open in Stripe
                      </a>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {access.state === "comped" ? (
                        adminOwned ? (
                          <span className="text-xs text-ink-mute">Platform admin</span>
                        ) : (
                          <ActionButton action={revokeFreeAccess} fields={{ orgId: org.id }} confirm={`Remove free access from ${org.name}? They return to normal billing.`}>
                            Remove free access
                          </ActionButton>
                        )
                      ) : (
                        <>
                          <ActionButton action={extendTrial} fields={{ orgId: org.id, days: 7 }}>
                            +7 days
                          </ActionButton>
                          {access.state === "trial" && (
                            <ActionButton action={expireTrial} fields={{ orgId: org.id }} confirm={`End ${org.name}'s trial now? Their workspace will be deactivated.`}>
                              End trial
                            </ActionButton>
                          )}
                          <ActionButton action={grantFreeAccess} fields={{ orgId: org.id }} confirm={`Give ${org.name} free Enterprise access with no trial or billing?`}>
                            Give free access
                          </ActionButton>
                        </>
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
