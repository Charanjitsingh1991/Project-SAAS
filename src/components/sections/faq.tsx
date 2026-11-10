"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Plus } from "lucide-react";
import { SectionLabel } from "../ui/reveal";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "Can we start with just one module?",
    a: "Yes. Most teams start with HRM or CRM and switch on Finance or Inventory a few weeks later. Because it's one database, new modules already know your people, customers and products.",
  },
  {
    q: "How long does migration take?",
    a: "Typically 1–3 weeks. We import from spreadsheets, Tally, Zoho, QuickBooks, HubSpot, Salesforce, Keka and SAP Business One for free, and a human checks the mapping with you.",
  },
  {
    q: "Is it compliant with Indian GST and payroll rules?",
    a: "Yes — GST invoicing, e-way bills, PF/ESI/PT/TDS and Form 16 are built in. We also support VAT and statutory payroll in 40+ other countries.",
  },
  {
    q: "Where is our data stored?",
    a: "In-region data centres (India, EU, US) with encryption at rest and in transit, daily backups and full audit logs. You can export everything at any time.",
  },
  {
    q: "Do you offer on-premise deployment?",
    a: "Enterprise customers can choose a dedicated single-tenant cloud. Fully on-premise installs are available for regulated industries on request.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto grid max-w-6xl gap-12 px-5 py-28 md:grid-cols-12">
      <div className="md:col-span-4">
        <SectionLabel index="06">FAQ</SectionLabel>
        <h2 className="mt-6 text-[clamp(2rem,4.4vw,3.6rem)] leading-[0.95] font-semibold tracking-tight">
          Fair <span className="font-serif font-normal italic">questions.</span>
        </h2>
        <p className="mt-4 text-ink-soft">
          Still curious?{" "}
          <a href="#contact" className="underline decoration-signal decoration-2 underline-offset-4">
            Ask a human
          </a>
          .
        </p>
      </div>
      <div className="md:col-span-8">
        {FAQS.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q} className="border-b border-line">
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-6 py-6 text-left"
              >
                <span className="font-mono text-xs text-ink-mute">0{i + 1}</span>
                <span className="flex-1 font-display text-xl font-medium md:text-2xl">{f.q}</span>
                <motion.span
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  className={cn("grid size-9 shrink-0 place-items-center rounded-full border transition-colors", isOpen ? "border-signal bg-signal text-white" : "border-ink/20")}
                >
                  <Plus className="size-4" />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="max-w-2xl pb-7 pl-10 text-ink-soft">{f.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
