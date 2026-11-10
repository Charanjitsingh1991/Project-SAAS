export type FinanceTab = "overview" | "invoices" | "credit-notes" | "recurring" | "expenses" | "bank" | "reports" | "accounts" | "journal";

export const FINANCE_TABS = (active: FinanceTab) => [
  { href: "/app/finance", label: "Overview", active: active === "overview" },
  { href: "/app/finance/invoices", label: "Invoices", active: active === "invoices" },
  { href: "/app/finance/credit-notes", label: "Credit notes", active: active === "credit-notes" },
  { href: "/app/finance/recurring", label: "Recurring", active: active === "recurring" },
  { href: "/app/finance/expenses", label: "Expenses", active: active === "expenses" },
  { href: "/app/finance/bank", label: "Bank", active: active === "bank" },
  { href: "/app/finance/reports", label: "Reports", active: active === "reports" },
  { href: "/app/finance/accounts", label: "Accounts", active: active === "accounts" },
  { href: "/app/finance/journal", label: "Journal", active: active === "journal" },
];
