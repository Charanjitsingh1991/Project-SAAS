"use client";

import { useActionState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { resetPassword } from "@/app/actions/password";
import { Field } from "@/components/ui/field";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, undefined);

  return (
    <form action={action} noValidate className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        errors={state?.errors?.password}
        hint={<span className="text-xs text-ink-mute">8+ chars, a letter & a number</span>}
      />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" errors={state?.errors?.confirm} />
      {state?.message && <p className="rounded-xl bg-signal/10 px-4 py-3 text-sm text-signal">{state.message}</p>}
      <button disabled={pending} className="group flex w-full items-center justify-between rounded-full bg-ink py-2 pr-2 pl-6 text-paper transition disabled:opacity-60">
        <span className="font-medium">{pending ? "One sec…" : "Set new password"}</span>
        <span className="grid size-10 place-items-center rounded-full bg-lime text-ink">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
        </span>
      </button>
    </form>
  );
}
