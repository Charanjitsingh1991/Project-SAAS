"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { requestPasswordReset } from "@/app/actions/password";
import { Field } from "@/components/ui/field";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);

  return (
    <form action={action} noValidate className="space-y-4">
      <Field label="Work email" name="email" type="email" defaultValue={state?.values?.email} errors={state?.errors?.email} autoComplete="email" />
      {state?.message && (
        <p role="status" className="rounded-xl bg-lime/60 px-4 py-3 text-sm">
          {state.message}
        </p>
      )}
      <button disabled={pending} className="group flex w-full items-center justify-between rounded-full bg-ink py-2 pr-2 pl-6 text-paper transition disabled:opacity-60">
        <span className="font-medium">{pending ? "One sec…" : "Email me a reset link"}</span>
        <span className="grid size-10 place-items-center rounded-full bg-lime text-ink">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
        </span>
      </button>
      <p className="pt-2 text-center text-sm text-ink-soft">
        <Link href="/login" className="font-medium text-ink underline decoration-signal decoration-2 underline-offset-4">
          Back to log in
        </Link>
      </p>
    </form>
  );
}
