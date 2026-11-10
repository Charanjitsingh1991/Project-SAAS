import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title={
        <>
          Reset your <span className="font-serif font-normal italic">password.</span>
        </>
      }
      subtitle="Enter your email and we'll send you a link to choose a new one."
    >
      <ForgotForm />
    </AuthShell>
  );
}
