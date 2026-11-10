export type HelpdeskTab = "queue" | "kb" | "settings";

export const HELPDESK_TABS = (active: HelpdeskTab) => [
  { href: "/app/helpdesk", label: "Tickets", active: active === "queue" },
  { href: "/app/helpdesk/knowledge-base", label: "Knowledge base", active: active === "kb" },
  { href: "/app/helpdesk/settings", label: "Settings", active: active === "settings" },
];
