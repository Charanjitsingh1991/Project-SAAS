import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, syncSubscription } from "@/lib/stripe";
import { getWorkspace } from "@/lib/tenancy";

/**
 * Stripe Checkout success_url. Syncs the new subscription immediately so the
 * workspace unlocks even before the webhook arrives (or if it isn't set up yet).
 */
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/app/billing?${q}`, req.nextUrl));
  const sessionId = req.nextUrl.searchParams.get("session_id");
  const ws = await getWorkspace();
  if (!ws?.org) return NextResponse.redirect(new URL("/login", req.nextUrl));
  if (!stripe || !sessionId) return back("error=not_configured");

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "subscription.default_payment_method"],
    });
    if (session.client_reference_id !== String(ws.org.id)) return back("error=mismatch");
    if (session.subscription && typeof session.subscription !== "string") {
      await syncSubscription(session.subscription as Stripe.Subscription);
    }
    return back("checkout=success");
  } catch (e) {
    console.error("checkout-return failed", e);
    return back("checkout=pending");
  }
}
