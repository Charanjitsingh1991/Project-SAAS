import "server-only";

/**
 * Transactional email via Resend's HTTP API (no SDK). Configure RESEND_API_KEY and EMAIL_FROM
 * (a sender on a domain verified in Resend, e.g. "saasmodels.tech <no-reply@saasmodels.tech>").
 * Without a key, emails are logged and skipped so local/dev flows keep working.
 */

export type EmailMessage = { to: string | string[]; subject: string; text: string; html?: string; replyTo?: string };

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Minimal branded HTML: paragraphs from blank-line-separated text plus an optional button. */
export function emailHtml(opts: { heading: string; text: string; button?: { label: string; href: string } }) {
  const paras = opts.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const btn = opts.button
    ? `<p style="margin:22px 0"><a href="${esc(opts.button.href)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">${esc(opts.button.label)}</a></p><p style="font-size:12px;color:#777;word-break:break-all">${esc(opts.button.href)}</p>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111"><p style="font-weight:700;font-size:18px;margin:0 0 20px">saasmodels<span style="color:#ff4f1f">.</span>tech</p><h1 style="font-size:20px;margin:0 0 16px">${esc(opts.heading)}</h1>${paras}${btn}<p style="font-size:12px;color:#999;margin-top:28px">You received this because of your account on saasmodels.tech.</p></div>`;
}

/** Send an email. Never throws: returns false when not configured or the provider rejects it. */
export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  if (!emailConfigured()) {
    console.info(`[email skipped: RESEND_API_KEY/EMAIL_FROM not set] to=${String(msg.to)} subject="${msg.subject}"`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: Array.isArray(msg.to) ? msg.to : [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        reply_to: msg.replyTo,
      }),
    });
    if (!res.ok) console.error(`[email failed] ${res.status} ${await res.text().catch(() => "")}`);
    return res.ok;
  } catch (e) {
    console.error("[email failed]", e);
    return false;
  }
}
