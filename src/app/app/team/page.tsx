import type { Metadata } from "next";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { Check, Minus } from "lucide-react";
import { CopyLink } from "@/components/app/copy-link";
import { ActionButton, ActionForm, Input, Select, StatusSelect, SubmitButton } from "@/components/app/forms";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { MODULES } from "@/lib/modules";
import { INVITABLE_ROLES, MODULE_ACCESS, ROLE_INFO, type ModuleKey } from "@/lib/roles";
import { requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";
import { changeRole, inviteMember, removeMember, revokeInvite, updateWorkspace } from "./actions";

export const metadata: Metadata = { title: "Team & roles" };

export default async function TeamPage() {
  const ws = await requireWorkspace({ manage: true });
  const orgId = ws.org.id;
  const origin = await appOrigin();

  const [members, invites] = await Promise.all([
    db
      .select({ m: schema.memberships, name: schema.users.name, email: schema.users.email })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.orgId, orgId))
      .orderBy(asc(schema.memberships.createdAt)),
    db
      .select()
      .from(schema.invites)
      .where(and(eq(schema.invites.orgId, orgId), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
      .orderBy(asc(schema.invites.createdAt)),
  ]);

  const roleOptions = INVITABLE_ROLES.map((r) => ({ value: r, label: ROLE_INFO[r].label }));

  return (
    <>
      <PageHeader title="Team & roles" description="Invite your employees and decide which modules each person can open." />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title={`Members (${members.length})`}>
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Role</Th>
                  <Th>Joined</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {members.map(({ m, name, email }) => {
                  const locked = m.role === "owner" || m.userId === ws.user.id;
                  return (
                    <tr key={m.id}>
                      <Td>
                        <p className="font-medium">
                          {name} {m.userId === ws.user.id && <span className="text-xs text-ink-mute">(you)</span>}
                        </p>
                        <p className="text-xs text-ink-mute">{email}</p>
                      </Td>
                      <Td>
                        {locked ? (
                          <Badge tone={m.role === "owner" ? "lime" : "card"}>{ROLE_INFO[m.role].label}</Badge>
                        ) : (
                          <StatusSelect action={changeRole} id={m.id} value={m.role} name="role" label={`Role for ${name}`} options={INVITABLE_ROLES} />
                        )}
                      </Td>
                      <Td>{formatDate(m.createdAt)}</Td>
                      <Td className="text-right">
                        {!locked && (
                          <ActionButton action={removeMember} fields={{ id: m.id }} confirm={`Remove ${name} from ${ws.org.name}?`}>
                            Remove
                          </ActionButton>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {invites.length > 0 && (
            <Card title={`Pending invites (${invites.length})`}>
              <ul className="divide-y divide-line">
                {invites.map((i) => (
                  <li key={i.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[200px_1fr_auto] md:items-center">
                    <div>
                      <p className="text-sm font-medium">{i.email}</p>
                      <p className="text-xs text-ink-mute">
                        {ROLE_INFO[i.role].label} · expires {formatDate(i.expiresAt)}
                      </p>
                    </div>
                    <CopyLink url={`${origin}/invite/${i.token}`} />
                    <ActionButton action={revokeInvite} fields={{ id: i.id }}>
                      Revoke
                    </ActionButton>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="What each role can open">
            <Table>
              <thead>
                <tr>
                  <Th>Role</Th>
                  {MODULES.map((m) => (
                    <Th key={m.key} className="text-center">
                      {m.short}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(ROLE_INFO) as (keyof typeof ROLE_INFO)[]).map((r) => (
                  <tr key={r}>
                    <Td>
                      <p className="font-medium">{ROLE_INFO[r].label}</p>
                      <p className="text-xs text-ink-mute">{ROLE_INFO[r].description}</p>
                    </Td>
                    {MODULES.map((m) => (
                      <Td key={m.key} className="text-center">
                        {MODULE_ACCESS[m.key as ModuleKey].includes(r) ? <Check className="mx-auto size-4" /> : <Minus className="mx-auto size-4 text-ink-mute/50" />}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Invite someone">
            <ActionForm action={inviteMember} className="space-y-3">
              <Input label="Work email" name="email" type="email" placeholder="colleague@company.com" />
              <Select label="Role" name="role" defaultValue="member" options={roleOptions} />
              <SubmitButton className="w-full">Create invite link</SubmitButton>
              <p className="text-xs text-ink-mute">They&apos;ll get a link to create their account and join this workspace. Links expire after 7 days.</p>
            </ActionForm>
          </Card>
          <Card title="Workspace settings">
            <ActionForm action={updateWorkspace} className="space-y-3" resetOnSuccess={false}>
              <Input label="Workspace name" name="name" defaultValue={ws.org.name} />
              <Select label="Currency" name="currency" defaultValue={ws.org.currency} options={["INR", "USD", "EUR", "GBP", "AED", "SGD"]} className="[&_select]:normal-case" />
              <SubmitButton variant="outline" className="w-full">
                Save
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
