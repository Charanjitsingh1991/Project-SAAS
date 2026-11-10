/** Pure web-to-lead helpers (no I/O) — validation, rate-limit constants and embed snippet. */
import { z } from "zod";
import { normalizePhone } from "./countries";

/** Same email can't resubmit within this window. */
export const DUPLICATE_WINDOW_MS = 60_000;
/** Per-workspace cap on submissions per window (basic flood protection). */
export const ORG_SUBMISSIONS_PER_WINDOW = 20;

/** Loose international phone check: optional +, 7–15 digits after stripping separators. */
export function isLoosePhone(phone: string) {
  return /^\+?\d{7,15}$/.test(normalizePhone(phone));
}

export const WebLeadSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,80}$/i),
  name: z.string().trim().min(2, "Please enter your name.").max(120),
  email: z.string().trim().toLowerCase().max(200).pipe(z.email("Enter a valid email.")),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine(isLoosePhone, "Enter a valid phone number.")
    .transform(normalizePhone)
    .optional(),
  company: z.string().trim().max(160).optional(),
  message: z.string().trim().max(2000).optional(),
  /** Honeypot — real users never fill it. */
  website: z.string().max(200).optional(),
});

export type WebLead = z.infer<typeof WebLeadSchema>;

export function isBot(lead: { website?: string }) {
  return !!lead.website;
}

export function leadDealTitle(lead: { name: string; company?: string }) {
  return `${lead.company || lead.name} — web enquiry`;
}

export function webFormUrl(origin: string, slug: string) {
  return `${origin.replace(/\/$/, "")}/forms/${slug}`;
}

export function webFormEmbed(url: string) {
  return `<iframe src="${url}" title="Contact form" width="100%" height="720" style="border:0;max-width:640px" loading="lazy"></iframe>`;
}
