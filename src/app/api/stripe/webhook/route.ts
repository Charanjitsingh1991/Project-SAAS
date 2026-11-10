import type Stripe from "stripe";
import { stripe, syncCustomerCard, syncSubscription } from "@/lib/stripe";

/**
 * Stripe webhook. Point your Stripe dashboard (or `stripe listen --forward-to`) at /api/stripe/webhook
 * and subscribe to: checkout.session.completed, customer.subscription.created|updated|deleted,
 * invoice.paid, invoice.payment_failed, customer.updated.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return new Response("Stripe is not configured", { status: 503 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && typeof session.subscription === "string") {
          const sub = await stripe.subscriptions.retrieve(session.subscription, { expand: ["default_payment_method"] });
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object);
        break;
      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subId = invoice.parent?.subscription_details?.subscription;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(typeof subId === "string" ? subId : subId.id, {
            expand: ["default_payment_method"],
          });
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.updated":
        await syncCustomerCard(event.data.object);
        break;
    }
  } catch (e) {
    console.error(`Stripe webhook ${event.type} failed`, e);
    return new Response("Webhook handler failed", { status: 500 });
  }

  return Response.json({ received: true });
}
