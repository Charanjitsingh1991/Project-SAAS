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
    a: "Most teams are live in 1–3 weeks. Export employees, contacts, companies and products from spreadsheets, Tally, Zoho, QuickBooks, HubSpot or Keka as CSV and import them in a few clicks; we're happy to help you map the columns.",
  },
  {
    q: "Does it handle Indian and UAE tax and payroll?",
    a: "Yes. India: GST invoices (CGST/SGST/IGST), GST summary, PF, ESI, professional tax and TDS. UAE: 5% VAT invoices, VAT 201 summary, GPSSA, end-of-service gratuity and WPS salary files. Figures are prepared for your accountant to review before filing.",
  },
  {
    q: "Where is our data stored?",
    a: "In a managed cloud database, over encrypted connections, with every record scoped to your workspace. Enterprise adds a full audit log, and you can export your data as CSV at any time.",
  },
  {
    q: "Do you offer on-premise deployment?",
    a: "Not at the moment: saasmodels.tech runs as a managed cloud service. If you have specific data-residency requirements, talk to us before you sign up.",
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
