"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowUpRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { login, signup } from "@/app/actions/auth";
import { CountryPhoneFields } from "./country-phone";
import { Field } from "./ui/field";

export function AuthForm({
  mode,
  invite,
  next,
}: {
  mode: "login" | "signup";
  invite?: { token: string; email: string; orgName: string };
  next?: string;
}) {
  const [state, action, pending] = useActionState(mode === "login" ? login : signup, undefined);
  const [show, setShow] = useState(false);
  const v = state?.values ?? {};
  const isSignup = mode === "signup";

  return (
    <motion.form
      action={action}
      noValidate
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-4"
    >
      {invite && <input type="hidden" name="invite" value={invite.token} />}
      {next && <input type="hidden" name="next" value={next} />}
      {isSignup && (
        // Honeypot: hidden from people and screen readers; bots that fill it are rejected.
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-px w-px opacity-0" />
      )}
      {invite && (
        <p className="rounded-xl bg-lime/60 px-4 py-3 text-sm">
          You&apos;re joining <b>{invite.orgName}</b>. Create your account with <b>{invite.email}</b>.
        </p>
      )}
      {isSignup && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" name="name" defaultValue={v.name} errors={state?.errors?.name} autoComplete="name" className={invite ? "sm:col-span-2" : undefined} />
          {!invite && (
            <Field label="Company" name="company" defaultValue={v.company} autoComplete="organization" hint={<span className="text-xs text-ink-mute">optional</span>} />
          )}
        </div>
      )}
      {isSignup && !invite && <CountryPhoneFields defaultCountry={v.country} defaultPhone={v.phone} phoneError={state?.errors?.phone?.[0]} />}
      <Field
        label="Work email"
        name="email"
        type="email"
        defaultValue={invite?.email ?? v.email}
        readOnly={!!invite}
        errors={state?.errors?.email}
        autoComplete="email"
      />
      <div className="relative">
        <Field
          label="Password"
          name="password"
          type={show ? "text" : "password"}
          errors={state?.errors?.password}
          autoComplete={isSignup ? "new-password" : "current-password"}
          hint={
            isSignup ? (
              <span className="text-xs text-ink-mute">8+ chars, a letter & a number</span>
            ) : (
              <Link href="/forgot-password" className="text-xs font-normal text-ink-soft underline underline-offset-4 hover:text-ink">
                Forgot password?
              </Link>
            )
          }
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute top-[34px] right-3 grid size-8 place-items-center rounded-lg text-ink-mute hover:text-ink"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>

      {state?.message && (
        <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }} className="rounded-xl bg-signal/10 px-4 py-3 text-sm text-signal">
          {state.message}
        </motion.p>
      )}

      <button
        disabled={pending}
        className="group flex w-full items-center justify-between rounded-full bg-ink py-2 pr-2 pl-6 text-paper transition disabled:opacity-60"
      >
        <span className="font-medium">{pending ? "One sec…" : isSignup ? "Create account" : "Log in"}</span>
        <span className="grid size-10 place-items-center rounded-full bg-lime text-ink transition-transform duration-500 ease-out-expo group-hover:rotate-45">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
        </span>
      </button>

      <p className="pt-2 text-center text-sm text-ink-soft">
        {isSignup ? "Already have an account? " : "New to saasmodels.tech? "}
        <Link
          href={isSignup ? (invite ? `/login?next=/invite/${invite.token}&invite=${invite.token}` : "/login") : "/signup"}
          className="font-medium text-ink underline decoration-signal decoration-2 underline-offset-4"
        >
          {isSignup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </motion.form>
  );
}
