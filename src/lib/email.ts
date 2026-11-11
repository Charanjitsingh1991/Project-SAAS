import "server-only";

/*
 * Transactional email via the Resend HTTP API (no SDK dependency).
 * Without RESEND_API_KEY, emails are logged and `sent: false` is returned so callers can fall back
 * to showing a copyable link. Sending never throws: a mail outage must not break the action.
 */

export type EmailMessage = {
  to: string | string[];
  subject: string;
  /** Plain-text paragraphs; rendered into a simple branded HTML layout. */
  paragraphs: string[];
  /** Optional call-to-action button. */
  action?: { label: string; url: string };
  replyTo?: string;
};

export type EmailResult = { sent: boolean; error?: string };

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderEmail(msg: Pick<EmailMessage, "subject" | "paragraphs" | "action">) {
  const paras = msg.paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const button = msg.action
    ? `<p style="margin:22px 0"><a href="${esc(msg.action.url)}" style="background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;display:inline-block;font-weight:600">${esc(msg.action.label)}</a></p><p style="margin:0 0 14px;font-size:12px;color:#666;word-break:break-all">Or open: ${esc(msg.action.url)}</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111"><div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="font-weight:700;font-size:18px;margin-bottom:20px">saasmodels.tech</div><div style="background:#fff;border-radius:16px;padding:28px">${paras}${button}</div><p style="font-size:12px;color:#888;margin-top:18px">You received this because of activity in your saasmodels.tech workspace.</p></div></body></html>`;
  const text = [...msg.paragraphs, msg.action ? `${msg.action.label}: ${msg.action.url}` : ""].filter(Boolean).join("\n\n");
  return { html, text };
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).map((t) => t.trim()).filter(Boolean);
  if (!to.length) return { sent: false, error: "No recipient." };
  const { html, text } = renderEmail(msg);
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[email:not-configured] to=${to.join(",")} subject="${msg.subject}"\n${text}`);
    return { sent: false, error: "Email is not configured (RESEND_API_KEY)." };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "saasmodels.tech <no-reply@saasmodels.tech>",
        to,
        subject: msg.subject,
        html,
        text,
        ...(msg.replyTo || process.env.EMAIL_REPLY_TO ? { reply_to: msg.replyTo || process.env.EMAIL_REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`sendEmail failed ${res.status}: ${body.slice(0, 300)}`);
      return { sent: false, error: `Email provider returned ${res.status}.` };
    }
    return { sent: true };
  } catch (e) {
    console.error("sendEmail failed", e);
    return { sent: false, error: "Email provider unreachable." };
  }
}
