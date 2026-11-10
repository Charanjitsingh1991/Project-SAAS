import type { ToolName, ToolResult } from "./catalog";
import { parseDateRange } from "./dates";

/** Rule-based (no model) question → tool-call planner. Pure and deterministic. */

export type PlannedCall = { tool: ToolName; params: Record<string, unknown> };
export type PlanContext = {
  today: string;
  /** Tools this user may run (module + plan checked by the caller). */
  allowed: readonly string[];
  departments?: readonly string[];
  locations?: readonly string[];
};

const has = (t: string, re: RegExp) => re.test(t);

function findName(t: string, names: readonly string[] | undefined) {
  return (names ?? []).find((n) => n.trim().length >= 3 && t.includes(n.toLowerCase()));
}

export function planQuestion(question: string, ctx: PlanContext): PlannedCall[] {
  const t = ` ${question.toLowerCase().replace(/[?!.]+$/g, "")} `;
  const range = parseDateRange(t, ctx.today);
  const calls: PlannedCall[] = [];
  const add = (tool: ToolName, params: Record<string, unknown> = {}) => {
    if (ctx.allowed.includes(tool) && !calls.some((c) => c.tool === tool)) calls.push({ tool, params });
  };
  const span = range ? { from: range.from, to: range.to } : undefined;
  const monthOf = (r: typeof range) => (r ? r.from.slice(0, 7) : undefined);
  const thisMonth = { from: `${ctx.today.slice(0, 7)}-01`, to: ctx.today };

  const taskWords = has(t, /\b(tasks?|to-?dos?|deadlines?|milestones?)\b/);
  const ticketWords = has(t, /\b(tickets?|sla|helpdesk|support requests?|customer complaints?)\b/);
  const dealWords = has(t, /\b(deals?|opportunit\w+|pipeline|funnel|leads?|prospects?)\b/);

  // Finance
  const invoiceWords = has(t, /\b(invoices?|unpaid|overdue payments?|late payments?|dues?)\b/) || (has(t, /\boverdue\b/) && !taskWords && !ticketWords);
  if (invoiceWords && !has(t, /\bpurchase orders?\b/)) {
    const n = t.match(/(\d{1,4})\s*\+?\s*days?\s+(?:overdue|late|past)|(?:more than|over|older than|>)\s*(\d{1,4})\s*days?/);
    const min = n ? Number(n[1] ?? n[2]) : undefined;
    add("overdue_invoices", { ...(min ? { minDaysOverdue: min } : {}), ...(dealWords ? { withOpenDeals: true } : {}) });
  }
  if (has(t, /\b(receivables?|debtors?|owe us|owes us|outstanding|aging|ageing|collections?)\b/) && !calls.length) add("receivables");
  if (has(t, /\b(top|biggest|largest|best|key|major)\b.*\b(customers?|clients?|accounts?)\b/)) add("top_customers", range ? { from: range.from, to: range.to } : {});
  if (has(t, /\b(revenue|income|expenses?|spend(?:ing)?|profit|loss|turnover|earnings|margin|burn)\b/) || (has(t, /\bsales\b/) && !dealWords && !has(t, /\bsales (?:person|rep|team)\b/))) {
    add("revenue_expenses", span ?? thisMonth);
  }
  if (has(t, /\b(cash|bank balance|bank accounts?|money in the bank|runway|liquidity)\b/)) add("cash_balance");

  // CRM
  if (dealWords && !invoiceWords) {
    if (has(t, /\b(clos(?:e|es|ing)|expected|forecast)\b/)) add("deals_closing", span ?? thisMonth);
    else if (has(t, /\b(won|win|lost|lose|win rate|closed)\b/)) add("won_lost", span ?? thisMonth);
    else add("pipeline");
  } else if (has(t, /\b(won|lost|win rate)\b/)) add("won_lost", span ?? thisMonth);

  // HRM
  const leaveWords = has(t, /\b(leaves?|vacations?|time off|pto|out of office|ooo|holidays?|off work|absent|away)\b/);
  if (leaveWords && !has(t, /\battendance\b/)) {
    const dept = findName(t, ctx.departments);
    const loc =
      findName(t, ctx.locations) ??
      t.match(/\bin (?:the )?([a-z][a-z .-]{2,30}?) (?:warehouse|office|branch|location|site|store)\b/)?.[1]?.trim();
    add("on_leave", { ...(span ?? { from: ctx.today, to: ctx.today }), ...(dept ? { department: dept } : {}), ...(loc ? { location: loc } : {}) });
  }
  if (has(t, /\b(headcount|how many (?:employees|people|staff)|team size|staff count|employees by department)\b/)) add("headcount");
  if (has(t, /\b(attendance|checked in|check-?ins?|present today|who(?:'s| is) (?:in|absent|late)|absentees?)\b/)) add("attendance_today", range?.from === range?.to && range ? { date: range.from } : {});
  if (has(t, /\b(birthdays?|anniversar\w+|work anniversary)\b/)) {
    const kind = has(t, /birthday/) && !has(t, /anniversar/) ? "birthdays" : has(t, /anniversar/) && !has(t, /birthday/) ? "anniversaries" : "both";
    const days = range ? Math.max(1, Math.min(366, Math.round((Date.parse(range.to) - Date.parse(ctx.today)) / 86_400_000) + 1)) : 30;
    add("upcoming_events", { kind, days });
  }

  // Inventory
  if (has(t, /\b(stock value|inventory value|value of (?:the )?(?:stock|inventory)|stock worth|inventory worth)\b/)) add("stock_value");
  else if (has(t, /\b(stock|reorder|re-order|inventory|running out|run out|restock|days of cover|below \d+)\b/)) {
    const w = t.match(/(\d+(?:\.\d+)?)\s*(weeks?|days?)/);
    const days = w ? Number(w[1]) * (w[2].startsWith("w") ? 7 : 1) : undefined;
    add("low_stock", days ? { maxDaysCover: Math.min(365, Math.max(1, days)) } : {});
  }

  // Helpdesk / projects
  if (ticketWords || has(t, /\bsupport\b/)) add("open_tickets");
  if (taskWords) add("overdue_tasks");
  if (has(t, /\bprojects?\b/) && !taskWords) add("project_status");

  // Payroll
  if (has(t, /\b(payroll|salary|salaries|payslips?|wage bill|ctc)\b/)) {
    add("payroll_cost", monthOf(range) && range?.from.endsWith("-01") ? { month: monthOf(range) } : {});
  }

  return calls.slice(0, 3);
}

/** Templated one-paragraph answer assembled from tool facts (rules mode, or when the model fails). */
export function templateAnswer(results: readonly ToolResult[]): string {
  if (!results.length) return "";
  return results
    .map((r) => {
      const facts = r.facts.length ? r.facts.join(" ") : r.rows.length ? `${r.rows.length} row${r.rows.length === 1 ? "" : "s"} found.` : "Nothing found.";
      return `${r.title}: ${facts}`;
    })
    .join("\n");
}

export const NO_MATCH_MESSAGE =
  "I couldn't match that to something I can look up. Try asking about overdue invoices, receivables, revenue or expenses, the sales pipeline, who is on leave, headcount, low stock, open tickets, overdue tasks or payroll cost.";
