import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Check, CreditCard, Lock } from "lucide-react";
import { SubmitButton } from "@/components/app/forms";
import { Badge, Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { PLAN_MODULES, canManage } from "@/lib/roles";
import { PLAN_PRICES, stripeConfigured, type Interval, type Plan } from "@/lib/stripe";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { openBillingPortal, startCheckout } from "./actions";

export const metadata: Metadata = { title: "Billing" };

const NOTICES: Record<string, { tone: "ok" | "warn"; text: string }> = {
  "checkout=success": { tone: "ok", text: "Payment method added — thank you! Your subscription is active." },
  "checkout=pending": { tone: "warn", text: "Payment received. Your subscription will show here within a minute." },
  "checkout=cancelled": { tone: "warn", text: "Checkout was cancelled. No charge was made." },
  "error=not_configured": { tone: "warn", text: "Payments aren't connected yet. Add your Stripe keys and price IDs (see README)." },
  "error=already_subscribed": { tone: "warn", text: "You already have a subscription — use “Manage billing” to change plan or card." },
  "error=no_customer": { tone: "warn", text: "Add a payment method first by choosing a plan below." },
  "error=stripe": { tone: "warn", text: "Stripe returned an error. Check your STRIPE_SECRET_KEY and price IDs, then try again." },
  "error=mismatch": { tone: "warn", text: "That checkout session belongs to a different workspace." },
};

const PLAN_COPY: Record<Plan, { name: string; blurb: string; features: string[] }> = {
  starter: { name: "Starter", blurb: "For small teams getting out of spreadsheets.", features: ["People & HRM", "Sales CRM", "Projects", "Up to 25 users"] },
  growth: { name: "Growth", blurb: "Every module, unlimited users.", features: ["All 8 modules", "Payroll & Finance", "Inventory & Helpdesk", "Analytics"] },
};

export default async function BillingPage(props: PageProps<"/app/billing">) {
  const ws = await requireWorkspace({ allowLocked: true });
  const sp = await props.searchParams;
  const noticeKey = Object.entries(sp).map(([k, v]) => `${k}=${v}`).find((k) => NOTICES[k]);
  const notice = noticeKey ? NOTICES[noticeKey] : null;
  const { org, access } = ws;
  const manager = canManage(ws.role);
  const configured = stripeConfigured();
  const seats = await db.$count(schema.memberships, eq(schema.memberships.orgId, org.id));
  const subscribed = Boolean(org.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(org.subscriptionStatus ?? ""));

  return (
    <>
      {access.state === "locked" && (
        <div className="mb-8 overflow-hidden rounded-[24px] bg-ink p-8 text-paper md:p-10">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-signal">
              <Lock className="size-5" />
            </span>
            <p className="font-mono text-xs tracking-widest text-paper/60 uppercase">Workspace deactivated</p>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight md:text-5xl">
            {access.reason === "trial_ended" ? "Your 14-day free trial has ended." : "Your subscription has ended."}
          </h1>
          <p className="mt-3 max-w-2xl text-paper/70">
            {manager
              ? "All modules are paused. Your data is safe — add a payment method below and everything switches back on instantly."
              : `All modules are paused. Ask the owner of ${org.name} to add a payment method — your data is safe and nothing is deleted.`}
          </p>
        </div>
      )}

      <PageHeader title="Billing" description={manager ? "Your plan, trial and payment method." : "Billing is managed by your workspace owner."} />

      {notice && (
        <p className={cn("mb-6 rounded-xl px-4 py-3 text-sm", notice.tone === "ok" ? "bg-mint" : "bg-butter")} role="status">
          {notice.text}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Status">
          {access.state === "trial" && (
            <div>
              <div className="flex items-baseline justify-between">
                <p className="font-display text-2xl font-semibold">Free trial · day {access.day} of 14</p>
                <Badge tone={access.lastDay ? "rose" : "lime"}>{access.daysLeft} day{access.daysLeft === 1 ? "" : "s"} left</Badge>
              </div>
              <div className="mt-4 flex gap-1">
                {Array.from({ length: 14 }, (_, i) => (
                  <span key={i} className={cn("h-2 flex-1 rounded-full", i < access.day ? (access.lastDay ? "bg-signal" : "bg-ink") : "bg-paper-2")} />
                ))}
              </div>
              <p className="mt-4 text-sm text-ink-soft">
                No card needed during the trial. If no payment method is added, the workspace is deactivated at{" "}
                <b className="text-ink">12:00 AM on {formatDate(access.endsAt)}</b>. Add a card any time — you won&apos;t be charged until the trial ends.
              </p>
            </div>
          )}
          {access.state === "paid" && (
            <div className="space-y-1">
              <p className="font-display text-2xl font-semibold">
                {PLAN_COPY[org.plan].name} plan <Badge tone="mint">{org.subscriptionStatus === "trialing" ? "active · trial" : "active"}</Badge>
              </p>
              <p className="text-sm text-ink-soft">
                {seats} seat{seats === 1 ? "" : "s"} · billed {org.billingInterval === "year" ? "yearly" : "monthly"}
                {org.currentPeriodEnd && (
                  <>
                    {" "}
                    · {org.cancelAtPeriodEnd ? "ends" : org.subscriptionStatus === "trialing" ? "first charge" : "renews"} {formatDate(org.currentPeriodEnd)}
                  </>
                )}
              </p>
            </div>
          )}
          {access.state === "past_due" && (
            <p className="text-sm">
              <b>Payment failed.</b> Stripe will retry automatically; update your card to avoid deactivation.
            </p>
          )}
          {access.state === "locked" && <p className="text-sm">Deactivated since {formatDate(access.endedAt)}.</p>}
        </Card>

        <Card
          title="Payment method"
          actions={
            manager && org.stripeCustomerId && configured ? (
              <form action={openBillingPortal}>
                <SubmitButton variant="outline" className="h-8 px-3 text-xs">
                  Manage billing
                </SubmitButton>
              </form>
            ) : null
          }
        >
          {org.cardLast4 ? (
            <div className="flex items-center gap-4">
              <span className="grid h-12 w-[74px] place-items-center rounded-xl bg-ink text-paper">
                <CreditCard className="size-5" />
              </span>
              <div>
                <p className="font-medium capitalize">
                  {org.cardBrand} •••• {org.cardLast4}
                </p>
                <p className="text-sm text-ink-mute">
                  Expires {String(org.cardExpMonth).padStart(2, "0")}/{org.cardExpYear}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">No payment method on file yet. Pick a plan below to add one through Stripe&apos;s secure checkout.</p>
          )}
          {manager && org.stripeCustomerId && (
            <p className="mt-4 text-xs text-ink-mute">Change card, switch plans, download invoices or cancel from &ldquo;Manage billing&rdquo;.</p>
          )}
        </Card>
      </div>

      {manager && !subscribed && (
        <>
          <h2 className="mt-10 mb-4 font-display text-xl font-semibold">Choose a plan</h2>
          {!configured && (
            <p className="mb-4 rounded-xl bg-butter px-4 py-3 text-sm">
              <b>Stripe isn&apos;t connected yet.</b> Set <code className="font-mono">STRIPE_SECRET_KEY</code> and the four <code className="font-mono">STRIPE_PRICE_*</code> IDs to enable checkout.
            </p>
          )}
          <div className="grid gap-5 md:grid-cols-2">
            {(["starter", "growth"] as Plan[]).map((plan) => (
              <div key={plan} className={cn("rounded-[22px] border p-6", plan === "growth" ? "border-ink bg-ink text-paper" : "border-line bg-card")}>
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-semibold">{PLAN_COPY[plan].name}</h3>
                  {plan === "growth" && <Badge tone="lime">Most teams pick this</Badge>}
                </div>
                <p className={cn("mt-1 text-sm", plan === "growth" ? "text-paper/65" : "text-ink-soft")}>{PLAN_COPY[plan].blurb}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {PLAN_COPY[plan].features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="size-4" /> {f}
                    </li>
                  ))}
                </ul>
                <p className={cn("mt-4 text-xs", plan === "growth" ? "text-paper/55" : "text-ink-mute")}>
                  Includes: {PLAN_MODULES[plan].join(", ")} · {seats} seat{seats === 1 ? "" : "s"} today
                </p>
                <div className="mt-6 grid grid-cols-2 gap-2">
                  {(["month", "year"] as Interval[]).map((interval) => (
                    <form key={interval} action={startCheckout}>
                      <input type="hidden" name="plan" value={plan} />
                      <input type="hidden" name="interval" value={interval} />
                      <button
                        disabled={!configured}
                        className={cn(
                          "w-full rounded-2xl border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                          plan === "growth" ? "border-paper/25 hover:bg-paper/10" : "border-line hover:border-ink",
                        )}
                      >
                        <span className="block font-mono text-[10px] tracking-widest uppercase opacity-60">{interval === "month" ? "Monthly" : "Yearly · save 20%"}</span>
                        <span className="font-display text-2xl font-bold">${PLAN_PRICES[plan][interval]}</span>
                        <span className="text-xs opacity-70"> /user/mo</span>
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-ink-mute">Payments are processed by Stripe. Card details never touch our servers.</p>
        </>
      )}
    </>
  );
}
