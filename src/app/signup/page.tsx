import type { Metadata } from "next";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { db, schema } from "@/db";

export const metadata: Metadata = { title: "Create account" };

async function SignupForm({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  const token = (await searchParams).invite;
  if (typeof token === "string" && token) {
    const [row] = await db
      .select({ email: schema.invites.email, orgName: schema.organizations.name })
      .from(schema.invites)
      .innerJoin(schema.organizations, eq(schema.invites.orgId, schema.organizations.id))
      .where(and(eq(schema.invites.token, token), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
      .limit(1);
    if (row) return <AuthForm mode="signup" invite={{ token, email: row.email, orgName: row.orgName }} />;
    return (
      <>
        <p className="mb-6 rounded-xl bg-signal/10 px-4 py-3 text-sm text-signal">This invite link has expired or was already used. You can still create your own workspace below.</p>
        <AuthForm mode="signup" />
      </>
    );
  }
  return <AuthForm mode="signup" />;
}

export default function SignupPage(props: PageProps<"/signup">) {
  return (
    <AuthShell
      title={
        <>
          Start your <span className="font-serif font-normal italic">14 days.</span>
        </>
      }
      subtitle="No credit card. Every module unlocked during your trial."
    >
      <Suspense fallback={<AuthForm mode="signup" />}>
        <SignupForm searchParams={props.searchParams} />
      </Suspense>
    </AuthShell>
  );
}
