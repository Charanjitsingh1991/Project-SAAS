"use client";

import { VelocityMarquee } from "../ui/velocity-marquee";
import { Asterisk } from "../ui/spin-badge";

const WORDS = ["HRM", "CRM", "Accounting", "Inventory", "Payroll", "Projects", "Helpdesk", "Analytics"];

export function Ticker() {
  return (
    <section aria-label="Modules" className="relative overflow-x-clip py-10">
      <div className="-rotate-2 bg-ink py-4 text-paper">
        <VelocityMarquee baseVelocity={-2.5}>
          {WORDS.map((w) => (
            <span key={w} className="flex items-center gap-8 pr-8 font-display text-4xl font-semibold tracking-tight md:text-6xl">
              {w}
              <Asterisk className="size-7 text-lime md:size-9" />
            </span>
          ))}
        </VelocityMarquee>
      </div>
      <div className="mt-12 rotate-1 border-y border-ink/10 bg-lime py-2.5">
        <VelocityMarquee baseVelocity={2}>
          {["one login", "one database", "one bill", "zero copy-paste", "built for growing teams"].map((w) => (
            <span key={w} className="flex items-center gap-6 pr-6 font-mono text-sm tracking-widest uppercase">
              {w} <span className="text-signal">●</span>
            </span>
          ))}
        </VelocityMarquee>
      </div>
    </section>
  );
}
