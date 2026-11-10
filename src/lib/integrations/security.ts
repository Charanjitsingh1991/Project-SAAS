import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export type EndpointKind = "webhook" | "slack" | "teams" | "google_chat";

/** HMAC-SHA256 over "<timestamp>.<body>", prefixed like GitHub/Stripe style headers. */
export function signPayload(secret: string, timestamp: string | number, body: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifySignature(secret: string, timestamp: string | number, body: string, signature: string) {
  const a = Buffer.from(signPayload(secret, timestamp, body));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public IP literals (v4 and v6). */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || /^fe[89ab]/.test(x) || x.startsWith("ff") || x.startsWith("::ffff:");
  }
  return false;
}

const CHAT_HOSTS: Record<Exclude<EndpointKind, "webhook">, (host: string) => boolean> = {
  slack: (h) => h === "hooks.slack.com",
  google_chat: (h) => h === "chat.googleapis.com",
  // Teams "Workflows" (Power Automate) URLs live on logic.azure.com / powerplatform.com; legacy connectors on webhook.office.com.
  teams: (h) => /(^|\.)logic\.azure\.com$/.test(h) || /(^|\.)powerplatform\.com$/.test(h) || /(^|\.)webhook\.office(365)?\.com$/.test(h),
};

export const CHAT_HOST_HINT: Record<Exclude<EndpointKind, "webhook">, string> = {
  slack: "hooks.slack.com",
  google_chat: "chat.googleapis.com",
  teams: "*.logic.azure.com or *.powerplatform.com",
};

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** Static (no DNS) validation of a destination URL. `production` defaults to NODE_ENV === "production". */
export function validateEndpointUrl(kind: EndpointKind, raw: string, production = process.env.NODE_ENV === "production"): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Enter a valid URL." };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (url.username || url.password) return { ok: false, error: "Remove the username/password from the URL." };

  if (kind !== "webhook") {
    if (url.protocol !== "https:") return { ok: false, error: "Chat webhooks must use https." };
    if (!CHAT_HOSTS[kind](host)) return { ok: false, error: `That doesn't look like a ${kind === "slack" ? "Slack" : kind === "teams" ? "Teams" : "Google Chat"} webhook URL (expected ${CHAT_HOST_HINT[kind]}).` };
    return { ok: true, url };
  }

  if (!production && isLocal && (url.protocol === "http:" || url.protocol === "https:")) return { ok: true, url };
  if (url.protocol !== "https:") return { ok: false, error: "Webhook URLs must use https." };
  if (isLocal || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localdomain")) {
    return { ok: false, error: "Private or internal hosts aren't allowed." };
  }
  if (isIP(host) && isPrivateIp(host)) return { ok: false, error: "Private or internal IP addresses aren't allowed." };
  if (!host.includes(".") && !isIP(host)) return { ok: false, error: "Enter a public hostname." };
  return { ok: true, url };
}

/** "https://hooks.slack.com/…xyz" — enough to recognise the URL without exposing the bearer token. */
export function urlHint(raw: string) {
  try {
    const u = new URL(raw);
    const tail = (u.pathname + u.search).slice(-4);
    return `${u.protocol}//${u.host}/…${tail}`;
  } catch {
    return "…";
  }
}
