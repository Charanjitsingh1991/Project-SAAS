"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#suite", label: "Products" },
  { href: "/#copilot", label: "Platform" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#contact", label: "Contact" },
];

export function Nav() {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useMotionValueEvent(scrollY, "change", (v) => {
    const prev = scrollY.getPrevious() ?? 0;
    setHidden(v > prev && v > 240 && !open);
    setScrolled(v > 20);
  });

  return (
    <motion.header
      animate={{ y: hidden ? "-110%" : "0%" }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-x-0 top-0 z-50 px-3 pt-3"
    >
      <div
        className={cn(
          "mx-auto flex h-14 max-w-6xl items-center gap-6 rounded-full border pr-2 pl-5 transition-all duration-500",
          scrolled || open ? "border-line bg-card/85 shadow-[0_8px_30px_-12px_rgba(20,20,18,.18)] backdrop-blur-md" : "border-transparent",
        )}
      >
        <Logo />
        <nav className="ml-4 hidden gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="relative rounded-full px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-paper-2 hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link href="/login" className="rounded-full px-4 py-2 text-sm font-medium hover:bg-paper-2">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition-transform hover:-translate-y-0.5"
          >
            Start free
          </Link>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="relative ml-auto grid size-10 place-items-center rounded-full bg-ink text-paper md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          <motion.span animate={open ? { rotate: 45, y: 0 } : { rotate: 0, y: -3 }} className="absolute h-0.5 w-4 bg-current" />
          <motion.span animate={open ? { rotate: -45, y: 0 } : { rotate: 0, y: 3 }} className="absolute h-0.5 w-4 bg-current" />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mt-2 max-w-6xl rounded-3xl border border-line bg-card p-3 shadow-xl md:hidden"
          >
            {LINKS.map((l, i) => (
              <motion.div key={l.href} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-2xl px-4 py-3 font-display text-2xl hover:bg-paper-2"
                >
                  {l.label}
                  <span className="font-mono text-xs text-ink-mute">0{i + 1}</span>
                </Link>
              </motion.div>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link href="/login" className="rounded-full border border-line py-3 text-center font-medium">
                Log in
              </Link>
              <Link href="/signup" className="rounded-full bg-ink py-3 text-center font-medium text-paper">
                Start free
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
