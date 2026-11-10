"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { Logo } from "../logo";

const COLS = [
  { h: "Products", l: [["HRM", "/#suite"], ["CRM", "/#suite"], ["Finance", "/#suite"], ["Inventory", "/#suite"], ["Payroll", "/#suite"]] },
  { h: "Company", l: [["About", "/#"], ["Careers", "/#"], ["Contact", "/#contact"], ["Partners", "/#"]] },
  { h: "Resources", l: [["Docs", "/#"], ["API", "/#"], ["Security", "/#"], ["Status", "/#"]] },
];

export function Footer() {
  const word = "saas.tech".split("");
  return (
    <footer className="overflow-hidden pt-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 md:grid-cols-12">
        <div className="md:col-span-5">
          <Logo />
          <p className="mt-4 max-w-xs text-ink-soft">The operating system for organizations that are done juggling tools.</p>
          <p className="mt-6 font-mono text-xs text-ink-mute">hello@saas.tech</p>
        </div>
        {COLS.map((c) => (
          <div key={c.h} className="md:col-span-2">
            <h4 className="font-mono text-xs tracking-widest text-ink-mute uppercase">{c.h}</h4>
            <ul className="mt-4 space-y-2">
              {c.l.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="group relative inline-block text-[15px]">
                    {label}
                    <span className="absolute -bottom-0.5 left-0 h-px w-full origin-right scale-x-0 bg-ink transition-transform duration-500 ease-out-expo group-hover:origin-left group-hover:scale-x-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-16 flex max-w-6xl flex-wrap justify-between gap-2 border-t border-line px-5 py-6 text-sm text-ink-mute">
        <span>© 2026 saas.tech</span>
        <span className="flex gap-4">
          <Link href="/#">Privacy</Link>
          <Link href="/#">Terms</Link>
        </span>
      </div>

      <motion.div
        aria-hidden
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.1 }}
        className="flex justify-center overflow-hidden px-2 leading-[0.78] select-none"
      >
        {word.map((ch, i) => (
          <motion.span
            key={i}
            variants={{
              hidden: { y: "100%" },
              show: { y: "12%", transition: { duration: 1, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] } },
            }}
            whileHover={{ y: "0%", transition: { duration: 0.3 } }}
            className={`inline-block font-display text-[clamp(4rem,19vw,17rem)] font-bold tracking-[-0.06em] ${ch === "." ? "text-signal" : "text-ink"}`}
          >
            {ch}
          </motion.span>
        ))}
      </motion.div>
    </footer>
  );
}
