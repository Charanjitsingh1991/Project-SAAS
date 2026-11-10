import "server-only";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PRIORITIES, TICKET_CHANNELS } from "@/db/schema";
import { logActivity, type Ctx } from "@/lib/activity";
import { createTicket, getMembers } from "@/lib/helpdesk-data";

type Priority = (typeof PRIORITIES)[number];
type Channel = (typeof TICKET_CHANNELS)[number];
type Status = "open" | "pending" | "on_hold" | "resolved" | "closed";

const H = 3_600_000;
const M = 60_000;

const CANNED = [
  { title: "Greeting & acknowledgement", body: "Hi,\n\nThanks for reaching out. I've picked this up and I'm looking into it now. I'll update you shortly.\n\nBest regards" },
  { title: "Need more information", body: "Thanks for the details so far. To investigate further, could you share a screenshot or the exact steps that led to this? It helps us reproduce the problem quickly." },
  { title: "Refund process", body: "We've initiated your refund. It usually takes 5–7 business days to reflect on your original payment method. You'll get a confirmation email once it's processed." },
  { title: "Password reset help", body: "You can reset your password from the login page using “Forgot password”. If the email doesn't arrive within a few minutes, check your spam folder and let us know." },
  { title: "Issue resolved", body: "Good news: this is now fixed on our side. Please check and let us know if anything still looks off. We'll keep the ticket open for a couple of days in case." },
  { title: "Closing the loop", body: "We haven't heard back, so we're marking this as resolved. Reply anytime to reopen it and we'll pick it right back up." },
];

const ARTICLES: { title: string; category: string; published: boolean; body: string }[] = [
  { title: "How to reset your password", category: "Account", published: true, body: "Forgot your password? No problem.\n\n1. Go to the login page and choose “Forgot password”.\n2. Enter the email you signed up with.\n3. Open the email we send and follow the link.\n\nThe link expires after 30 minutes. If you don't see the email, check your spam folder." },
  { title: "Update your profile and email address", category: "Account", published: true, body: "Open your account settings to change your name, phone number or email address.\n\nChanging your email signs you out everywhere, so you'll need to log in again with the new address." },
  { title: "Understanding your invoice", category: "Billing", published: true, body: "Each invoice lists the items you purchased, the tax applied per line and the total due.\n\nTax is calculated per line and rounded once, so totals always add up exactly. If something looks wrong, contact us with the invoice number." },
  { title: "Payment methods and refunds", category: "Billing", published: true, body: "We accept cards, UPI and bank transfer.\n\nRefunds are issued to the original payment method and take 5–7 business days. Bank transfers are refunded to the account they came from." },
  { title: "Tracking your order", category: "Orders", published: true, body: "Once your order ships you'll receive a tracking link by email.\nYou can also see the latest status from your order page.\n\nDeliveries usually take 3–5 business days." },
  { title: "Returns and exchanges", category: "Orders", published: true, body: "You can return most items within 14 days of delivery.\n\nPack the item in its original packaging and contact support to get a return label. Exchanges are shipped as soon as we receive the item." },
  { title: "Getting started: your first week", category: "Getting started", published: true, body: "Welcome aboard!\n\nDay 1: complete your profile and invite your team.\nDay 2–3: import your contacts and products.\nDay 4–7: create your first invoice and explore the dashboard.\n\nAnything unclear? Submit a request and we'll help." },
  { title: "Inviting teammates", category: "Getting started", published: true, body: "Owners and admins can invite teammates from the Team page. Pick a role, share the invite link, and they can join in a minute.\n\nInvite links expire after 7 days." },
  { title: "Upcoming: bulk import (draft)", category: "Getting started", published: false, body: "Draft: how to bulk import records from a CSV file.\n\nTo be completed before launch." },
];

type Msg = { kind: "a" | "n" | "r"; text: string; afterMin: number };
type Seed = {
  agoH: number;
  subject: string;
  desc: string;
  contact?: number;
  name?: string;
  email?: string;
  channel: Channel;
  category: string;
  priority: Priority;
  status: Status;
  assignee: number | null;
  firstReplyMin?: number;
  resolveH?: number;
  csat?: [number, string];
  thread?: Msg[];
};

