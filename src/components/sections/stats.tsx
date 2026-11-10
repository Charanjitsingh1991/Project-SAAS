"use client";

import { animate, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

const STATS = [
  { value: 2500, suffix: "+", label: "companies run on saas.tech", note: "across 31 countries" },
  { value: 68, suffix: "%", label: "lower software spend", note: "vs. their old stack" },
  { value: 9, suffix: " hrs", label: "saved per manager, weekly", note: "median, 2026 survey" },
  { value: 99.98, suffix: "%", label: "uptime last 12 months", note: "status.saas.tech", decimals: 2 },
];

function Counter({ value, decimals = 0, suffix }: { value: number; decimals?: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const c = animate(0, value, { duration: 2, ease: [0.16, 1, 0.3, 1], onUpdate: setN });
    return () => c.stop();
  }, [inView, value]);

  return (
    <span ref={ref}>
      {n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      <span className="text-signal">{suffix}</span>
    </span>
  );
}

export function Stats() {
  return (
    <section className="border-y border-line bg-card">
      <div className="mx-auto grid max-w-6xl grid-cols-2 md:grid-cols-4">
        {STATS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="border-line px-5 py-12 not-first:border-l max-md:nth-3:border-l-0 max-md:nth-[n+3]:border-t md:px-8"
          >
            <p className="font-display text-[clamp(2.4rem,5vw,4rem)] leading-none font-bold tracking-tight">
              <Counter value={s.value} decimals={s.decimals} suffix={s.suffix} />
            </p>
            <p className="mt-3 text-[15px] font-medium">{s.label}</p>
            <p className="font-mono text-xs text-ink-mute">{s.note}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
