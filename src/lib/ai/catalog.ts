import { z } from "zod";
import type { ModuleKey } from "@/lib/roles";

/** Pure tool catalog (no I/O): names, descriptions, parameter schemas and the module each tool needs. */

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const range = {
  from: ymd.describe("Start date, YYYY-MM-DD, inclusive"),
  to: ymd.describe("End date, YYYY-MM-DD, inclusive"),
};
const optRange = { from: range.from.optional(), to: range.to.optional() };

export type ToolDef = {
  name: string;
  description: string;
  module: ModuleKey;
  params: z.ZodObject;
};

export const TOOL_DEFS = [
  {
    name: "overdue_invoices",
    description: "Invoices past their due date with a balance outstanding, largest first. Optionally attach each customer's open CRM deals.",
    module: "finance",
    params: z.object({
      minDaysOverdue: z.number().int().min(0).max(3650).optional().describe("Only invoices at least this many days overdue"),
      withOpenDeals: z.boolean().optional().describe("Also show the customer's open deal stage (needs CRM access)"),
    }),
  },
  {
    name: "receivables",
    description: "Receivables summary: total outstanding, aging buckets, and top debtors.",
    module: "finance",
    params: z.object({}),
  },
  {
    name: "revenue_expenses",
    description: "Invoiced revenue (excl. tax), cash collected, expenses and profit by month for a date range.",
    module: "finance",
    params: z.object(range),
  },
  {
    name: "cash_balance",
    description: "Current bank and cash balances from the ledger.",
    module: "finance",
    params: z.object({}),
  },
  {
    name: "top_customers",
    description: "Customers ranked by invoiced revenue (excl. tax), optionally within a date range.",
    module: "finance",
    params: z.object({ ...optRange, limit: z.number().int().min(1).max(50).optional() }),
  },
  {
    name: "pipeline",
    description: "Open sales pipeline by stage: deal count, value and probability-weighted value.",
    module: "crm",
    params: z.object({}),
  },
  {
    name: "deals_closing",
    description: "Open deals whose expected close date falls in a date range.",
    module: "crm",
    params: z.object(range),
  },
  {
    name: "won_lost",
    description: "Deals won and lost in a date range (by close date), with totals.",
    module: "crm",
    params: z.object(range),
  },
  {
    name: "on_leave",
    description: "Employees on approved leave during a date range, optionally filtered by department or work location.",
    module: "hrm",
    params: z.object({
      ...range,
      department: z.string().max(80).optional().describe("Department name (partial match)"),
      location: z.string().max(80).optional().describe("Work location (partial match)"),
    }),
  },
  {
    name: "headcount",
    description: "Active headcount by department.",
    module: "hrm",
    params: z.object({}),
  },
  {
    name: "attendance_today",
    description: "Attendance status counts for a day (default today) and who is absent or not yet marked.",
    module: "hrm",
    params: z.object({ date: ymd.optional() }),
  },
  {
    name: "upcoming_events",
    description: "Upcoming employee birthdays and work anniversaries in the next N days.",
    module: "hrm",
    params: z.object({
      days: z.number().int().min(1).max(366).optional(),
      kind: z.enum(["birthdays", "anniversaries", "both"]).optional(),
    }),
  },
  {
    name: "low_stock",
    description: "Products at/below reorder level or with fewer than N days of stock cover (30-day average usage).",
    module: "inventory",
    params: z.object({ maxDaysCover: z.number().min(1).max(365).optional().describe("Default 14 days") }),
  },
  {
    name: "stock_value",
    description: "Inventory value (quantity × average cost) by warehouse.",
    module: "inventory",
    params: z.object({}),
  },
  {
    name: "open_tickets",
    description: "Open helpdesk tickets by priority and the tickets that breached their SLA.",
    module: "helpdesk",
    params: z.object({}),
  },
  {
    name: "overdue_tasks",
    description: "Project tasks past their due date and not done, most overdue first.",
    module: "projects",
    params: z.object({}),
  },
  {
    name: "project_status",
    description: "Active projects with task progress and overdue task counts.",
    module: "projects",
    params: z.object({}),
  },
  {
    name: "payroll_cost",
    description: "Payroll totals (gross, deductions, net, employer cost) for one month (YYYY-MM) or the latest runs.",
    module: "payroll",
    params: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
  },
] as const satisfies readonly ToolDef[];

export type ToolName = (typeof TOOL_DEFS)[number]["name"];
export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name) as ToolName[];

export function toolDef(name: string): ToolDef | undefined {
  return TOOL_DEFS.find((t) => t.name === name);
}

export type Cell = string | number | null;
export type ToolResult = {
  tool: string;
  title: string;
  columns: string[];
  rows: Cell[][];
  /** Optional per-row link target, aligned with `rows`. */
  links?: (string | null)[];
  /** Short facts the model/answer can quote, e.g. "Total outstanding: ₹4,80,000". */
  facts: string[];
  /** Where to act on this data. */
  href?: string;
};

export const MAX_ROWS = 50;

/** OpenAI-style tool specs for the tools the user may call. */
export function openAiTools(allowed: readonly string[]) {
  return TOOL_DEFS.filter((t) => allowed.includes(t.name)).map((t) => {
    const schema = { ...(z.toJSONSchema(t.params) as Record<string, unknown>) };
    delete schema.$schema;
    return { type: "function" as const, function: { name: t.name, description: t.description, parameters: schema } };
  });
}
