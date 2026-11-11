import { retryDueDeliveries } from "@/lib/integrations/deliver";
import { pruneThrottle } from "@/lib/throttle";
import { pruneUnverified } from "@/lib/verification";

/**
 * Retries webhook/chat deliveries whose backoff has elapsed (1m, 5m, 30m, 2h, 12h).
 * Authorised like the recurring-invoices cron: `Authorization: Bearer <CRON_SECRET>`; closed without CRON_SECRET.
 * Needs a schedule of at least every few minutes (Vercel Cron on Pro, or any external scheduler).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const attempted = await retryDueDeliveries();
  // Daily housekeeping rides on this job: old throttle rows, stale codes, abandoned unverified sign-ups.
  await pruneThrottle();
  const prunedSignups = await pruneUnverified();
  return Response.json({ ok: true, attempted, prunedSignups });
}
