import type { Metadata } from "next";
import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/dal";
import { MODULES } from "@/lib/modules";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <form action={logout}>
          <button className="rounded-full border border-ink/20 px-4 py-2 text-sm font-medium hover:border-ink">Log out</button>
        </form>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-20">
        <Suspense fallback={<div className="mt-10 h-40 animate-pulse rounded-[28px] bg-paper-2" />}>
          <DashboardContent />
        </Suspense>
      </main>
    </div>
  );
}

async function DashboardContent() {
  const user = await requireUser();
  const myEnquiries = await db
    .select()
    .from(schema.enquiries)
    .where(eq(schema.enquiries.email, user.email))
    .orderBy(desc(schema.enquiries.createdAt))
    .limit(10);

  return (
    <>
      <section className="mt-8 rounded-[28px] bg-ink p-8 text-paper md:p-12">
        <p className="font-mono text-xs tracking-widest text-paper/50 uppercase">Workspace · {user.company || "Personal"}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-6xl">
          Hey {user.name.split(" ")[0]}, <span className="font-serif font-normal text-lime italic">welcome in.</span>
        </h1>
        <p className="mt-3 max-w-lg text-paper/70">
          Your 14-day trial is active. Pick a module to set up first — you can switch on the rest any time.
        </p>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {MODULES.map((m) => (
          <div key={m.key} className={`${m.color} rounded-[22px] border border-ink/10 p-5`}>
            <span className="grid size-10 place-items-center rounded-xl bg-ink text-paper">
              <m.icon className="size-4" />
            </span>
            <p className="mt-4 font-display text-lg font-semibold">{m.name}</p>
            <p className="text-sm text-ink/65">{m.tagline}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-6 md:grid-cols-3">
        <div className="rounded-[22px] border border-line bg-card p-6">
          <h2 className="text-lg font-semibold">Account</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-ink-mute">Name</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt className="text-ink-mute">Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt className="text-ink-mute">Member since</dt>
              <dd>{user.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-[22px] border border-line bg-card p-6 md:col-span-2">
          <h2 className="text-lg font-semibold">Your enquiries</h2>
          {myEnquiries.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft">No enquiries sent from {user.email} yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {myEnquiries.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{e.interest || "General enquiry"}</p>
                    <p className="line-clamp-1 text-ink-soft">{e.message}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-butter px-2.5 py-0.5 font-mono text-xs">{e.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
