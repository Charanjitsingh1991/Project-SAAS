export type CrmTab = "pipeline" | "followups" | "forecast" | "companies" | "contacts";

export const CRM_TABS = (active: CrmTab) => [
  { href: "/app/crm", label: "Pipeline", active: active === "pipeline" },
  { href: "/app/crm/activities", label: "Follow-ups", active: active === "followups" },
  { href: "/app/crm/forecast", label: "Forecast", active: active === "forecast" },
  { href: "/app/crm/companies", label: "Companies", active: active === "companies" },
  { href: "/app/crm/contacts", label: "Contacts", active: active === "contacts" },
];
