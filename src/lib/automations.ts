/** Built-in cross-module automations (client-safe definitions). Stored per workspace in organizations.automations. */
export const AUTOMATIONS = [
  { key: "dealWonInvoice", module: "CRM → Finance", title: "Won deal creates a draft invoice", description: "When a deal moves to Won, a draft invoice for the deal value is created for the customer." },
  { key: "dealWonProject", module: "CRM → Projects", title: "Won deal creates a project", description: "When a deal moves to Won, a project is opened for the client with the deal value as budget." },
  { key: "invoiceStockIssue", module: "Finance → Inventory", title: "Sending an invoice issues stock", description: "Product lines on an invoice reduce stock in the default warehouse and post cost of goods sold." },
  { key: "poReceivedBill", module: "Inventory → Finance", title: "Received PO creates a vendor bill", description: "Receiving a purchase order adds stock at weighted-average cost and records an unpaid bill." },
  { key: "payrollExpense", module: "Payroll → Finance", title: "Paid payroll posts to accounts", description: "Marking a payroll run as paid records the salary expense and PF/ESI/TDS/PT liabilities." },
  { key: "leaveToAttendance", module: "HRM → Payroll", title: "Approved leave updates attendance", description: "Approving leave marks attendance as Leave; unpaid leave becomes loss-of-pay in payroll." },
] as const;

export type AutomationKey = (typeof AUTOMATIONS)[number]["key"];
export type AutomationSettings = Record<AutomationKey, boolean>;

export function parseAutomations(json: string | null | undefined): AutomationSettings {
  let stored: Partial<AutomationSettings> = {};
  try {
    stored = JSON.parse(json || "{}");
  } catch {}
  return Object.fromEntries(AUTOMATIONS.map((a) => [a.key, stored[a.key] ?? true])) as AutomationSettings;
}
