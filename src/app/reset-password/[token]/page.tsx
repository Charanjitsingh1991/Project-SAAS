import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { AuthShell } from "@/components/auth-shell";
import { db, schema } from "@/db";
import { hashResetToken, isResetUsable } from "@/lib/password-reset";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

async function ResetBody({ params }: { params: PageProps<"/reset-password/[token]">["params"] }) {
  const { token } = await params;
  const [row] = await db
    .select({ expiresAt: schema.passwordResets.expiresAt, usedAt: schema.passwordResets.usedAt })
    .from(schema.passwordResets)
    .where(eq(schema.passwordResets.tokenHash, hashResetToken(token)))
    .limit(1);

  if (!row || !isResetUsable(row)) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl bg-signal/10 px-4 py-3 text-sm text-signal">This reset link is invalid, expired or already used.</p>
        <Link href="/forgot-password" className="font-medium text-ink underline decoration-signal decoration-2 underline-offset-4">
          Request a new link
        </Link>
      </div>
    );
  }
  return <ResetForm token={token} />;
}

export default function ResetPasswordPage(props: PageProps<"/reset-password/[token]">) {
  return (
    <AuthShell
      title={
        <>
          Choose a new <span className="font-serif font-normal italic">password.</span>
        </>
      }
      subtitle="You'll be signed in right after."
    >
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-paper-2" />}>
        <ResetBody params={props.params} />
      </Suspense>
    </AuthShell>
  );
}
