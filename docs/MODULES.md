# saas.tech — Module Blueprint

This is the source of truth for how every module behaves. Code must match it.

## 0. Design principles (what makes saas.tech different)

Most suites (Zoho, Odoo, SAP B1, Keka, Freshworks) are separate apps glued together with sync jobs. saas.tech is one database with one ledger.

1. **Connected by default.** A business event updates every module it touches, inside the same transaction path. No exports, no "sync", no duplicate entry. Built-in automations (toggleable per workspace):
   - Deal **won** → draft invoice (CRM → Finance) and a project (CRM → Projects).
   - Invoice **sent** → ledger posting and stock issue for product lines (Finance → Accounting → Inventory).
   - Payment **recorded** → ledger, plus invoice status partial/paid.
   - Purchase order **received** → stock receipt at weighted-average cost, plus an unpaid vendor bill (Inventory → Finance).
   - Payroll **paid** → salary journal (PF/ESI/TDS/PT liabilities) and an expense record (Payroll → Finance).
   - Billable **hours** → one-click invoice (Projects → Finance).
   - Leave **approved** → attendance marked "leave" → payroll loss-of-pay (HRM → Payroll).
2. **One double-entry ledger.** Every money event posts balanced journal lines (Σ debit = Σ credit). Voids create reversing entries; nothing is silently deleted. The P&L, balance sheet and trial balance always reconcile.
3. **Money is exact.** All amounts are stored as integer **minor units** (paise/cents). Tax is computed per line and rounded once.
4. **Transparent compliance.** Payroll shows every statutory calculation (PF, ESI, PT, TDS under the new regime) line by line, so it can be audited.
5. **Fast everywhere.** ⌘K / Ctrl-K command palette searches every module. Drag-and-drop boards (pipeline, tasks). Inline status changes. CSV export on every list.
6. **Self-service.** Every employee gets "My space": check in/out, leave balance and requests, payslips, tasks, timesheet.
7. **Accountable.** An activity log records who did what, shown on the overview and on records.
8. **Honest insights.** Rule-based signals computed from live data: stuck deals, overdue invoices, stock-out forecast, SLA breaches, expense spikes. No fake "AI" claims.

Conventions: every table has `org_id` and every query filters by it. Every action calls `requireWorkspace({ module })` and validates with zod. Mutations call `logActivity`.

---

## 1. HRM — People
**Data:** departments, employees, onboarding_tasks, holidays, leave_types, leave_requests, attendance.

- **Employee profile** (`/app/hrm/[id]`), with tabs Overview / Job / Compensation / Leave / Attendance / Onboarding:
  - **Personal:** name, email, phone, gender, DOB, address.
  - **Job:** code (EMP-0001), department, designation, manager (org chart), employment type (full-time / part-time / contract / intern), work location, join date, probation end, linked user account.
  - **Compensation:** annual CTC and an auto salary structure preview (Basic 50% of CTC; HRA 40% of Basic, 50% if metro; Special = rest), PF enrolled, metro flag.
  - **Statutory:** PAN, UAN, bank account, IFSC (masked in lists).
  - **Lifecycle:** active → notice → exited (exit date + reason). Creating an employee generates a default onboarding checklist; moving to notice generates an offboarding checklist.
- **Directory:** search, filter by department/status/type, headcount KPIs (active, joiners this month, on notice, attrition 12-month), CSV export.
- **Departments:** CRUD with department head; headcount per department.
- **Org chart:** tree from the manager links.
- **Leave:**
  - **Types** with annual quota, paid/unpaid and colour. Defaults: Casual 12, Sick 12, Earned 15, Unpaid 0.
  - **Balance** = quota − approved days this calendar year.
  - **Days** counted as working days only (skip Sat/Sun and holidays); half-day = 0.5.
  - **Validation:** blocks overlap with existing pending/approved leave and blocks exceeding balance for paid types.
  - **Approvals:** approve / reject / cancel. Approving marks attendance rows as `leave`; cancelling an approved leave removes them.
  - **Leave calendar:** who's out this week / month.
- **Attendance:**
  - Daily register: present, absent, half-day, leave, holiday, WFH, with check-in / check-out times.
  - Monthly grid (employees × days) with a summary of present / absent / leave / LOP days.
  - Bulk "mark all present" for a date.
  - Self check-in / check-out from My space.
