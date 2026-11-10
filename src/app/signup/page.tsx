import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthShell
      title={
        <>
          Start your <span className="font-serif font-normal italic">14 days.</span>
        </>
      }
      subtitle="No credit card. Every module unlocked during your trial."
    >
      <AuthForm mode="signup" />
    </AuthShell>
  );
}
