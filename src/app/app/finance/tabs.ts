export const FINANCE_TABS = (active: "invoices" | "expenses") => [
  { href: "/app/finance", label: "Invoices", active: active === "invoices" },
  { href: "/app/finance/expenses", label: "Expenses", active: active === "expenses" },
];
