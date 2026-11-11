"use client";

import { useActionState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { resendCode, verifyEmail } from "@/app/actions/verify";
import { Field } from "@/components/ui/field";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyEmail, undefined);
  const [resent, resend, resending] = useActionState(resendCode, undefined);

  return (
    <div className="space-y-4">
      <form action={action} noValidate className="space-y-4">
        <Field
          label="Verification code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="123456"
          autoFocus
          errors={state?.errors?.code}
          className="[&_input]:font-mono [&_input]:text-xl [&_input]:tracking-[0.4em]"
        />
        {state?.message && <p className="rounded-xl bg-signal/10 px-4 py-3 text-sm text-signal">{state.message}</p>}
        <button disabled={pending} className="group flex w-full items-center justify-between rounded-full bg-ink py-2 pr-2 pl-6 text-paper transition disabled:opacity-60">
          <span className="font-medium">{pending ? "Checking…" : "Verify & continue"}</span>
          <span className="grid size-10 place-items-center rounded-full bg-lime text-ink">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
          </span>
        </button>
      </form>

      {resent?.message && (
        <p role="status" className={resent.ok ? "rounded-xl bg-lime/60 px-4 py-3 text-sm" : "rounded-xl bg-signal/10 px-4 py-3 text-sm text-signal"}>
          {resent.message}
        </p>
      )}
      <div className="flex items-center justify-between pt-2 text-sm text-ink-soft">
        <form action={resend}>
          <button disabled={resending} className="font-medium text-ink underline decoration-signal decoration-2 underline-offset-4 disabled:opacity-60">
            {resending ? "Sending…" : "Send a new code"}
          </button>
        </form>
        <form action={logout}>
          <button className="underline underline-offset-4 hover:text-ink">Use a different email</button>
        </form>
      </div>
      <p className="text-xs text-ink-mute">Can&apos;t find it? Check your spam folder. Codes expire after 10 minutes.</p>
    </div>
  );
}