const TICKETS: Seed[] = [
  { agoH: 500, subject: "Invoice shows wrong GST amount", desc: "The GST on last month's invoice looks higher than expected. Can you check?", contact: 0, channel: "email", category: "Billing", priority: "low", status: "closed", assignee: 0, firstReplyMin: 180, resolveH: 20, csat: [5, "Quick and clear explanation."], thread: [{ kind: "n", text: "Checked: tax was applied on the freight line as well. Looks correct per HSN.", afterMin: 240 }, { kind: "a", text: "The rate applies to the freight line too, which is why the total looks higher. I've attached the breakdown.", afterMin: 300 }, { kind: "r", text: "Understood, thank you!", afterMin: 600 }] },
  { agoH: 450, subject: "Can't log in after changing phone", desc: "I changed my phone and now I can't sign in to my account.", name: "Neha Kapoor", email: "neha.kapoor@example.com", channel: "portal", category: "Account", priority: "medium", status: "resolved", assignee: 1, firstReplyMin: 95, resolveH: 30, csat: [4, "Works now."], thread: [{ kind: "a", text: "Could you confirm the email on the account? I'll send a fresh sign-in link.", afterMin: 95 }, { kind: "r", text: "It's neha.kapoor@example.com", afterMin: 200 }, { kind: "a", text: "Done, link sent. It's valid for 30 minutes.", afterMin: 260 }] },
  { agoH: 400, subject: "Order stuck at 'dispatched' for 4 days", desc: "My order has shown dispatched for four days with no movement.", contact: 1, channel: "phone", category: "Orders", priority: "high", status: "closed", assignee: 0, firstReplyMin: 40, resolveH: 10, csat: [5, "Called the courier right away."], thread: [{ kind: "n", text: "Courier hub delay. Raised escalation with the carrier.", afterMin: 90 }, { kind: "a", text: "The courier confirmed a hub delay. A replacement dispatch is on its way and will arrive tomorrow.", afterMin: 300 }] },
  { agoH: 340, subject: "Refund not received", desc: "I returned my item two weeks ago and still have no refund.", name: "Rohan Mehta", email: "rohan.mehta@example.com", channel: "email", category: "Billing", priority: "medium", status: "resolved", assignee: 1, firstReplyMin: 120, resolveH: 60, csat: [2, "Took too long."], thread: [{ kind: "n", text: "Refund was stuck with the bank. Re-initiated manually.", afterMin: 600 }, { kind: "a", text: "Sorry about the delay. The refund has been re-initiated and should reflect within 5–7 days.", afterMin: 3500 }] },
  { agoH: 300, subject: "Dashboard not loading for our whole team", desc: "Since this morning the dashboard shows a blank page for everyone in our office.", contact: 2, channel: "chat", category: "Technical", priority: "urgent", status: "resolved", assignee: 0, firstReplyMin: 20, resolveH: 3, thread: [{ kind: "a", text: "We're investigating right now. Could you tell us which browser you're using?", afterMin: 20 }, { kind: "r", text: "Chrome, latest version.", afterMin: 35 }, { kind: "n", text: "Cache issue after yesterday's release. Purged the CDN.", afterMin: 120 }, { kind: "a", text: "Fixed. A CDN cache issue after our release. Please hard-refresh.", afterMin: 150 }] },
  { agoH: 260, subject: "How do I add another user?", desc: "We hired two new people. How can I give them access?", name: "Sunita Rao", email: "sunita.rao@example.com", channel: "web", category: "Getting started", priority: "low", status: "resolved", assignee: 1, firstReplyMin: 360, resolveH: 40, thread: [{ kind: "a", text: "You can invite teammates from the Team page. I've linked the article in our help center.", afterMin: 360 }] },
  { agoH: 200, subject: "Wrong item delivered", desc: "I ordered the blue variant but received the grey one.", contact: 3, channel: "email", category: "Orders", priority: "high", status: "resolved", assignee: 0, firstReplyMin: 50, resolveH: 30, thread: [{ kind: "a", text: "Apologies for the mix-up. We'll arrange a pickup and ship the correct item.", afterMin: 50 }, { kind: "n", text: "Warehouse picked the wrong SKU. Flagged to inventory team.", afterMin: 120 }, { kind: "r", text: "Pickup is tomorrow 11am, okay?", afterMin: 600 }] },
  { agoH: 150, subject: "Change billing email address", desc: "Please send invoices to accounts@ instead of my personal email.", contact: 4, channel: "whatsapp", category: "Account", priority: "medium", status: "resolved", assignee: 1, firstReplyMin: 60, resolveH: 12, thread: [{ kind: "a", text: "Updated. Future invoices go to the new address.", afterMin: 60 }] },
  { agoH: 100, subject: "Feature request: export to Excel", desc: "It would help a lot if reports could be exported as Excel files.", name: "Imran Sheikh", email: "imran.sheikh@example.com", channel: "portal", category: "General", priority: "low", status: "resolved", assignee: 0, firstReplyMin: 600, resolveH: 48, thread: [{ kind: "a", text: "Thanks for the suggestion. CSV exports are available today and open fine in Excel; I've passed your note to the product team.", afterMin: 600 }] },
  { agoH: 72, subject: "Payment failed but amount debited", desc: "My card was charged but the order shows payment failed.", contact: 5, channel: "email", category: "Billing", priority: "medium", status: "pending", assignee: 1, firstReplyMin: 120, thread: [{ kind: "a", text: "We've found the transaction. Could you share the last four digits of the card so we can match it?", afterMin: 120 }, { kind: "n", text: "Waiting for the customer. Payment gateway shows 'pending settlement'.", afterMin: 180 }] },
  { agoH: 48, subject: "Bulk order pricing query", desc: "We want to order 500 units. Do you offer bulk pricing?", name: "Kavita Joshi", email: "kavita.joshi@example.com", channel: "phone", category: "Orders", priority: "high", status: "on_hold", assignee: 0, firstReplyMin: 60, thread: [{ kind: "a", text: "Yes, we do. I'm getting a quote approved by our sales lead and will revert tomorrow.", afterMin: 60 }, { kind: "n", text: "On hold until sales approves discount tier.", afterMin: 90 }] },
  { agoH: 30, subject: "Account locked after multiple attempts", desc: "I'm locked out and have an important delivery to schedule today. Please help urgently.", name: "Arjun Nair", email: "arjun.nair@example.com", channel: "email", category: "Account", priority: "high", status: "open", assignee: null },
  { agoH: 7, subject: "Need a copy of last quarter's invoices", desc: "Could you send me PDFs of the last three invoices for my audit?", name: "Priya Desai", email: "priya.desai@example.com", channel: "portal", category: "Billing", priority: "medium", status: "open", assignee: null },
  { agoH: 3.3, subject: "Checkout page error: cannot place order", desc: "Checkout keeps failing with an error at the payment step. We're losing sales.", contact: 6, channel: "chat", category: "Technical", priority: "urgent", status: "open", assignee: 0, firstReplyMin: 20, thread: [{ kind: "a", text: "We're on it. Can you send the exact error text?", afterMin: 20 }, { kind: "n", text: "Reproduced on our side. Payment provider timeout, engineering looped in.", afterMin: 70 }, { kind: "r", text: "Error says 'gateway timeout'.", afterMin: 80 }] },
  { agoH: 20, subject: "Where can I find my GST invoice?", desc: "I need the GST invoice for my records. Where do I download it?", name: "Deepak Verma", email: "deepak.verma@example.com", channel: "web", category: "Billing", priority: "low", status: "open", assignee: 1, firstReplyMin: 300, thread: [{ kind: "a", text: "You can download it from your order page under “Invoice”. Let us know if you can't see it.", afterMin: 300 }] },
];

