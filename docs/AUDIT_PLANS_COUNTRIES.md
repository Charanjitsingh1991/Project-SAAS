# Competitive audit, plans & multi-country design

Audit date: Nov 2026. "✅" = already built, "➕" = added in this round.

## 1. Feature parity by module

| Module | Benchmarked against | What saas.tech has |
| --- | --- | --- |
| **HRM** | Keka, greytHR, Zoho People, Bayzat (UAE) | ✅ profiles · departments · org chart · leave + balances + approvals · attendance register + self check-in · holidays · onboarding/offboarding · My space<br>➕ **country-specific statutory IDs** (IN: PAN/UAN/IFSC · AE: Emirates ID, passport, visa, labour card, MOHRE person ID, IBAN)<br>➕ **document vault with expiry alerts** (visa, Emirates ID, passport, licences)<br>➕ **asset management** (assign/return, auto offboarding task)<br>➕ **recruitment / ATS** (job openings → candidate pipeline → hire creates the employee)<br>➕ **performance** (goals with progress + review cycles with ratings)<br>➕ **expense claims** (employee submits → manager approves → reimbursed via payroll or paid directly)<br>➕ configurable **weekend** per workspace · leave **pay %** (half-pay sick leave) · gender-specific leave (maternity/paternity) |
| **Payroll** | Keka, RazorpayX Payroll, greytHR, Bayzat, Zoho Payroll UAE | ✅ runs draft→approved→paid · LOP from attendance · India PF/ESI/PT/TDS · payslips · bank list<br>➕ **country engines**: India (as before) and **UAE** (basic/housing/transport/other, no income tax, GPSSA pension for UAE nationals 11 %/12.5 %, **end-of-service gratuity accrual**, half-pay leave)<br>➕ **WPS SIF file** (UAE Wage Protection System)<br>➕ **loans & salary advances** with monthly EMI deduction<br>➕ **claim reimbursements** paid through payroll<br>➕ **full & final settlement** (pending salary, leave encashment, gratuity, loan recovery) |
| **CRM** | Zoho CRM, HubSpot, Freshsales | ✅ companies 360° · contacts · drag-drop pipeline · activities & follow-ups · forecast · lead score · won-deal automation<br>➕ **quotes / estimates** with line items & tax → **convert to invoice** (marks deal won)<br>➕ **web-to-lead form** (public, per workspace)<br>➕ **CSV import** of contacts & companies |
| **Finance** | Zoho Books, Tally, QuickBooks, Xero | ✅ invoices with tax lines · payments · expenses & bills · double-entry ledger · P&L · balance sheet · trial balance · AR aging · journals<br>➕ **country tax engines**: India GST (CGST+SGST / IGST, GST 2.0 slabs 0/3/5/18/40 %) and **UAE VAT** (5 % standard, zero-rated, exempt, TRN on tax invoices)<br>➕ **VAT return (FTA VAT 201 boxes by emirate)** · GST summary (GSTR-3B style)<br>➕ **UAE corporate tax estimate** (9 % above AED 375,000)<br>➕ **credit notes** (reverse revenue/tax, optional restock)<br>➕ **recurring invoices** · **bank reconciliation** (CSV statement import & match) · **customer statements** |
| **Inventory** | Zoho Inventory, Odoo, Tally | ✅ multi-warehouse · weighted-average cost · transfers/adjustments · POs · receive → bill · reorder planner · stock-out forecast<br>➕ **stock counts** (cycle count sessions with variance posting) · **CSV import** of products · country tax defaults |
| **Projects** | Asana, Zoho Projects, ClickUp | ✅ boards · list · Gantt · milestones · timesheets · profitability · bill hours → invoice<br>➕ country-aware billing tax |
| **Helpdesk** | Freshdesk, Zoho Desk | ✅ SLA timers · internal notes · canned replies · KB · customer portal · CSAT<br>➕ **round-robin auto-assignment** · portal gated by plan |
| **Analytics** | Zoho Analytics (embedded) | ✅ cross-module dashboard + rule-based insights<br>➕ document-expiry & claim-backlog insights |

## 2. Module choice and plans

