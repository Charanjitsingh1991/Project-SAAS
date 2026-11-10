import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity } from "@/lib/activity";
import { todayYmd } from "@/lib/format";
import { recordPayment } from "@/lib/posting";
import { appPaymentMethod, parsePaymentLinkPaid, verifyWebhookSignature } from "@/lib/razorpay";
import { getRazorpayConfig } from "@/lib/razorpay-api";

/**
 * Per-workspace Razorpay webhook: /api/razorpay/webhook/<org slug>. The signature is checked against that
 * workspace's own webhook secret, so a payload can only ever affect the workspace whose secret signed it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ account: string }> }) {
  const { account } = await ctx.params;
  const rawBody = await req.text();

  const [org] = await db.select({ id: schema.organizations.id, currency: schema.organizations.currency }).from(schema.organizations).where(eq(schema.organizations.slug, account)).limit(1);
  const cfg = org ? await getRazorpayConfig(org.id) : null;
  if (!org || !cfg || !verifyWebhookSignature(rawBody, req.headers.get("x-razorpay-signature"), cfg.webhookSecret)) {
    return new Response("Invalid signature", { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("ok");
  }
  const paid = parsePaymentLinkPaid(body);
  if (!paid) return new Response("ok");

  const [link] = await db
    .select()
    .from(schema.invoicePaymentLinks)
    .where(and(eq(schema.invoicePaymentLinks.orgId, org.id), eq(schema.invoicePaymentLinks.provider, "razorpay"), eq(schema.invoicePaymentLinks.externalId, paid.linkId)))
    .limit(1);
  if (!link || link.paymentRef) return new Response("ok");

  const actx = { orgId: org.id, userId: null };
  if (paid.currency !== org.currency) {
    await logActivity(actx, { module: "finance", entityType: "invoice", entityId: link.invoiceId, action: "payment_link_error", summary: `Razorpay payment ${paid.paymentId} is in ${paid.currency}; record it manually.` });
    return new Response("ok");
  }

  // Claim the link first so concurrent deliveries of the same event record the payment once.
  const claimed = await db
    .update(schema.invoicePaymentLinks)
    .set({ paymentRef: paid.paymentId, status: "paid" })
    .where(and(eq(schema.invoicePaymentLinks.id, link.id), eq(schema.invoicePaymentLinks.orgId, org.id), isNull(schema.invoicePaymentLinks.paymentRef)))
    .returning({ id: schema.invoicePaymentLinks.id });
  if (!claimed.length) return new Response("ok");

  let err: string | null;
  try {
    err = await recordPayment(actx, link.invoiceId, { date: todayYmd(), amount: paid.amount, method: appPaymentMethod(paid.method), reference: paid.paymentId });
  } catch (e) {
    await db.update(schema.invoicePaymentLinks).set({ paymentRef: null, status: link.status }).where(eq(schema.invoicePaymentLinks.id, link.id));
    throw e;
  }
  if (err) {
    await logActivity(actx, { module: "finance", entityType: "invoice", entityId: link.invoiceId, action: "payment_link_error", summary: `Razorpay payment ${paid.paymentId} not recorded: ${err}` });
  } else {
    await logActivity(actx, { module: "finance", entityType: "invoice", entityId: link.invoiceId, action: "payment_link_paid", summary: `Paid online via Razorpay (${paid.paymentId})` });
  }
  return new Response("ok");
}
