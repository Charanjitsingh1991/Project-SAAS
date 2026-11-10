import { formatMoney } from "../money";
import type { AnyEvent, EventData } from "./catalog";

export type EventPayload = {
  id: string;
  event: AnyEvent;
  created_at: string;
  workspace: { id: number; name: string; currency?: string };
  data: EventData & { url?: string | null };
};

const s = (v: unknown, fallback = "") => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : fallback);
const humanize = (v: unknown) => s(v).replace(/_/g, " ");

/** One human-readable line (no link) describing the event. Amounts in data are minor units. */
export function describeEvent(p: Pick<EventPayload, "event" | "data" | "workspace">): string {
  const d = p.data;
  const cur = p.workspace.currency ?? "INR";
  const money = (v: unknown) => (typeof v === "number" ? ` (${formatMoney(v, cur)})` : "");
  switch (p.event) {
    case "contact.created":
      return `New contact: ${s(d.name, "Unnamed")}${d.email ? ` <${s(d.email)}>` : ""}`;
    case "company.created":
      return `New company: ${s(d.name, "Unnamed")}`;
    case "deal.created":
      return `New deal: ${s(d.title, "Untitled")}${money(d.value)} in ${humanize(d.stage)}`;
    case "deal.stage_changed":
      return `Deal “${s(d.title, "Untitled")}” moved from ${humanize(d.from)} to ${humanize(d.to)}`;
    case "deal.won":
      return `🎉 Deal won: ${s(d.title, "Untitled")}${money(d.value)}`;
    case "deal.lost":
      return `Deal lost: ${s(d.title, "Untitled")}${money(d.value)}${d.lost_reason ? ` — ${s(d.lost_reason)}` : ""}`;
    case "lead.captured":
      return `New web-form lead: ${s(d.name, "Unnamed")}${d.company ? ` (${s(d.company)})` : ""}`;
    case "invoice.sent":
      return `Invoice ${s(d.number)} sent to ${s(d.customer, "customer")}${money(d.total)}`;
    case "invoice.paid":
      return `Invoice ${s(d.number)} from ${s(d.customer, "customer")} is fully paid${money(d.total)}`;
    case "payment.received":
      return `Payment received${money(d.amount)} on invoice ${s(d.invoice_number)} from ${s(d.customer, "customer")}`;
    case "expense.created":
      return `${d.status === "unpaid" ? "Bill" : "Expense"} recorded: ${s(d.description, "Untitled")}${money(d.total)}`;
    case "purchase_order.received":
      return `Purchase order ${s(d.number)} received from ${s(d.vendor, "vendor")}${money(d.total)}`;
    case "employee.created":
      return `New employee: ${s(d.name, "Unnamed")}${d.designation ? `, ${s(d.designation)}` : ""}${d.join_date ? ` (joins ${s(d.join_date)})` : ""}`;
    case "employee.exited":
      return `Employee exited: ${s(d.name, "Unnamed")}${d.exit_date ? ` (last day ${s(d.exit_date)})` : ""}`;
    case "leave.requested":
      return `${s(d.employee, "An employee")} requested ${s(d.days)} day(s) of ${s(d.leave_type, "leave")} (${s(d.start_date)}${d.end_date && d.end_date !== d.start_date ? ` – ${s(d.end_date)}` : ""})`;
    case "leave.decided":
      return `${s(d.employee, "An employee")}'s ${s(d.leave_type, "leave")} request was ${humanize(d.decision)} (${s(d.start_date)})`;
    case "ticket.created":
      return `New ticket ${s(d.number)}: ${s(d.subject, "No subject")} — ${s(d.requester_name, "someone")}${d.priority ? ` [${s(d.priority)}]` : ""}`;
    case "ticket.resolved":
      return `Ticket ${s(d.number)} resolved: ${s(d.subject, "No subject")}`;
    case "test.ping":
      return "Test event from Saasmodels — your integration is connected.";
    default:
      return String(p.event);
  }
}

const mdEscape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Slack incoming webhook body: `text` is the notification fallback, blocks carry the formatted message. */
export function slackBody(p: EventPayload) {
  const line = describeEvent(p);
  const url = p.data.url;
  const text = url ? `${line} — ${url}` : line;
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${mdEscape(line)}${url ? `\n<${url}|Open in ${mdEscape(p.workspace.name)}>` : ""}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: `${mdEscape(p.workspace.name)} · ${p.event}` }] },
    ],
  };
}

/** Teams "Workflows" webhook: a message wrapping an Adaptive Card attachment. */
export function teamsBody(p: EventPayload) {
  const url = p.data.url;
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: describeEvent(p), wrap: true, weight: "Bolder" },
            { type: "TextBlock", text: `${p.workspace.name} · ${p.event}`, wrap: true, isSubtle: true, spacing: "None", size: "Small" },
          ],
          ...(url ? { actions: [{ type: "Action.OpenUrl", title: "Open", url }] } : {}),
        },
      },
    ],
  };
}

/** Google Chat incoming webhook body (`<url|label>` renders as a link). */
export function googleChatBody(p: EventPayload) {
  const url = p.data.url;
  return { text: `${describeEvent(p)}${url ? ` — <${url}|Open>` : ""}` };
}
