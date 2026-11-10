"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";

/** Circular rotating text badge; spins with time and speeds up with scroll. */
export function SpinBadge({
  text = "ALL-IN-ONE · HRM · CRM · ERP · PAYROLL · ",
  className,
  center,
}: {
  text?: string;
  className?: string;
  center?: React.ReactNode;
}) {
  const { scrollY } = useScroll();
  const scrollRotate = useTransform(scrollY, (v) => v * 0.15);
  const id = `circle-${text.length}`;

  return (
    <div className={cn("relative size-32", className)}>
      <motion.div style={{ rotate: scrollRotate }} className="absolute inset-0">
        <svg viewBox="0 0 120 120" className="size-full animate-[spin_18s_linear_infinite]">
          <defs>
            <path id={id} d="M60,60 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0" />
          </defs>
          <text className="fill-current font-mono text-[10.5px] tracking-[0.18em]">
            <textPath href={`#${id}`}>{text}</textPath>
          </text>
        </svg>
      </motion.div>
      <div className="absolute inset-0 grid place-items-center">{center ?? <Asterisk className="size-10 text-signal" />}</div>
    </div>
  );
}

export function Asterisk({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      {[0, 45, 90, 135].map((a) => (
        <rect key={a} x="17" y="2" width="6" height="36" rx="3" fill="currentColor" transform={`rotate(${a} 20 20)`} />
      ))}
    </svg>
  );
}
