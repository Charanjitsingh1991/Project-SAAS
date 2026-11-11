"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Lock, Plug, Smartphone, Workflow } from "lucide-react";
import { Reveal, SectionLabel, WordReveal } from "../ui/reveal";
import { Asterisk } from "../ui/spin-badge";

const PROMPTS = [
  {
    q: "Which customers have overdue invoices and an open deal?",
    rows: [
      ["Initech Pvt Ltd", "₹4,80,000", "Proposal"],
      ["Globex Retail", "₹1,12,500", "Negotiation"],
      ["Umbrella Labs", "₹62,000", "Qualified"],
    ],
    head: ["Customer", "Overdue", "Deal stage"],
  },
  {
    q: "Who's on leave next week in the Bengaluru warehouse?",
    rows: [
      ["Ravi K.", "Mon – Wed", "Picker"],
      ["Sneha P.", "Thu", "Supervisor"],
      ["Arjun M.", "Fri", "Driver"],
    ],
    head: ["Employee", "Dates", "Role"],
  },
  {
    q: "What's below 2 weeks of stock?",
    rows: [
      ["USB-C docks", "9 days left", "Reorder 200"],
      ["Thermal rolls", "6 days left", "Reorder 1,500"],
      ["Packing tape", "12 days left", "Reorder 600"],
    ],
    head: ["Item", "Cover", "Suggested"],
  },
];

function Copilot() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-120px" });
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!inView) return;
    const full = PROMPTS[idx].q;
    let i = 0;
    const t = setInterval(() => {
      i++;
      setTyped(full.slice(0, i));
      if (i >= full.length) {
        clearInterval(t);
        setTimeout(() => setDone(true), 350);
      }
    }, 32);
    return () => clearInterval(t);
  }, [idx, inView]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      setTyped("");
      setDone(false);
      setIdx((n) => (n + 1) % PROMPTS.length);
    }, 3800);
    return () => clearTimeout(t);
  }, [done]);

  const p = PROMPTS[idx];

  return (
    <div ref={ref} className="relative flex h-full flex-col rounded-[28px] bg-ink p-6 text-paper md:p-8">
      <div className="flex items-center gap-2 font-mono text-xs tracking-widest text-paper/50 uppercase">
        <Asterisk className="size-4 animate-[spin_6s_linear_infinite] text-lime" /> Copilot
      </div>
      <div className="mt-5 min-h-[64px] rounded-2xl bg-paper/8 px-5 py-4 font-display text-xl leading-snug md:text-2xl">
        {typed}
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ repeat: Infinity, duration: 0.8 }}
          className="ml-0.5 inline-block h-[1em] w-[3px] translate-y-[3px] bg-lime"
        />
      </div>
      <div className="mt-5 flex-1">
        <AnimatePresence mode="wait">
          {done && (
            <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -8 }}>
              <div className="grid grid-cols-3 gap-2 border-b border-paper/15 pb-2 font-mono text-[11px] tracking-wider text-paper/50 uppercase">
                {p.head.map((h) => (
                  <span key={h}>{h}</span>
                ))}
              </div>
              {p.rows.map((r, i) => (
                <motion.div
                  key={r[0]}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.12, ease: [0.16, 1, 0.3, 1], duration: 0.6 }}
                  className="grid grid-cols-3 gap-2 border-b border-paper/10 py-3 text-sm"
                >
                  <span>{r[0]}</span>
                  <span className="text-paper/70">{r[1]}</span>
                  <span>
                    <span className="rounded-full bg-lime px-2 py-0.5 text-xs text-ink">{r[2]}</span>
                  </span>
                </motion.div>
              ))}
              <p className="mt-4 font-mono text-[11px] text-paper/40">↳ answered from your Finance, CRM, HRM and Inventory data</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-4 flex gap-1.5">
        {PROMPTS.map((_, i) => (
          <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-paper/15">
            {i === idx && (
              <motion.span
                key={`${idx}-${done}`}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: done ? 1 : 0.5 }}
                transition={{ duration: done ? 3.8 : 2, ease: "linear" }}
                className="block h-full origin-left bg-lime"
              />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: Workflow, title: "Built-in automations", body: "Won deal → invoice and project. Approved leave → attendance → payroll. PO received → stock and bill. Switch each one on or off.", c: "bg-butter" },
  { icon: Lock, title: "Secure by design", body: "Role-based access, an audit log on Enterprise, and every record scoped to your workspace.", c: "bg-sky" },
  { icon: Plug, title: "Connects to your tools", body: "Slack, Teams, Google Chat, Google and Outlook calendars, Razorpay, Zapier, Make, n8n and a REST API.", c: "bg-peach" },
  { icon: Smartphone, title: "Works on your phone", body: "Check in, apply for leave, approve your team and look up stock from any phone browser.", c: "bg-mint" },
];

const SSO_NAMES: Record<string, string> = { google: "Google", microsoft: "Microsoft" };

/** Only advertise single sign-on for providers whose keys are actually set. */
function featuresFor(ssoProviders: string[]) {
  const names = ssoProviders.map((p) => SSO_NAMES[p]).filter(Boolean);
  if (!names.length) return FEATURES;
  const sso = `${names.join(" and ")} sign-in`;
  return FEATURES.map((f) =>
    f.title === "Secure by design"
      ? { ...f, body: `Role-based access, ${sso}, an audit log on Enterprise, and every record scoped to your workspace.` }
      : f,
  );
}

export function Platform({ ssoProviders = [] }: { ssoProviders?: string[] }) {
  const features = featuresFor(ssoProviders);
  return (
    <section id="copilot" className="mx-auto max-w-6xl px-5 py-28">
      <SectionLabel index="03">The platform</SectionLabel>
      <h2 className="mt-6 max-w-3xl text-[clamp(2rem,5vw,4rem)] leading-[0.95] font-semibold tracking-tight">
        <WordReveal text="Ask your business a question." />
        <span className="font-serif font-normal italic">
          <WordReveal text="Get an answer." delay={0.5} />
        </span>
      </h2>

      <div className="mt-14 grid gap-5 md:grid-cols-12">
        <Reveal className="md:col-span-7 md:row-span-2">
          <Copilot />
        </Reveal>
        {features.slice(0, 2).map((f, i) => (
          <Reveal key={f.title} delay={i * 0.08} className="md:col-span-5">
            <motion.div
              whileHover="hover"
              className={`group relative h-full overflow-hidden rounded-[28px] border border-ink/10 p-6 ${f.c}`}
            >
              <motion.span
                variants={{ hover: { rotate: -12, scale: 1.08 } }}
                className="grid size-11 place-items-center rounded-xl bg-ink text-paper"
              >
                <f.icon className="size-5" />
              </motion.span>
              <h3 className="mt-5 text-xl font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-[15px] text-ink/70">{f.body}</p>
            </motion.div>
          </Reveal>
        ))}
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {features.slice(2).map((f, i) => (
          <Reveal key={f.title} delay={i * 0.08}>
            <motion.div whileHover="hover" className={`flex h-full items-start gap-5 rounded-[28px] border border-ink/10 p-6 ${f.c}`}>
              <motion.span
                variants={{ hover: { rotate: -12, scale: 1.08 } }}
                className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink text-paper"
              >
                <f.icon className="size-5" />
              </motion.span>
              <div>
                <h3 className="text-xl font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-[15px] text-ink/70">{f.body}</p>
              </div>
            </motion.div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