- **Holidays:** yearly calendar CRUD.
- **My space** (`/app/me`, every role):
  - my profile, check in/out today, my leave balances and requests (apply / cancel), my attendance this month, my payslips.
  - Requires the user to be linked to an employee record (matched by email automatically, or set by HR).

## 2. Payroll
**Data:** payroll_runs, payslips (+ employees, attendance, leave from HRM).

**Monthly run flow:** **draft** → **approved** (locked) → **paid**.

1. **Create run for a period (YYYY-MM).** Working days = calendar days of the month; salaried staff are paid for all calendar days minus LOP.
   - Includes employees active at any point in the month: joined ≤ month end, and not exited before month start.
   - Pro-rated for mid-month joiners and exits.
2. **LOP days** = absent days + unpaid-leave days + half-days × 0.5, taken from attendance and approved unpaid leave.
   - Paid days = days in month − LOP − days before joining − days after exit.
3. **Earnings** (monthly, from CTC/12, pro-rated by paid days / days in month): Basic, HRA, Special, plus adjustments (bonus, other earnings).
4. **Deductions (India):**
   - **PF:** employee 12% of Basic, capped at a ₹15,000 basic wage (max ₹1,800); employer the same. Only if PF enrolled.
   - **ESI:** if monthly gross ≤ ₹21,000, employee 0.75% and employer 3.25% of gross.
   - **Professional Tax:** ₹200 if gross > ₹15,000, otherwise ₹0.
   - **TDS, new regime FY 2025-26:**
     - Annual taxable = (monthly gross × 12) − ₹75,000 standard deduction.
     - Slabs: 0–4L 0%, 4–8L 5%, 8–12L 10%, 12–16L 15%, 16–20L 20%, 20–24L 25%, >24L 30%.
     - Section 87A rebate: no tax if taxable ≤ ₹12L.
     - Plus 4% cess. Monthly TDS = annual / 12.
   - **Other deductions:** manual adjustment.
5. **Review screen:** edit bonus / other earnings / other deductions per payslip while in draft, with live recalculation. Totals: gross, deductions, net, employer cost.
6. **Approve** locks it; **Mark paid** posts the salary journal and creates an expense record (category Salaries, source payroll). A paid run cannot be edited or deleted. Delete is allowed only for drafts.
7. **Payslip page:** printable, with earnings / deductions breakdown, employer contributions, paid / LOP days and net in words. Visible to payroll roles and to the employee themselves.
8. **Statutory summary per run:** PF (employee + employer), ESI, PT and TDS totals for challans. CSV export of the bank-transfer list.

## 3. CRM
**Data:** companies, contacts, deals, crm_activities.

- **Companies (accounts):** industry, website, phone, GSTIN, billing address / city / state / country, owner.
  - Company page shows contacts, deals, activities, invoices (from Finance) and tickets (from Helpdesk): a full 360° view.
- **Contacts:** title, email, phone, company, owner, lifecycle (lead → prospect → customer → churned), source (website / referral / outbound / event / partner / other).
- **Pipeline:**
  - Stages and their default probabilities: lead 10%, qualified 25%, proposal 50%, negotiation 75%, won 100%, lost 0%.
  - **Drag-and-drop board** with a per-column count and total.
  - Deal fields: value, company, contact, owner, source, expected close, probability.
  - `stage_changed_at` records when the deal entered its current stage.
  - **Won:** sets `closed_at` and runs the automations (draft invoice + project, contact → customer).
  - **Lost:** requires a lost reason.
- **Deal page:** details, stage history (from the activity log), activities timeline (note / call / meeting / email / task with due date and done), linked invoice and project.
- **Follow-ups:** "My tasks" list of open activities with due dates, with overdue ones highlighted.
- **Forecast:** weighted pipeline (value × probability) by expected-close month for the next 6 months; win rate; average deal size; sales cycle (created → won, in days); lost reasons breakdown.
- **Lead score (0–100), rule-based:**
  - +20 has email, +10 has phone, +10 linked company.
  - +up to 30 by deal value percentile.
  - +20 activity in the last 14 days.
  - −20 if stuck in its stage for more than 21 days.

