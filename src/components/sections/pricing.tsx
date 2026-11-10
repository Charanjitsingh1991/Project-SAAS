"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { Reveal, SectionLabel } from "../ui/reveal";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    name: "Starter",
    blurb: "For small teams getting out of spreadsheets.",
    monthly: 9,
    yearly: 7,
    cta: "Start free",
    href: "/signup",
    features: ["Any 3 core modules", "Up to 25 users", "Works on any phone browser", "Email support"],
  },
  {
    name: "Growth",
    blurb: "The full operating system for scaling companies.",
    monthly: 24,
    yearly: 19,
    cta: "Start free",
    href: "/signup",
    featured: true,
    features: ["Everything in Starter", "Finance, Inventory, Payroll", "Automations + Ask AI", "Webhooks & REST API", "Unlimited users"],
  },
  {
    name: "Enterprise",
    blurb: "For larger teams that need oversight and hands-on help.",
    monthly: null,
    yearly: null,
    cta: "Talk to sales",
    href: "/#contact",
    features: ["Everything in Growth", "Full audit log with export", "Unlimited workspaces & warehouses", "Dedicated success manager"],
  },
];

export function Pricing() {
  const [yearly, setYearly] = useState(true);

  return (
    <section id="pricing" className="relative bg-paper-2/70 py-28">
      <div className="mx-auto max-w-6xl px-5">
        <SectionLabel index="05">Pricing</SectionLabel>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-8">
          <h2 className="max-w-xl text-[clamp(2rem,5vw,4rem)] leading-[0.95] font-semibold tracking-tight">
            Priced per person, <span className="font-serif font-normal italic">not per app.</span>
          </h2>
          <LayoutGroup>
            <div className="inline-flex rounded-full border border-line bg-card p-1">
              {[
                { k: false, l: "Monthly" },
                { k: true, l: "Yearly −20%" },
              ].map((o) => (
                <button
                  key={o.l}
                  onClick={() => setYearly(o.k)}
                  className={cn("relative rounded-full px-5 py-2 text-sm font-medium transition-colors", yearly === o.k ? "text-paper" : "text-ink-soft")}
                >
                  {yearly === o.k && (
                    <motion.span layoutId="billing-pill" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 400, damping: 32 }} />
                  )}
                  <span className="relative">{o.l}</span>
                </button>
              ))}
            </div>
          </LayoutGroup>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 0.08}>
              <div
                className={cn(
                  "relative flex h-full flex-col rounded-[28px] border p-7",
                  p.featured ? "border-ink bg-ink text-paper md:-mt-4 md:pb-11" : "border-line bg-card",
                )}
              >
                {p.featured && (
                  <span className="absolute -top-3 right-6 rotate-3 rounded-full bg-lime px-3 py-1 font-mono text-[11px] text-ink uppercase">
                    most teams pick this
                  </span>
                )}
                <h3 className="text-2xl font-semibold">{p.name}</h3>
                <p className={cn("mt-1 text-sm", p.featured ? "text-paper/65" : "text-ink-soft")}>{p.blurb}</p>
                <div className="mt-8 flex h-16 items-end gap-1">
                  {p.monthly === null ? (
                    <span className="font-serif text-6xl leading-none italic">Let&apos;s talk</span>
                  ) : (
                    <>
                      <span className="mb-2 text-2xl">$</span>
                      <span className="relative inline-flex h-16 overflow-hidden font-display text-7xl leading-none font-bold tracking-tight">
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.span
                            key={yearly ? "y" : "m"}
                            initial={{ y: "100%" }}
                            animate={{ y: "0%" }}
                            exit={{ y: "-100%" }}
                            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                          >
                            {yearly ? p.yearly : p.monthly}
                          </motion.span>
                        </AnimatePresence>
                      </span>
                      <span className={cn("mb-2 ml-1 text-sm", p.featured ? "text-paper/60" : "text-ink-soft")}>/ user / mo</span>
                    </>
                  )}
                </div>
                <ul className="mt-8 space-y-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-3 text-[15px]">
                      <span className={cn("grid size-5 place-items-center rounded-full", p.featured ? "bg-lime text-ink" : "bg-ink text-paper")}>
                        <Check className="size-3" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={p.href}
                  className={cn(
                    "mt-auto block rounded-full py-3.5 text-center font-medium transition-transform hover:-translate-y-0.5",
                    "mt-10",
                    p.featured ? "bg-signal text-white" : "border border-ink/20 hover:border-ink",
                  )}
                >
                  {p.cta}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
