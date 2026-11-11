import "server-only";
import { eq, or } from "drizzle-orm";
import Stripe from "stripe";
import { db, schema } from "@/db";

export const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export type Plan = "starter" | "growth";
export type Interval = "month" | "year";

const PRICE_ENV: Record<Plan, Record<Interval, string>> = {
  starter: { month: "STRIPE_PRICE_STARTER_MONTHLY", year: "STRIPE_PRICE_STARTER_YEARLY" },
  growth: { month: "STRIPE_PRICE_GROWTH_MONTHLY", year: "STRIPE_PRICE_GROWTH_YEARLY" },
};

/** Display prices (USD per user per month) — keep in sync with your Stripe prices. */
export const PLAN_PRICES: Record<Plan, Record<Interval, number>> = {
  starter: { month: 9, year: 7 },
  growth: { month: 24, year: 19 },
};

const PLAN_NAMES: Record<Plan, string> = { starter: "Starter", growth: "Growth" };

/** An explicit STRIPE_PRICE_* override, if one is set. */
export function priceId(plan: Plan, interval: Interval) {
  return process.env[PRICE_ENV[plan][interval]] || null;
}

export function priceLookupKey(plan: Plan, interval: Interval) {
  return `saasmodels_${plan}_${interval}`;
}

/** Stripe bills the yearly price once a year, so it is the per-month display price × 12. */
export function priceAmountCents(plan: Plan, interval: Interval) {
  return PLAN_PRICES[plan][interval] * 100 * (interval === "year" ? 12 : 1);
}

export function stripeConfigured() {
  return Boolean(stripe);
}

const resolved = new Map<string, string>();

/**
 * Price for a plan: the STRIPE_PRICE_* override if set, otherwise the price carrying our lookup key,
 * created (with its product) on first use so no price IDs need to be copied into the environment.
 */
export async function resolvePriceId(plan: Plan, interval: Interval): Promise<string | null> {
  const override = priceId(plan, interval);
  if (override) return override;
  if (!stripe) return null;
  const lookupKey = priceLookupKey(plan, interval);
  const cached = resolved.get(lookupKey);
  if (cached) return cached;

  const find = async () => (await stripe!.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0]?.id;
  let id = await find();
  if (!id) {
    const productId = `saasmodels_${plan}`;
    try {
      await stripe.products.retrieve(productId);
    } catch {
      await stripe.products
        .create({ id: productId, name: `saasmodels.tech ${PLAN_NAMES[plan]}`, metadata: { plan } })
        .catch(() => undefined); // created concurrently
    }
    try {
      id = (
        await stripe.prices.create({
          product: productId,
          currency: "usd",
          unit_amount: priceAmountCents(plan, interval),
          recurring: { interval, usage_type: "licensed" },
          lookup_key: lookupKey,
          nickname: `${PLAN_NAMES[plan]} · ${interval === "year" ? "yearly" : "monthly"} · per user`,
          metadata: { plan, interval },
        })
      ).id;
    } catch (e) {
      // Lookup keys are unique: another request may have created it first.
      id = await find();
      if (!id) throw e;
    }
  }
  resolved.set(lookupKey, id);
  return id;
}

function planForPrice(price: Pick<Stripe.Price, "id" | "lookup_key"> | undefined): { plan: Plan; interval: Interval } | null {
  if (!price) return null;
  for (const plan of ["starter", "growth"] as Plan[]) {
    for (const interval of ["month", "year"] as Interval[]) {
      if (priceId(plan, interval) === price.id || price.lookup_key === priceLookupKey(plan, interval)) return { plan, interval };
    }
  }
  return null;
}

async function cardFrom(pm: string | Stripe.PaymentMethod | null | undefined) {
  if (!pm) return null;
  try {
    const obj = typeof pm === "string" ? await stripe!.paymentMethods.retrieve(pm) : pm;
    if (!obj.card) return null;
    return { brand: obj.card.brand, last4: obj.card.last4, expMonth: obj.card.exp_month, expYear: obj.card.exp_year };
  } catch {
    return null;
  }
}

/** Mirror a Stripe subscription onto its organization. Safe to call repeatedly. */
export async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const metaOrg = Number(sub.metadata?.orgId);

  const [org] = await db
    .select()
    .from(schema.organizations)
    .where(
      metaOrg
        ? eq(schema.organizations.id, metaOrg)
        : or(eq(schema.organizations.stripeSubscriptionId, sub.id), eq(schema.organizations.stripeCustomerId, customerId)),
    )
    .limit(1);
  if (!org) return null;

  const item = sub.items?.data?.[0];
  const mapped = planForPrice(item?.price);
  const card = await cardFrom(sub.default_payment_method as string | Stripe.PaymentMethod | null);

  await db
    .update(schema.organizations)
    .set({
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : org.currentPeriodEnd,
      ...(mapped ? { plan: mapped.plan, billingInterval: mapped.interval } : {}),
      ...(card ? { cardBrand: card.brand, cardLast4: card.last4, cardExpMonth: card.expMonth, cardExpYear: card.expYear } : {}),
    })
    .where(eq(schema.organizations.id, org.id));
  return org.id;
}

/** Store the customer's default card (e.g. after updating it in the billing portal). */
export async function syncCustomerCard(customer: Stripe.Customer) {
  const card = await cardFrom(customer.invoice_settings?.default_payment_method as string | Stripe.PaymentMethod | null);
  if (!card) return;
  await db
    .update(schema.organizations)
    .set({ cardBrand: card.brand, cardLast4: card.last4, cardExpMonth: card.expMonth, cardExpYear: card.expYear })
    .where(eq(schema.organizations.stripeCustomerId, customer.id));
}

/** Keep the per-seat quantity equal to the number of members. */
export async function syncSeats(orgId: number) {
  if (!stripe) return;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  if (!org?.stripeSubscriptionId) return;
  try {
    const seats = await db.$count(schema.memberships, eq(schema.memberships.orgId, orgId));
    const sub = await stripe.subscriptions.retrieve(org.stripeSubscriptionId);
    const item = sub.items.data[0];
    if (item && item.quantity !== seats) {
      await stripe.subscriptionItems.update(item.id, { quantity: Math.max(1, seats), proration_behavior: "create_prorations" });
    }
  } catch (e) {
    console.error("syncSeats failed", e);
  }
}