## 4. Finance & Accounting
**Data:** accounts (chart), journal_entries, journal_lines, invoices, invoice_lines, payments, expenses, vendors.

- **Chart of accounts:** seeded per workspace (Bank, AR, Inventory, GST Input, AP, GST Payable, PF/ESI payable, TDS payable, PT payable, Equity, Sales, Other income, COGS, Salaries, Employer contributions, and expense categories). Custom accounts can be added.
- **Invoices:**
  - **Header:** customer (pick a CRM company or type a name), email, billing address, GSTIN, place of supply, issue / due date, notes.
  - **Lines:** product (optional, from Inventory, which pre-fills price and tax), description, quantity, unit price and GST rate (0 / 5 / 12 / 18 / 28%). Line amount and tax are computed per line.
  - **GST split:** shown as CGST + SGST when the place of supply = workspace state, else IGST.
  - **Numbering** auto INV-1001… per workspace.
  - **Statuses:** draft → sent → partial → paid; void.
    - **Send** posts the ledger (Dr AR / Cr Sales / Cr GST payable) and issues stock for product lines (Dr COGS / Cr Inventory at average cost).
    - **Record payment** (date, amount ≤ balance, method UPI / bank transfer / card / cash / cheque, reference) posts Dr Bank / Cr AR.
    - **Void** is allowed only with no payments; it reverses both the ledger and the stock.
  - **Printable invoice page** (tax invoice layout, amount in words).
  - **List:** filters by status, an overdue flag and a days-overdue column.
- **Expenses / bills:**
  - Fields: vendor, category, amount, GST input, payment method, reference, date, and status paid/unpaid with a due date.
  - **Paid** posts Dr Expense, Dr GST Input, Cr Bank. **Unpaid** posts Cr AP instead; "Pay bill" later posts Dr AP / Cr Bank.
  - Bills come from purchase orders and payroll automatically.
- **Vendors:** shared with Inventory.
- **Reports** (date range; the default is the current fiscal year, April–March):
  - **Profit & Loss** from the ledger: income − COGS = gross profit; − expenses = net profit; monthly columns.
  - **Balance sheet:** assets = liabilities + equity + retained earnings.
  - **Trial balance.**
  - **Receivables aging:** current, 1–30, 31–60, 61–90, 90+ by customer.
  - **GST summary:** output tax − input credit = net payable, by month.
  - **Cash flow:** bank account movement.
- **Manual journal entry** (balanced lines) for adjustments.

## 5. Inventory & Purchasing
**Data:** warehouses, products, stock_levels, stock_movements, vendors, purchase_orders, purchase_order_lines.

- **Products:**
  - SKU (unique), barcode, category, unit (pcs / box / kg / l / m), cost price (weighted average, read-only after the first receipt), selling price, GST rate, reorder level, reorder quantity, preferred vendor, track-stock flag, active.
  - Product page: stock by warehouse, movement ledger, POs, and margin %.
- **Warehouses:** multi-location, with one default. Created per workspace as "Main warehouse".
- **Stock operations:**
  - Every operation writes a signed stock movement: receive / issue / adjust / **transfer between warehouses**.
  - Negative stock is allowed but flagged red.
  - Stock movement types: opening, receipt, issue, sale, transfer_in, transfer_out, adjustment.
- **Valuation:** weighted-average cost recalculated on every receipt:
  - new cost = (on-hand × cost + received × unit cost) / (on-hand + received).
  - Inventory value = Σ qty × cost.
- **Purchase orders:**
  - PO-0001 numbering; vendor, destination warehouse, lines (product, quantity, unit cost, GST), expected date.
  - Statuses: draft → ordered → received (or cancelled).
  - **Receive** adds stock and updates the average cost, then creates an unpaid bill (Dr Inventory / Dr GST Input / Cr AP).
  - Printable PO.
- **Reorder planner:** products at or below their reorder level, grouped by preferred vendor, with suggested quantity = reorder qty. One click creates a draft PO per vendor.
- **Stock-out forecast:** average daily issue over the last 30 days → days of cover; flag items with < 14 days.
- **Vendors (suppliers):** contact details, GSTIN, POs and bills.

