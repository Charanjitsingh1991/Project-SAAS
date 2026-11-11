"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { resolvePriceId, stripe } from "@/lib/stripe";
import { requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";

export async function startCheckout(fd: FormData) {
  const ws = await requireWorkspace({ manage: true, allowLocked: true });
  const plan = z.enum(["starter", "growth"]).parse(fd.get("plan"));
  const interval = z.enum(["month", "year"]).parse(fd.get("interval"));
  if (!stripe) redirect("/app/billing?error=not_configured");

  const origin = await appOrigin();
  const org = ws.org;

  // Already subscribed: plan changes and card updates happen in the Stripe portal.
  if (org.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(org.subscriptionStatus ?? "")) {
    redirect("/app/billing?error=already_subscribed");
  }

  const seats = await db.$count(schema.memberships, eq(schema.memberships.orgId, org.id));

  // Paying early keeps the remaining free days: Stripe starts billing when the trial ends.
  // Stripe requires trial_end to be at least 48h away, so only pass it in that case.
  const trialEnd = Math.floor(org.trialEndsAt.getTime() / 1000);
  const keepTrial = ws.access.state === "trial" && trialEnd - Date.now() / 1000 > 49 * 3600;

  let url: string;
  try {
    const price = await resolvePriceId(plan, interval);
    if (!price) throw new Error("No Stripe price for this plan");
    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: ws.user.email,
        name: org.name,
        metadata: { orgId: String(org.id) },
      });
      customerId = customer.id;
      await db.update(schema.organizations).set({ stripeCustomerId: customerId }).where(eq(schema.organizations.id, org.id));
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: String(org.id),
      line_items: [{ price, quantity: Math.max(1, seats) }],
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { orgId: String(org.id) },
        ...(keepTrial ? { trial_end: trialEnd } : {}),
      },
      success_url: `${origin}/api/stripe/checkout-return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app/billing?checkout=cancelled`,
    });
    url = session.url!;
  } catch (e) {
    console.error("Stripe checkout failed", e);
    redirect("/app/billing?error=stripe");
  }
  redirect(url);
}

export async function openBillingPortal() {
  const ws = await requireWorkspace({ manage: true, allowLocked: true });
  if (!stripe || !ws.org.stripeCustomerId) redirect("/app/billing?error=no_customer");
  let url: string;
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: ws.org.stripeCustomerId,
      return_url: `${await appOrigin()}/app/billing`,
    });
    url = portal.url;
  } catch (e) {
    console.error("Stripe portal failed", e);
    redirect("/app/billing?error=stripe");
  }
  redirect(url);
}
