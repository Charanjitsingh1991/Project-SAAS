import { createHmac, timingSafeEqual } from "node:crypto";

/* Pure Razorpay helpers (no I/O) so they can be unit-tested. API calls live in razorpay-api.ts. */

export type RazorpayConfig = { keyId: string; keySecret: string; webhookSecret: string };

export function razorpayMode(keyId: string): "test" | "live" | null {
  if (keyId.startsWith("rzp_test_")) return "test";
  if (keyId.startsWith("rzp_live_")) return "live";
  return null;
}

/** Razorpay signs the raw body with HMAC-SHA256(webhook secret), hex encoded. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signature.trim(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Razorpay amounts are in the smallest unit (paise); the app stores INR in paise too, so this is 1:1. */
export const minorToPaise = (minor: number) => Math.round(minor);
export const paiseToMinor = (paise: number) => Math.round(paise);

export type PaymentLinkPaid = {
  linkId: string;
  paymentId: string;
  /** Amount of this payment in minor units. */
  amount: number;
  currency: string;
  method: string | null;
};

/** Extracts a fully-paid payment_link.paid event; returns null for anything else or malformed payloads. */
export function parsePaymentLinkPaid(body: unknown): PaymentLinkPaid | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { event?: unknown; payload?: { payment_link?: { entity?: Record<string, unknown> }; payment?: { entity?: Record<string, unknown> } } };
  if (b.event !== "payment_link.paid") return null;
  const link = b.payload?.payment_link?.entity;
  const pay = b.payload?.payment?.entity;
  if (!link || !pay) return null;
  const linkId = link.id;
  const paymentId = pay.id;
  const amount = pay.amount;
  if (typeof linkId !== "string" || typeof paymentId !== "string" || typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return null;
  return {
    linkId,
    paymentId,
    amount: paiseToMinor(amount),
    currency: typeof pay.currency === "string" ? pay.currency : "INR",
    method: typeof pay.method === "string" ? pay.method : null,
  };
}

/** Maps a Razorpay payment method onto the app's PAYMENT_METHODS. */
export function appPaymentMethod(method: string | null): "upi" | "card" | "bank_transfer" {
  if (method === "upi") return "upi";
  if (method === "card") return "card";
  return "bank_transfer";
}

/** Razorpay reference_id: unique per link, max 40 chars, alphanumeric plus - _ . */
export function paymentLinkReference(invoiceNumber: string, suffix: string) {
  const tail = `-${suffix}`.replace(/[^A-Za-z0-9_.-]/g, "");
  const head = invoiceNumber.replace(/[^A-Za-z0-9_.-]/g, "");
  return head.slice(0, 40 - tail.length) + tail;
}

/** wa.me expects the number as digits only (country code, no "+"). Returns null when it doesn't look like a phone number. */
export function whatsappNumber(phone: string | null | undefined, defaultCountryCode?: string) {
  if (!phone) return null;
  let digits = phone.replace(/[^\d]/g, "");
  if (phone.trim().startsWith("00")) digits = digits.slice(2);
  else if (!phone.trim().startsWith("+") && defaultCountryCode) {
    digits = digits.replace(/^0+/, "");
    if (digits.length <= 10) digits = defaultCountryCode + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function paymentLinkMessage(p: { customerName: string; invoiceNumber: string; amountText: string; orgName: string; url: string }) {
  return `Hi ${p.customerName}, your invoice ${p.invoiceNumber} from ${p.orgName} has ${p.amountText} due. You can pay online here: ${p.url}`;
}

export function whatsappUrl(message: string, phone?: string | null) {
  return `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(message)}`;
}