## 6. Projects
**Data:** projects, milestones, tasks, task_comments, time_entries.

- **Projects:**
  - Code (PRJ-001), client (CRM company), description, owner, colour, start / due dates.
  - Status: planning / active / on hold / done / cancelled.
  - Billing: fixed fee (budget) / hourly (rate) / non-billable.
- **Board:** drag-and-drop columns backlog / to do / in progress / review / done.
  - Task cards show priority, assignee avatar, due date (red if overdue) and estimate.
- **List view:** sortable table. **Timeline (Gantt):** tasks and milestones drawn on a date grid from start / due dates.
- **Task detail:** description, comments thread, assignee (employee), priority, estimate hours, logged hours, start / due dates, milestone.
- **Milestones** with due date and done state; progress = done tasks / total.
- **Timesheets:**
  - Log hours (project, task, employee, date, hours, description, billable).
  - Weekly timesheet view per person.
  - Logging is available from My space too.
- **Profitability:**
  - Cost = Σ hours × employee hourly cost (annual CTC / 2,080 hrs).
  - Revenue = fixed budget, or billable hours × rate.
  - Margin and budget burn %.
- **Bill time:** unbilled billable hours → draft invoice (grouped by task) via automation; entries are marked invoiced.

## 7. Helpdesk
**Data:** tickets, ticket_messages, sla_policies, canned_responses, kb_articles.

- **Tickets:**
  - TCK-1001 numbering; subject, requester name / email (auto-linked to a CRM contact / company by email).
  - Channel (email / phone / chat / WhatsApp / web / portal), category, priority, assignee (workspace member).
  - Status: open → pending (waiting on customer) → on hold → resolved → closed.
- **Conversation:** public replies and internal notes (yellow), with **canned responses** to insert. The first agent public reply sets `first_responded_at`.
- **SLA policies** per priority:
  - Defaults: urgent 1h response / 4h resolve; high 4h / 24h; medium 8h / 48h; low 24h / 120h.
  - Due timestamps are set at creation and recomputed if the priority changes.
  - Badges: on track / at risk (< 25% time left) / breached.
  - Compliance % on the dashboard.
- **Views:** all, unassigned, mine, overdue SLA, and by status; sort by SLA due.
- **Customer portal** (public, `/support/[workspace-slug]`):
  - Search published knowledge-base articles, read an article, submit a ticket.
  - Each ticket gets a private link (`/support/[slug]/ticket/[token]`) where the requester sees the thread, replies, and rates **CSAT** 1–5 after resolution.
- **Knowledge base:** articles with category, body, published flag and view count.
- **Metrics:** open by priority, avg first response time, avg resolution time, SLA compliance, CSAT average.

## 8. Analytics
Live cross-module dashboard with a date range (this month / last 3 months / fiscal year):
- **Finance:** revenue, expenses, net profit, cash balance, receivables, GST payable; monthly revenue vs expense chart.
- **Sales:** pipeline by stage, weighted forecast, win rate, avg cycle.
- **People:** headcount trend (12 months), joiners / exits, attrition %, leave utilisation, payroll cost trend.
- **Operations:** inventory value, low stock, stock-out risk.
- **Projects:** active projects, overdue tasks, utilisation (billable hours / logged hours), margin by project.
- **Support:** open tickets, SLA compliance, CSAT.
- **Insights feed** (rule-based, each linking to the record):
  - Deals stuck > 21 days; invoices overdue > 30 days.
  - Expenses this month > 25% above the 3-month average.
  - Products with < 14 days of cover; SLA breaches today.
  - Projects over 90% budget burn; employees with probation ending in 14 days.

## Cross-cutting
- **⌘K command palette:** searches employees, companies, contacts, deals, invoices, products, projects, tasks and tickets (respecting role access), plus quick actions.
- **Activity log:** module, entity, action, summary, actor and time. Shown as the overview feed and on records.
- **Automation settings** (`/app/settings/automations`): toggle each built-in automation.
- **CSV export:** `/api/export/[entity]`, role-checked.
- **Print:** invoice, payslip and PO pages hide app chrome when printed.
- **Defaults per workspace:** chart of accounts, main warehouse, leave types, SLA policies, workspace slug.