export async function seedHelpdesk(ctx: Ctx): Promise<void> {
  const orgId = ctx.orgId;
  const nowMs = Date.now();

  await db.insert(schema.cannedResponses).values(CANNED.map((c) => ({ ...c, orgId, createdAt: new Date(nowMs - 25 * 24 * H) })));

  for (const [i, a] of ARTICLES.entries()) {
    const at = new Date(nowMs - (30 - i * 2) * 24 * H);
    const slug = a.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    await db.insert(schema.kbArticles).values({ orgId, title: a.title, slug, category: a.category, body: a.body, published: a.published, views: a.published ? 40 + ((i * 37) % 160) : 0, createdAt: at, updatedAt: at });
  }

  const members = await getMembers(orgId);
  const agents = members.length ? members.map((m) => m.id) : ctx.userId ? [ctx.userId] : [];
  const agentAt = (i: number | null) => (i == null || !agents.length ? null : agents[i % agents.length]);

  const contactRows = await db
    .select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), isNotNull(schema.contacts.email)))
    .orderBy(asc(schema.contacts.id))
    .limit(10);

  for (const s of TICKETS) {
    const createdAt = new Date(nowMs - s.agoH * H);
    const c = s.contact != null ? contactRows[s.contact] : undefined;
    const name = c?.name ?? s.name ?? "Customer";
    const email = c?.email ?? s.email ?? "customer@example.com";
    const assigneeId = agentAt(s.assignee);

    const t = await createTicket(
      orgId,
      { subject: s.subject, description: s.desc, requesterName: name, requesterEmail: email, channel: s.channel, category: s.category, priority: s.priority, assigneeId },
      { userId: null, createdAt, actor: name },
    );

    const msgs: (typeof schema.ticketMessages.$inferInsert)[] = [];
    let lastAt = createdAt;
    const push = (m: Msg) => {
      const at = new Date(createdAt.getTime() + m.afterMin * M);
      if (at > lastAt) lastAt = at;
      msgs.push({ orgId, ticketId: t.id, authorType: m.kind === "r" ? "requester" : "agent", authorId: m.kind === "r" ? null : (assigneeId ?? ctx.userId), body: m.text, internal: m.kind === "n", createdAt: at });
    };
    (s.thread ?? []).forEach(push);

    const firstRespondedAt = s.firstReplyMin != null ? new Date(createdAt.getTime() + s.firstReplyMin * M) : null;
    const resolvedAt = s.resolveH != null ? new Date(createdAt.getTime() + s.resolveH * H) : null;
    const closedAt = s.status === "closed" && resolvedAt ? new Date(resolvedAt.getTime() + 24 * H) : null;

    if (assigneeId) msgs.push({ orgId, ticketId: t.id, authorType: "system", authorId: assigneeId, body: "Ticket assigned", internal: false, createdAt: new Date(createdAt.getTime() + M) });
    if (resolvedAt) msgs.push({ orgId, ticketId: t.id, authorType: "system", authorId: assigneeId, body: "Status changed from open to resolved", internal: false, createdAt: resolvedAt });
    if (closedAt) msgs.push({ orgId, ticketId: t.id, authorType: "system", authorId: assigneeId, body: "Status changed from resolved to closed", internal: false, createdAt: closedAt });
    if (msgs.length) await db.insert(schema.ticketMessages).values(msgs);

    const updatedAt = new Date(Math.max(lastAt.getTime(), closedAt?.getTime() ?? 0, resolvedAt?.getTime() ?? 0));
    await db
      .update(schema.tickets)
      .set({ status: s.status, firstRespondedAt, resolvedAt, closedAt, csatRating: s.csat?.[0] ?? null, csatComment: s.csat?.[1] ?? null, updatedAt })
      .where(eq(schema.tickets.id, t.id));
  }

  await logActivity(ctx, { module: "helpdesk", entityType: "workspace", action: "seeded", summary: `Loaded ${TICKETS.length} sample tickets and ${ARTICLES.length} help articles` });
}
