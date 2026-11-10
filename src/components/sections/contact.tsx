"use client";

import { AnimatePresence, motion } from "motion/react";
import { useActionState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { submitEnquiry } from "@/app/actions/contact";
import { SectionLabel } from "../ui/reveal";
import { SpinBadge } from "../ui/spin-badge";
import { Field, FieldError } from "../ui/field";

const INTERESTS = ["HRM", "CRM", "Finance", "Inventory", "Payroll", "Projects", "Helpdesk", "Everything"];
const SIZES = ["1–25", "26–100", "101–500", "500+"];

export function Contact() {
  const [state, action, pending] = useActionState(submitEnquiry, undefined);
  const v = state?.values ?? {};
  const pickedBefore = (v.interest ?? "").split(", ");

  return (
    <section id="contact" className="px-3 pb-3">
      <div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[36px] bg-signal px-5 py-20 text-ink md:px-12 md:py-24">
        <div className="dotted pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative mx-auto grid max-w-6xl gap-14 md:grid-cols-12">
          <div className="md:col-span-5">
            <SectionLabel index="07" className="text-ink/70 [&_span:last-child]:bg-ink/20">
              Contact
            </SectionLabel>
            <h2 className="mt-6 text-[clamp(2.4rem,6vw,5rem)] leading-[0.9] font-bold tracking-tight">
              Let&apos;s map your <span className="font-serif font-normal italic">mess.</span>
            </h2>
            <p className="mt-5 max-w-sm text-lg text-ink/80">
              Tell us which tools you use today. We&apos;ll come back with a migration plan and a demo built on your workflows — usually within a day.
            </p>
            <SpinBadge
              text="REPLY IN < 24 HRS · REAL HUMANS · "
              className="mt-10 hidden size-36 text-ink md:block"
              center={<span className="font-serif text-4xl italic">hi!</span>}
            />
          </div>

          <div className="md:col-span-7">
            <AnimatePresence mode="wait">
              {state?.ok ? (
                <motion.div
                  key="ok"
                  initial={{ opacity: 0, scale: 0.92, rotate: -2 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 200, damping: 18 }}
                  className="flex h-full min-h-[420px] flex-col items-start justify-center rounded-[28px] bg-paper p-10"
                >
                  <motion.svg viewBox="0 0 52 52" className="size-16">
                    <motion.circle cx="26" cy="26" r="24" fill="var(--color-lime)" initial={{ scale: 0 }} animate={{ scale: 1 }} />
                    <motion.path
                      d="M15 27 l7 7 l15 -16"
                      fill="none"
                      stroke="var(--color-ink)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ delay: 0.25, duration: 0.5 }}
                    />
                  </motion.svg>
                  <h3 className="mt-6 text-4xl font-semibold tracking-tight">Got it.</h3>
                  <p className="mt-2 max-w-sm text-lg text-ink-soft">{state.message}</p>
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  action={action}
                  exit={{ opacity: 0, y: -10 }}
                  className="rounded-[28px] bg-paper p-6 shadow-[0_30px_60px_-30px_rgba(20,20,18,.5)] md:p-8"
                  noValidate
                >
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

                  {/* Native inputs so selections submit even before hydration. */}
                  <fieldset>
                    <legend className="font-mono text-xs tracking-widest text-ink-mute uppercase">I&apos;m interested in</legend>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {INTERESTS.map((k) => (
                        <label key={k} className="cursor-pointer">
                          <input
                            type="checkbox"
                            name="interest"
                            value={k}
                            defaultChecked={pickedBefore.includes(k)}
                            className="peer sr-only"
                          />
                          <span className="inline-flex rounded-full border border-ink/20 px-4 py-2 text-sm transition-all select-none peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:ring-4 peer-focus-visible:ring-ink/15 hover:border-ink active:scale-95 peer-checked:[&>i]:inline">
                            <i className="mr-1 hidden text-lime not-italic">✓</i>
                            {k}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <Field label="Your name" name="name" defaultValue={v.name} errors={state?.errors?.name} autoComplete="name" />
                    <Field label="Work email" name="email" type="email" defaultValue={v.email} errors={state?.errors?.email} autoComplete="email" />
                    <Field label="Company" name="company" defaultValue={v.company} autoComplete="organization" />
                    <fieldset>
                      <legend className="mb-1.5 block text-sm font-medium">Team size</legend>
                      <div className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-card p-1">
                        {SIZES.map((s) => (
                          <label key={s} className="cursor-pointer">
                            <input
                              type="radio"
                              name="teamSize"
                              value={s}
                              defaultChecked={v.teamSize === s}
                              className="peer sr-only"
                            />
                            <span className="block rounded-lg py-2 text-center text-xs transition-colors select-none peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:ring-2 peer-focus-visible:ring-ink/30 hover:bg-paper-2 peer-checked:hover:bg-ink">
                              {s}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>

                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-sm font-medium">What are you using today?</span>
                    <textarea
                      name="message"
                      rows={4}
                      defaultValue={v.message}
                      placeholder="e.g. Tally for accounts, Excel for payroll, Zoho CRM, a WhatsApp group for approvals…"
                      className="w-full resize-none rounded-xl border border-line bg-card px-4 py-3 outline-none transition focus:border-ink focus:ring-4 focus:ring-ink/5"
                    />
                    <FieldError errors={state?.errors?.message} />
                  </label>

                  {state?.message && !state.ok && <p className="mt-3 text-sm text-signal">{state.message}</p>}

                  <button
                    disabled={pending}
                    className="group mt-6 flex w-full items-center justify-between rounded-full bg-ink py-2 pr-2 pl-6 text-paper transition disabled:opacity-60"
                  >
                    <span className="font-medium">{pending ? "Sending…" : "Send enquiry"}</span>
                    <span className="grid size-11 place-items-center rounded-full bg-lime text-ink transition-transform duration-500 ease-out-expo group-hover:rotate-45">
                      {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
                    </span>
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
