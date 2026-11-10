import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <AuthShell
      title={
        <>
          Welcome <span className="font-serif font-normal italic">back.</span>
        </>
      }
      subtitle="Log in to your saas.tech workspace."
    >
      <AuthForm mode="login" />
    </AuthShell>
  );
}
