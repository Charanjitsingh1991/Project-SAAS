/** Event catalogue for outgoing webhooks and chat notifications. Pure: safe to import from client components and tests. */

export const EVENT_GROUPS = [
  {
    module: "CRM",
    events: [
      { key: "contact.created", label: "Contact created" },
      { key: "company.created", label: "Company created" },
      { key: "deal.created", label: "Deal created" },
      { key: "deal.stage_changed", label: "Deal stage changed" },
      { key: "deal.won", label: "Deal won" },
      { key: "deal.lost", label: "Deal lost" },
      { key: "lead.captured", label: "Web-form lead captured" },
    ],
  },
  {
    module: "Finance",
    events: [
      { key: "invoice.sent", label: "Invoice sent" },
      { key: "invoice.paid", label: "Invoice fully paid" },
      { key: "payment.received", label: "Payment received" },
      { key: "expense.created", label: "Expense or bill created" },
    ],
  },
  { module: "Inventory", events: [{ key: "purchase_order.received", label: "Purchase order received" }] },
  {
    module: "HRM",
    events: [
      { key: "employee.created", label: "Employee added" },
      { key: "employee.exited", label: "Employee exited" },
      { key: "leave.requested", label: "Leave requested" },
      { key: "leave.decided", label: "Leave approved, rejected or cancelled" },
    ],
  },
  {
    module: "Helpdesk",
    events: [
      { key: "ticket.created", label: "Ticket created" },
      { key: "ticket.resolved", label: "Ticket resolved" },
    ],
  },
] as const;

export type EventName = (typeof EVENT_GROUPS)[number]["events"][number]["key"];
export const EVENT_NAMES: EventName[] = EVENT_GROUPS.flatMap((g) => g.events.map((e) => e.key));
/** Sent by "Send test event"; never subscribable. */
export const TEST_EVENT = "test.ping" as const;
export type AnyEvent = EventName | typeof TEST_EVENT;

export function isEventName(v: unknown): v is EventName {
  return typeof v === "string" && (EVENT_NAMES as string[]).includes(v);
}

/** Parse the stored JSON array, dropping unknown names. */
export function parseEvents(json: string | null | undefined): EventName[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter(isEventName) : [];
  } catch {
    return [];
  }
}

export type EventData = Record<string, string | number | boolean | null | undefined>;

/** App path of the record an event is about (relative; the origin is added at emit time). */
export function eventPath(event: AnyEvent, d: EventData): string | null {
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  const id = n("id");
  switch (event) {
    case "contact.created":
      return id ? `/app/crm/contacts/${id}` : null;
    case "company.created":
      return id ? `/app/crm/companies/${id}` : null;
    case "deal.created":
    case "deal.stage_changed":
    case "deal.won":
    case "deal.lost":
      return id ? `/app/crm/deals/${id}` : null;
    case "lead.captured": {
      const deal = n("deal_id");
      return deal ? `/app/crm/deals/${deal}` : null;
    }
    case "invoice.sent":
    case "invoice.paid":
      return id ? `/app/finance/invoices/${id}` : null;
    case "payment.received": {
      const inv = n("invoice_id");
      return inv ? `/app/finance/invoices/${inv}` : null;
    }
    case "expense.created":
      return "/app/finance/expenses";
    case "purchase_order.received":
      return id ? `/app/inventory/purchase-orders/${id}` : null;
    case "employee.created":
    case "employee.exited":
      return id ? `/app/hrm/${id}` : null;
    case "leave.requested":
    case "leave.decided":
      return "/app/hrm/leave";
    case "ticket.created":
    case "ticket.resolved":
      return id ? `/app/helpdesk/tickets/${id}` : null;
    default:
      return null;
  }
}
