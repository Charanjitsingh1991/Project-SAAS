import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getSessionUser } from "@/lib/dal";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.emailVerified) redirect("/app");

  return (
    <AuthShell
      title={
        <>
          Check your <span className="font-serif font-normal italic">inbox.</span>
        </>
      }
      subtitle={
        <>
          We sent a 6-digit code to <b className="text-ink">{user.email}</b>. Enter it below to activate your account.
        </>
      }
    >
      <VerifyForm />
    </AuthShell>
  );
}
