import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptSecret } from "@/lib/crypto";
import type { RazorpayConfig } from "@/lib/razorpay";

const BASE = "https://api.razorpay.com/v1";

export type RazorpayResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(cfg: Pick<RazorpayConfig, "keyId" | "keySecret">, method: "GET" | "POST", path: string, body?: unknown): Promise<RazorpayResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
    if (!res.ok) return { ok: false, error: json.error?.description ?? (res.status === 401 ? "Razorpay rejected these keys." : `Razorpay error (${res.status}).`) };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "Couldn't reach Razorpay. Try again." };
  }
}

/** Cheap authenticated read used to validate a key pair before saving it. */
export const verifyKeys = (cfg: Pick<RazorpayConfig, "keyId" | "keySecret">) => call<unknown>(cfg, "GET", "/payment_links?count=1");

export type RazorpayPaymentLink = { id: string; short_url: string; status: string; amount: number };

export const createPaymentLink = (
  cfg: Pick<RazorpayConfig, "keyId" | "keySecret">,
  body: {
    amount: number;
    currency: string;
    reference_id: string;
    description: string;
    customer?: { name?: string; email?: string; contact?: string };
    expire_by?: number;
  },
) => call<RazorpayPaymentLink>(cfg, "POST", "/payment_links", { ...body, accept_partial: false, notify: { sms: false, email: false }, reminder_enable: false });

export const cancelPaymentLink = (cfg: Pick<RazorpayConfig, "keyId" | "keySecret">, id: string) =>
  call<RazorpayPaymentLink>(cfg, "POST", `/payment_links/${encodeURIComponent(id)}/cancel`);

/** The workspace's active Razorpay credentials, or null when not connected / unreadable. */
export async function getRazorpayConfig(orgId: number): Promise<RazorpayConfig | null> {
  const [row] = await db
    .select({ configEnc: schema.orgIntegrations.configEnc })
    .from(schema.orgIntegrations)
    .where(and(eq(schema.orgIntegrations.orgId, orgId), eq(schema.orgIntegrations.provider, "razorpay"), eq(schema.orgIntegrations.active, true)))
    .limit(1);
  const json = decryptSecret(row?.configEnc);
  if (!json) return null;
  try {
    const c = JSON.parse(json) as Partial<RazorpayConfig>;
    return c.keyId && c.keySecret && c.webhookSecret ? { keyId: c.keyId, keySecret: c.keySecret, webhookSecret: c.webhookSecret } : null;
  } catch {
    return null;
  }
}
