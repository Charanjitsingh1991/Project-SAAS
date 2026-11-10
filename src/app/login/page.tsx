import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Log in" };

async function LoginForm({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const next = (await searchParams).next;
  return <AuthForm mode="login" next={typeof next === "string" ? next : undefined} />;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <AuthShell
      title={
        <>
          Welcome <span className="font-serif font-normal italic">back.</span>
        </>
      }
      subtitle="Log in to your saas.tech workspace."
    >
      <Suspense fallback={<AuthForm mode="login" />}>
        <LoginForm searchParams={props.searchParams} />
      </Suspense>
    </AuthShell>
  );
}
