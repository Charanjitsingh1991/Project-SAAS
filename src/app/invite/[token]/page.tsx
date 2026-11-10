import type { Metadata } from "next";
import { and, eq, gt, isNull } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/app/actions/auth";
import { SubmitButton } from "@/components/app/forms";
import { Logo } from "@/components/logo";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/dal";
import { ROLE_INFO } from "@/lib/roles";
import { acceptInvite } from "./actions";

export const metadata: Metadata = { title: "Join workspace" };

async function InviteBody({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  const [row] = await db
    .select({ invite: schema.invites, orgName: schema.organizations.name, inviter: schema.users.name })
    .from(schema.invites)
    .innerJoin(schema.organizations, eq(schema.invites.orgId, schema.organizations.id))
    .innerJoin(schema.users, eq(schema.invites.invitedBy, schema.users.id))
    .where(and(eq(schema.invites.token, token), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
    .limit(1);

  if (!row) {
    return (
      <>
        <h1 className="text-4xl font-semibold tracking-tight">This invite isn&apos;t valid anymore.</h1>
        <p className="mt-3 text-ink-soft">It may have expired or already been used. Ask your admin for a new link.</p>
        <Link href="/" className="mt-8 inline-block underline underline-offset-4">
          Back to saasmodels.tech
        </Link>
      </>
    );
  }

  const user = await getCurrentUser();
  const { invite, orgName, inviter } = row;

  return (
    <>
      <p className="font-mono text-xs tracking-widest text-ink-mute uppercase">You&apos;re invited</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        Join <span className="font-serif font-normal italic">{orgName}</span>
      </h1>
      <p className="mt-3 text-ink-soft">
        {inviter} invited <b className="text-ink">{invite.email}</b> as <b className="text-ink">{ROLE_INFO[invite.role].label}</b> —{" "}
        {ROLE_INFO[invite.role].description.toLowerCase()}
      </p>

      <div className="mt-8 rounded-[20px] border border-line bg-card p-6">
        {!user ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={`/signup?invite=${token}`} className="flex-1 rounded-full bg-ink py-3 text-center font-medium text-paper">
              Create my account
            </Link>
            <Link href={`/login?next=/invite/${token}&invite=${token}`} className="flex-1 rounded-full border border-ink/20 py-3 text-center font-medium">
              I already have an account
            </Link>
          </div>
        ) : user.email.toLowerCase() === invite.email.toLowerCase() ? (
          <form action={acceptInvite}>
            <input type="hidden" name="token" value={token} />
            <SubmitButton className="w-full">Accept & open workspace</SubmitButton>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              You&apos;re logged in as <b>{user.email}</b>, but this invite is for <b>{invite.email}</b>.
            </p>
            <form action={logout}>
              <SubmitButton variant="outline">Log out and switch account</SubmitButton>
            </form>
          </div>
        )}
      </div>
    </>
  );
}

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-6 py-8">
      <Logo />
      <div className="flex flex-1 flex-col justify-center py-12">
        <Suspense fallback={<div className="h-48 animate-pulse rounded-[20px] bg-paper-2" />}>
          <InviteBody params={props.params} />
        </Suspense>
      </div>
    </div>
  );
}
