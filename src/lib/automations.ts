/** Built-in cross-module automations (client-safe definitions). Stored per workspace in organizations.automations. */
export const AUTOMATIONS = [
  { key: "dealWonInvoice", tier: "workflow", modules: ["crm", "finance"], module: "CRM → Finance", title: "Won deal creates a draft invoice", description: "When a deal moves to Won, a draft invoice for the deal value is created for the customer." },
  { key: "dealWonProject", tier: "workflow", modules: ["crm", "projects"], module: "CRM → Projects", title: "Won deal creates a project", description: "When a deal moves to Won, a project is opened for the client with the deal value as budget." },
  { key: "invoiceStockIssue", tier: "core", modules: ["finance", "inventory"], module: "Finance → Inventory", title: "Sending an invoice issues stock", description: "Product lines on an invoice reduce stock in the default warehouse and post cost of goods sold." },
  { key: "poReceivedBill", tier: "core", modules: ["inventory"], module: "Inventory → Finance", title: "Received PO creates a vendor bill", description: "Receiving a purchase order adds stock at weighted-average cost and records an unpaid bill." },
  { key: "payrollExpense", tier: "core", modules: ["payroll"], module: "Payroll → Finance", title: "Paid payroll posts to accounts", description: "Marking a payroll run as paid records salaries, statutory liabilities, gratuity and loan recoveries in the ledger." },
  { key: "leaveToAttendance", tier: "core", modules: ["hrm"], module: "HRM → Payroll", title: "Approved leave updates attendance", description: "Approving leave marks attendance as Leave; unpaid and half-pay leave become loss-of-pay in payroll." },
  { key: "claimsViaPayroll", tier: "workflow", modules: ["hrm", "payroll"], module: "HRM → Payroll", title: "Approved claims are reimbursed in payroll", description: "Approved expense claims marked “via payroll” are added to the employee's next payslip." },
] as const;

export type AutomationKey = (typeof AUTOMATIONS)[number]["key"];
export type AutomationSettings = Record<AutomationKey, boolean>;

/** Stored toggles (default on). Use `effectiveAutomations` to apply plan & module rules. */
export function parseAutomations(json: string | null | undefined): AutomationSettings {
  let stored: Partial<AutomationSettings> = {};
  try {
    stored = JSON.parse(json || "{}");
  } catch {}
  return Object.fromEntries(AUTOMATIONS.map((a) => [a.key, stored[a.key] ?? true])) as AutomationSettings;
}

/**
 * Toggles actually in force: workflow automations need the plan's "automations" feature;
 * every automation needs all of its modules switched on.
 */
export function effectiveAutomations(stored: AutomationSettings, opts: { planAutomations: boolean; modules: readonly string[] }): AutomationSettings {
  return Object.fromEntries(
    AUTOMATIONS.map((a) => {
      const allowed = (a.tier === "core" || opts.planAutomations) && a.modules.every((m) => opts.modules.includes(m));
      return [a.key, allowed && stored[a.key]];
    }),
  ) as AutomationSettings;
}
