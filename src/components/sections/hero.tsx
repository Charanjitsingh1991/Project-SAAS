"use client";

import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { useRef } from "react";
import { MODULES } from "@/lib/modules";
import { MagneticButton } from "../ui/magnetic-button";
import { SpinBadge } from "../ui/spin-badge";
import { cn } from "@/lib/utils";

const ease = [0.16, 1, 0.3, 1] as const;

// Hand-placed positions (% of desk) so the scatter feels arranged, not random.
const STICKERS = [
  { key: "hrm", x: 4, y: 8, r: -6, depth: 18 },
  { key: "crm", x: 52, y: 2, r: 5, depth: 30 },
  { key: "finance", x: 30, y: 36, r: -2, depth: 12 },
  { key: "inventory", x: 66, y: 44, r: 8, depth: 24 },
  { key: "payroll", x: 2, y: 62, r: 4, depth: 34 },
  { key: "projects", x: 40, y: 72, r: -7, depth: 16 },
];

function HeadlineLine({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <span className="block overflow-hidden pb-[0.06em]">
      <motion.span
        className="block"
        initial={{ y: "105%", rotate: 3 }}
        animate={{ y: "0%", rotate: 0 }}
        transition={{ duration: 1.1, delay, ease }}
        style={{ transformOrigin: "0% 100%" }}
      >
        {children}
      </motion.span>
    </span>
  );
}

export function Hero() {
  const desk = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 80, damping: 20 });
  const sy = useSpring(my, { stiffness: 80, damping: 20 });

  function onMove(e: React.MouseEvent) {
    const r = desk.current!.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  }

  return (
    <section className="relative overflow-hidden pt-32 pb-20 md:pt-40">
      <div className="rule-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />

      <div className="relative mx-auto max-w-6xl px-5">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease }}
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-ink/15 bg-card/70 py-1 pr-3 pl-1 text-sm"
        >
          <span className="rounded-full bg-signal px-2 py-0.5 font-mono text-[11px] text-white uppercase">v2.0</span>
          <span className="text-ink-soft">Now live for India &amp; UAE — GST, VAT, WPS payroll</span>
        </motion.div>

        <h1 className="text-[clamp(3rem,9.6vw,8.6rem)] leading-[0.92] font-bold tracking-[-0.045em]">
          <HeadlineLine delay={0.1}>Run the whole</HeadlineLine>
          <HeadlineLine delay={0.2}>
            <span className="font-serif font-normal tracking-[-0.02em] italic">company</span> from
          </HeadlineLine>
          <HeadlineLine delay={0.3}>
            one{" "}
            <span className="relative inline-block">
              tab.
              <svg viewBox="0 0 300 40" className="absolute -bottom-[0.12em] left-0 w-full overflow-visible" preserveAspectRatio="none" aria-hidden>
                <motion.path
                  d="M4 26 C 60 8, 120 34, 180 18 S 270 10, 296 22"
                  fill="none"
                  stroke="var(--color-signal)"
                  strokeWidth="7"
                  strokeLinecap="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.1, delay: 1, ease: "easeInOut" }}
                />
              </svg>
            </span>
            <motion.span
              aria-hidden
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 8 }}
              transition={{ delay: 1.4, type: "spring", stiffness: 260, damping: 14 }}
              className="ml-[0.3em] hidden rounded-full bg-lime px-[0.9em] py-[0.35em] align-middle font-mono text-[0.11em] font-medium tracking-normal md:inline-block"
            >
              ✳ no more tab-hopping
            </motion.span>
          </HeadlineLine>
        </h1>

        <div className="mt-12 grid items-start gap-12 md:grid-cols-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.6, ease }}
            className="md:col-span-5"
          >
            <p className="max-w-md text-lg leading-relaxed text-ink-soft">
              HR, CRM, accounting, inventory, payroll and projects — built as{" "}
              <em className="font-serif text-xl text-ink">one</em> system, not eight apps taped together. One login, one
              database, one bill.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <MagneticButton href="/signup">Start 14-day trial</MagneticButton>
              <MagneticButton href="/#contact" variant="outline">
                Talk to sales
              </MagneticButton>
            </div>
            <div className="mt-10 flex items-center gap-4">
              <div className="flex -space-x-2">
                {["bg-mint", "bg-butter", "bg-sky", "bg-peach"].map((c, i) => (
                  <span key={c} className={cn("grid size-9 place-items-center rounded-full border-2 border-paper font-mono text-xs", c)}>
                    {["RM", "SO", "DK", "AV"][i]}
                  </span>
                ))}
              </div>
              <p className="text-sm text-ink-soft">
                <b className="text-ink">2,500+ teams</b> switched
                <br />
                from 6+ tools on average
              </p>
            </div>
          </motion.div>

          <div
            ref={desk}
            onMouseMove={onMove}
            onMouseLeave={() => {
              mx.set(0);
              my.set(0);
            }}
            className="dotted relative h-[440px] rounded-[28px] border border-line bg-paper-2/60 md:col-span-7 md:h-[480px]"
          >
            <span className="absolute top-4 left-5 font-mono text-[11px] tracking-widest text-ink-mute uppercase">
              ↳ drag the modules around
            </span>
            {STICKERS.map((s, i) => {
              const m = MODULES.find((x) => x.key === s.key)!;
              return <Sticker key={s.key} index={i} m={m} s={s} sx={sx} sy={sy} constraints={desk} />;
            })}
            <SpinBadge className="absolute -right-4 -bottom-6 size-28 text-ink md:-right-8 md:size-32" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Sticker({
  m,
  s,
  index,
  sx,
  sy,
  constraints,
}: {
  m: (typeof MODULES)[number];
  s: (typeof STICKERS)[number];
  index: number;
  sx: MotionValue<number>;
  sy: MotionValue<number>;
  constraints: React.RefObject<HTMLDivElement | null>;
}) {
  const px = useTransform(sx, (v) => v * s.depth);
  const py = useTransform(sy, (v) => v * s.depth);
  const Icon = m.icon;

  return (
    <motion.div style={{ left: `${s.x}%`, top: `${s.y}%`, x: px, y: py }} className="absolute">
      <motion.div
        drag
        dragConstraints={constraints}
        dragElastic={0.15}
        dragTransition={{ bounceStiffness: 300, bounceDamping: 18 }}
        initial={{ opacity: 0, scale: 0.6, rotate: s.r * 3 }}
        animate={{ opacity: 1, scale: 1, rotate: s.r }}
        transition={{ delay: 0.7 + index * 0.08, type: "spring", stiffness: 180, damping: 16 }}
        whileHover={{ scale: 1.05, rotate: 0 }}
        whileDrag={{ scale: 1.1, rotate: 0, zIndex: 20, boxShadow: "0 30px 50px -20px rgba(20,20,18,.45)" }}
        className={cn(
          "w-[150px] cursor-grab touch-none rounded-2xl border border-ink/10 p-3.5 shadow-[0_10px_24px_-14px_rgba(20,20,18,.35)] select-none active:cursor-grabbing md:w-[178px]",
          m.color,
        )}
      >
        <div className="flex items-center justify-between">
          <span className="grid size-8 place-items-center rounded-lg bg-ink text-paper">
            <Icon className="size-4" />
          </span>
          <span className="font-mono text-[10px] text-ink/60">0{index + 1}</span>
        </div>
        <p className="mt-4 font-display text-lg leading-none font-semibold">{m.short}</p>
        <p className="mt-1 text-xs text-ink/65">{m.metric.label}</p>
        <p className="font-display text-xl font-bold">{m.metric.value}</p>
      </motion.div>
    </motion.div>
  );
}
