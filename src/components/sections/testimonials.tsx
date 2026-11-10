"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { SectionLabel } from "../ui/reveal";
import { cn } from "@/lib/utils";

// Use cases describing real product behaviour (not customer quotes); swap in genuine testimonials after launch.
const QUOTES = [
  {
    quote: "Invoices post to the ledger the moment they're sent, payments update the balance, and the P&L, balance sheet and GST or VAT summary are ready when the month ends.",
    name: "Finance teams",
    role: "Month-end close",
    c: "bg-butter",
  },
  {
    quote: "Add a hire once. The onboarding checklist, leave balances, attendance and payroll all pick them up, and they check in, apply for leave and download payslips themselves.",
    name: "People teams",
    role: "Hire to payslip",
    c: "bg-mint",
  },
  {
    quote: "Reps see a customer's unpaid invoices and open tickets next to the deal, and winning it can draft the invoice and the project automatically.",
    name: "Sales teams",
    role: "Deal to invoice",
    c: "bg-sky",
  },
  {
    quote: "Stock moves when you invoice or receive a purchase order, costs stay weighted-average, and the reorder planner shows what runs out first.",
    name: "Operations teams",
    role: "Stock you can trust",
    c: "bg-peach",
  },
];

export function Testimonials() {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const go = (d: number) => {
    setDir(d);
    setI((n) => (n + d + QUOTES.length) % QUOTES.length);
  };
  const q = QUOTES[i];

  return (
    <section className="mx-auto max-w-6xl px-5 py-28">
      <SectionLabel index="04">How teams use it</SectionLabel>
      <div className="mt-12 grid items-center gap-12 md:grid-cols-12">
        <div className="md:col-span-4">
          <h2 className="text-[clamp(2rem,4.4vw,3.6rem)] leading-[0.95] font-semibold tracking-tight">
            Operators <span className="font-serif font-normal italic">love</span> boring month-ends.
          </h2>
          <div className="mt-8 flex items-center gap-3">
            {[-1, 1].map((d) => (
              <motion.button
                key={d}
                whileTap={{ scale: 0.9 }}
                onClick={() => go(d)}
                aria-label={d < 0 ? "Previous testimonial" : "Next testimonial"}
                className="grid size-12 place-items-center rounded-full border border-ink/20 transition-colors hover:bg-ink hover:text-paper"
              >
                {d < 0 ? <ArrowLeft className="size-4" /> : <ArrowRight className="size-4" />}
              </motion.button>
            ))}
            <span className="ml-2 font-mono text-sm text-ink-mute">
              0{i + 1} / 0{QUOTES.length}
            </span>
          </div>
        </div>

        <div className="relative h-[380px] md:col-span-8 md:h-[340px]">
          {/* paper stack behind */}
          {[2, 1].map((n) => (
            <div
              key={n}
              className={cn(
                "absolute inset-0 rounded-[28px] border border-ink/10",
                QUOTES[(i + n) % QUOTES.length].c,
              )}
              style={{ transform: `translate(${n * 10}px, ${n * 10}px) rotate(${n * 1.6}deg)`, opacity: 1 - n * 0.25 }}
            />
          ))}
          <AnimatePresence mode="popLayout" custom={dir} initial={false}>
            <motion.figure
              key={i}
              custom={dir}
              variants={{
                enter: (d: number) => ({ x: d * 80, rotate: d * 6, opacity: 0 }),
                center: { x: 0, rotate: 0, opacity: 1 },
                exit: (d: number) => ({ x: -d * 260, rotate: -d * 12, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 200, damping: 24 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              onDragEnd={(_, info) => {
                if (Math.abs(info.offset.x) > 80) go(info.offset.x < 0 ? 1 : -1);
              }}
              className={cn("absolute inset-0 flex cursor-grab flex-col rounded-[28px] border border-ink/10 p-8 active:cursor-grabbing md:p-10", q.c)}
            >
              <blockquote className="font-display text-xl leading-snug font-medium md:text-2xl">{q.quote}</blockquote>
              <figcaption className="mt-auto flex items-center gap-3 pt-6">
                <span className="grid size-11 place-items-center rounded-full bg-ink font-mono text-sm text-paper">
                  {q.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")}
                </span>
                <div>
                  <b className="block">{q.name}</b>
                  <span className="text-sm text-ink/65">{q.role}</span>
                </div>
              </figcaption>
            </motion.figure>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
