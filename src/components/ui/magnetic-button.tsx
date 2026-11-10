"use client";

import { motion, useMotionValue, useSpring } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: "ink" | "outline" | "signal";
  className?: string;
};

/** Button that drifts toward the cursor and rolls its arrow on hover. */
export function MagneticButton({ href, children, variant = "ink", className }: Props) {
  const ref = useRef<HTMLAnchorElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 15, mass: 0.4 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 15, mass: 0.4 });

  function onMove(e: React.MouseEvent) {
    const r = ref.current!.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * 0.25);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.35);
  }

  const styles = {
    ink: "bg-ink text-paper",
    signal: "bg-signal text-white",
    outline: "border border-ink/20 bg-card/60 text-ink hover:border-ink",
  }[variant];
  const dot = {
    ink: "bg-lime text-ink",
    signal: "bg-ink text-paper",
    outline: "bg-ink text-paper",
  }[variant];

  return (
    <motion.div style={{ x, y }} className="inline-block">
      <Link
        ref={ref}
        href={href}
        onMouseMove={onMove}
        onMouseLeave={() => {
          x.set(0);
          y.set(0);
        }}
        className={cn(
          "group relative inline-flex h-13 items-center gap-3 rounded-full pr-1.5 pl-6 text-[15px] font-medium transition-colors",
          styles,
          className,
        )}
      >
        {children}
        <span className={cn("relative grid size-10 place-items-center overflow-hidden rounded-full", dot)}>
          <ArrowUpRight className="size-4 transition-transform duration-500 ease-out-expo group-hover:translate-x-6 group-hover:-translate-y-6" />
          <ArrowUpRight className="absolute size-4 -translate-x-6 translate-y-6 transition-transform duration-500 ease-out-expo group-hover:translate-x-0 group-hover:translate-y-0" />
        </span>
      </Link>
    </motion.div>
  );
}
