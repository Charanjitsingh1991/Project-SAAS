export const CRM_TABS = (active: "pipeline" | "contacts") => [
  { href: "/app/crm", label: "Pipeline", active: active === "pipeline" },
  { href: "/app/crm/contacts", label: "Contacts", active: active === "contacts" },
];
