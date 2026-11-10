"use client";

import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useRef } from "react";
import { LogoMark } from "../logo";
import { SectionLabel } from "../ui/reveal";
import { cn } from "@/lib/utils";

// The tools a typical growing company juggles. Offsets are in px from center.
const CHAOS = [
  { label: "payroll_FINAL_v7.xlsx", x: -430, y: -170, r: -14, c: "bg-mint" },
  { label: "HR portal (expired login)", x: 300, y: -210, r: 9, c: "bg-card" },
  { label: "CRM #2", x: -250, y: 160, r: 11, c: "bg-butter" },
  { label: "Tally export", x: 420, y: 120, r: -8, c: "bg-sky" },
  { label: "Stock sheet — Godown B", x: -470, y: 20, r: 5, c: "bg-peach" },
  { label: "project-tracker", x: 160, y: 230, r: -5, c: "bg-lilac" },
  { label: "support@ inbox (2,341)", x: 40, y: -250, r: 4, c: "bg-rose" },
  { label: "WhatsApp approvals", x: 470, y: -40, r: 13, c: "bg-card" },
  { label: "leave_requests.docx", x: -120, y: -150, r: -9, c: "bg-card" },
];

export function Converge() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });

  const coreScale = useTransform(scrollYProgress, [0.45, 0.75], [0.4, 1]);
  const coreOpacity = useTransform(scrollYProgress, [0.45, 0.65], [0, 1]);
  const before = useTransform(scrollYProgress, [0, 0.4, 0.5], [1, 1, 0]);
  const after = useTransform(scrollYProgress, [0.6, 0.75], [0, 1]);

  return (
    <section ref={ref} className="relative h-[260vh]">
      <div className="sticky top-0 flex h-dvh flex-col overflow-hidden">
        <div className="mx-auto w-full max-w-6xl px-5 pt-28">
          <SectionLabel index="01">The problem</SectionLabel>
          <div className="relative mt-6 h-[1.1em] text-[clamp(2rem,5vw,4rem)] leading-none font-semibold tracking-tight">
            <motion.h2 style={{ opacity: before }} className="absolute inset-0">
              Nine tools. <span className="font-serif font-normal italic">Zero</span> of them agree.
            </motion.h2>
            <motion.h2 style={{ opacity: after }} className="absolute inset-0">
              One platform. <span className="font-serif font-normal text-signal italic">Every</span> number matches.
            </motion.h2>
          </div>
        </div>

        <div className="relative flex-1">
          <div className="absolute top-1/2 left-1/2 scale-[0.6] md:scale-100">
            {CHAOS.map((c, i) => (
              <Chip key={c.label} c={c} i={i} progress={scrollYProgress} />
            ))}
            <motion.div
              style={{ scale: coreScale, opacity: coreOpacity }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
            >
              <div className="flex w-[340px] flex-col items-center gap-4 rounded-[28px] bg-ink p-7 text-paper shadow-[0_40px_80px_-30px_rgba(20,20,18,.6)]">
                <div className="flex items-center gap-2">
                  <LogoMark className="size-9 text-paper [&_.fill-paper]:fill-ink" />
                  <span className="font-display text-3xl font-bold">
                    saas<span className="text-signal">.</span>tech
                  </span>
                </div>
                <div className="grid w-full grid-cols-4 gap-1.5">
                  {["bg-mint", "bg-butter", "bg-sky", "bg-peach", "bg-lime", "bg-lilac", "bg-rose", "bg-card"].map((b) => (
                    <span key={b} className={cn("h-7 rounded-md", b)} />
                  ))}
                </div>
                <p className="font-mono text-[11px] tracking-widest text-paper/60 uppercase">one record · every module</p>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Chip({ c, i, progress }: { c: (typeof CHAOS)[number]; i: number; progress: MotionValue<number> }) {
  const start = 0.12 + i * 0.025;
  const end = 0.55 + i * 0.012;
  const x = useTransform(progress, [start, end], [c.x, 0]);
  const y = useTransform(progress, [start, end], [c.y, 0]);
  const rotate = useTransform(progress, [start, end], [c.r, 0]);
  const scale = useTransform(progress, [start, end], [1, 0.3]);
  const opacity = useTransform(progress, [end - 0.06, end], [1, 0]);

  return (
    <motion.div
      style={{ x, y, rotate, scale, opacity }}
      className={cn(
        "absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ink/15 px-4 py-2.5 font-mono text-sm whitespace-nowrap shadow-[0_8px_20px_-12px_rgba(20,20,18,.4)]",
        c.c,
      )}
    >
      {c.label}
    </motion.div>
  );
}
