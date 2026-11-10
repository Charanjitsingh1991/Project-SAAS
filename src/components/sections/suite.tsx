"use client";

import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { MODULES } from "@/lib/modules";
import { SectionLabel } from "../ui/reveal";
import { cn } from "@/lib/utils";

/** Vertical scroll drives a horizontal track of module cards (pinned section). */
export function Suite() {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      if (track.current) setDistance(Math.max(0, track.current.scrollWidth - window.innerWidth));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0, 1], [0, -distance]);
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });

  return (
    <section id="suite" ref={section} style={{ height: `calc(100dvh + ${distance}px)` }} className="relative">
      <div className="sticky top-0 flex h-dvh flex-col justify-center overflow-hidden">
        <div className="mx-auto mb-10 w-full max-w-6xl px-5">
          <SectionLabel index="02">The suite</SectionLabel>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
            <h2 className="max-w-2xl text-[clamp(2rem,5vw,4rem)] leading-[0.95] font-semibold tracking-tight">
              Eight modules. <span className="font-serif font-normal italic">One</span> brain.
            </h2>
            <p className="max-w-xs text-ink-soft">Switch on what you need today. Everything you add later already knows your data.</p>
          </div>
        </div>

        <motion.div ref={track} style={{ x }} className="flex gap-5 pr-[8vw] pl-[max(20px,calc((100vw-72rem)/2+20px))]">
          {MODULES.map((m, i) => (
            <ModuleCard key={m.key} m={m} i={i} />
          ))}
          <div className="flex w-[300px] shrink-0 flex-col justify-end rounded-[28px] border border-dashed border-ink/30 p-7">
            <p className="font-serif text-4xl italic">+ more</p>
            <p className="mt-2 text-ink-soft">Fleet, Assets, LMS and Field Service are on the 2027 roadmap.</p>
          </div>
        </motion.div>

        <div className="mx-auto mt-10 flex w-full max-w-6xl items-center gap-4 px-5 font-mono text-xs text-ink-mute">
          <span>01</span>
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
            <motion.div style={{ scaleX: progress }} className="h-full origin-left bg-ink" />
          </div>
          <span>08</span>
        </div>
      </div>
    </section>
  );
}

function ModuleCard({ m, i }: { m: (typeof MODULES)[number]; i: number }) {
  const Icon = m.icon;
  return (
    <motion.article
      whileHover={{ y: -8, rotate: i % 2 ? 0.8 : -0.8 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
      className={cn(
        "relative flex h-[min(62vh,520px)] w-[min(82vw,400px)] shrink-0 flex-col rounded-[28px] border border-ink/10 p-7",
        m.color,
      )}
    >
      <div className="flex items-start justify-between">
        <span className="grid size-12 place-items-center rounded-2xl bg-ink text-paper">
          <Icon className="size-5" />
        </span>
        <span className="font-display text-6xl leading-none font-bold text-ink/10">0{i + 1}</span>
      </div>
      <h3 className="mt-8 text-3xl leading-none font-semibold tracking-tight">{m.name}</h3>
      <p className="mt-1 font-serif text-xl text-ink/70 italic">{m.tagline}</p>
      <p className="mt-4 text-[15px] leading-relaxed text-ink/75">{m.description}</p>
      <ul className="mt-auto space-y-2 pt-6">
        {m.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm">
            <span className="grid size-5 place-items-center rounded-full bg-ink text-paper">
              <Check className="size-3" />
            </span>
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex items-baseline justify-between border-t border-ink/15 pt-4">
        <span className="font-mono text-[11px] tracking-widest text-ink/60 uppercase">{m.metric.label}</span>
        <span className="font-display text-2xl font-bold">{m.metric.value}</span>
      </div>
    </motion.article>
  );
}
