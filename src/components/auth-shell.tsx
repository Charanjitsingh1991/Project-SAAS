import { Logo } from "./logo";
import { SpinBadge } from "./ui/spin-badge";

/** Split-screen shell shared by /login and /signup. */
export function AuthShell({ title, subtitle, children }: { title: React.ReactNode; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 md:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
          <h1 className="text-5xl leading-[0.95] font-semibold tracking-tight">{title}</h1>
          <p className="mt-3 mb-10 text-ink-soft">{subtitle}</p>
          {children}
        </div>
        <p className="font-mono text-xs text-ink-mute">© saas.tech · Protected by encrypted sessions</p>
      </div>

      <div className="relative m-3 hidden overflow-hidden rounded-[32px] bg-ink p-12 text-paper lg:flex lg:flex-col">
        <div className="rule-grid absolute inset-0 opacity-[0.08]" />
        <div className="relative grid grid-cols-4 gap-2">
          {["bg-mint", "bg-butter", "bg-sky", "bg-peach", "bg-lime", "bg-lilac", "bg-rose", "bg-signal"].map((c, i) => (
            <span key={c} className={`${c} h-16 rounded-2xl`} style={{ transform: `rotate(${((i % 3) - 1) * 2}deg)` }} />
          ))}
        </div>
        <blockquote className="relative mt-auto max-w-md font-display text-3xl leading-tight">
          &ldquo;We closed seven subscriptions and our month-end went from twelve days to{" "}
          <span className="font-serif text-lime italic">three.</span>&rdquo;
        </blockquote>
        <p className="relative mt-4 text-paper/60">Rahul Mehta — CFO, Brightline Retail</p>
        <SpinBadge className="absolute top-1/2 right-10 size-36 -translate-y-1/2 text-paper/80" text="ONE LOGIN · EVERY MODULE · " />
      </div>
    </div>
  );
}
