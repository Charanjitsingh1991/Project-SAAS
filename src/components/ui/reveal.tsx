"use client";

import { motion, type Variants } from "motion/react";
import { cn } from "@/lib/utils";

const ease = [0.16, 1, 0.3, 1] as const;

/** Fades + lifts children into view once. */
export function Reveal({
  children,
  delay = 0,
  className,
  y = 28,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, delay, ease }}
    >
      {children}
    </motion.div>
  );
}

const word: Variants = {
  hidden: { y: "110%", rotate: 4 },
  show: (i: number) => ({ y: "0%", rotate: 0, transition: { duration: 0.9, delay: i * 0.06, ease } }),
};

/** Splits a string into masked words that slide up in sequence. */
export function WordReveal({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  return (
    <motion.span
      className={cn("inline", className)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
    >
      {text.split(" ").map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span className="inline-block origin-bottom-left" variants={word} custom={i + delay * 10}>
            {w}&nbsp;
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}

export function SectionLabel({ index, children, className }: { index: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 font-mono text-xs tracking-[0.14em] text-ink-soft uppercase", className)}>
      <span className="rounded-full border border-ink/20 px-2 py-0.5 text-ink">{index}</span>
      <span>{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
