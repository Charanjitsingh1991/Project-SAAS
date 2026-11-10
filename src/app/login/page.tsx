import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { OAuthButtons } from "@/components/oauth-buttons";
import { oauthErrorMessage } from "@/lib/oauth";

export const metadata: Metadata = { title: "Log in" };

async function LoginForm({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { next, invite, error } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  const errorMessage = oauthErrorMessage(error);
  return (
    <>
      {errorMessage && <p className="mb-6 rounded-xl bg-signal/10 px-4 py-3 text-sm text-signal">{errorMessage}</p>}
      <OAuthButtons next={nextPath} invite={typeof invite === "string" ? invite : undefined} />
      <AuthForm mode="login" next={nextPath} />
    </>
  );
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <AuthShell
      title={
        <>
          Welcome <span className="font-serif font-normal italic">back.</span>
        </>
      }
      subtitle="Log in to your saasmodels.tech workspace."
    >
      <Suspense fallback={<AuthForm mode="login" />}>
        <LoginForm searchParams={props.searchParams} />
      </Suspense>
    </AuthShell>
  );
}