Workspaces **choose their modules** (Settings → Modules). A disabled module disappears from navigation, its pages and exports are blocked, and automations that would write into it are skipped. Data is kept, so re-enabling restores everything.

| | **Starter** | **Growth** | **Enterprise** |
| --- | --- | --- | --- |
| Modules | **Pick any 3** of HRM, CRM, Finance, Inventory, Projects, Helpdesk | All 8, including **Payroll & Analytics** | All 8 |
| Users | up to 25 | unlimited | unlimited |
| Cross-module automations | — | ✅ | ✅ |
| Recruitment, performance, expense claims | — | ✅ | ✅ |
| Quotes, web-to-lead forms, CSV import | quotes + import | ✅ | ✅ |
| Recurring invoices, bank reconciliation | — | ✅ | ✅ |
| Warehouses | 1 | 5 | unlimited |
| Customer support portal + public KB | — | ✅ | ✅ |
| Audit log (full history, filter, export) | — | — | ✅ |
| Workspaces per owner | 1 | 3 | unlimited |

The free trial is the **Growth** plan with every module. Limits are enforced on the server in `src/lib/plans.ts`.

## 3. Countries

A workspace has one **country**, chosen at sign-up (auto-detected from the phone prefix +91 / +971). The country sets:

| | 🇮🇳 India (`IN`) | 🇦🇪 United Arab Emirates (`AE`) |
| --- | --- | --- |
| Currency / format | INR, en-IN (lakh/crore) | AED, en-AE (fils) |
| Phone | +91 10-digit mobile | +971 5x xxx xxxx |
| Regions | 28 states + 8 UTs | 7 emirates |
| Fiscal year | Apr–Mar | Jan–Dec |
| Weekend (default, editable) | Sat–Sun | Sat–Sun (federal since 2022) |
| Indirect tax | GST: 0/3/5/18/40 %; CGST+SGST intra-state, IGST inter-state; GSTIN | VAT 5 % standard, 0 % zero-rated, exempt; TRN (15 digits) |
| Tax invoice | "Tax Invoice", GSTIN of both parties, place of supply | "Tax Invoice", supplier TRN, customer TRN if registered, VAT in AED |
| Return report | GST summary (output − ITC, GSTR-3B style) | VAT 201: Box 1a–1g by emirate, Box 4 zero-rated, Box 5 exempt, Box 9 recoverable, net due |
| Corporate tax | — | 9 % on taxable income above AED 375,000 (estimate) |
| Salary structure | Basic 50 %, HRA 40/50 %, Special | Basic 60 %, Housing 25 %, Transport 10 %, Other 5 % (overridable per employee) |
| Statutory deductions | PF 12 % (wage cap ₹15k), ESI 0.75/3.25 % (≤ ₹21k), PT ₹200, TDS (new regime) | No income tax. GPSSA pension for UAE nationals: 11 % employee, 12.5 % employer on basic + housing + transport, floored at AED 3,000 and capped at AED 100,000 |
| End of service | — | Gratuity: 21 days' basic per year (years 1–5), 30 days per year after; 1-year minimum; capped at 2 years' wage. Accrued monthly as a provision |
| Salary transfer file | Bank transfer CSV | **WPS SIF** (SCR + EDR records) |
| Default leave | CL 12 · SL 12 · EL 15 · Maternity 182 · Paternity 15 · LWP | Annual 30 · Sick full-pay 15 · Sick half-pay 30 · Maternity 60 · Parental 5 · Bereavement 5 · Unpaid |
| Holidays | National + major festivals | New Year, Eid al-Fitr, Arafat, Eid al-Adha, Hijri New Year, Prophet's Birthday, Commemoration Day, National Day (lunar dates tentative) |
| Employee IDs | PAN, UAN, bank a/c + IFSC | Emirates ID (+ expiry), passport (+ expiry), visa (+ expiry), labour card, MOHRE person ID, IBAN, bank routing code |
| Workspace statutory IDs | TAN, EPF establishment code, ESIC code | MOHRE establishment ID, WPS bank routing code, trade licence no. |

All country rules live in `src/lib/countries/` and are the only place that knows about a specific country. A new country means adding a pack and a payroll engine; the modules themselves don't change.
