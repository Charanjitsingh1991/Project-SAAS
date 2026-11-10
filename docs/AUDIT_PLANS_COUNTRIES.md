# Competitive audit, plans & multi-country design

Audit date: Nov 2026. "✅" = existed before this round, "➕" = added in this round. Anything not built is listed under **Not built yet** — the app and pricing page don't advertise it.

## 1. Feature parity by module

| Module | Benchmarked against | What saasmodels.tech has |
| --- | --- | --- |
| **HRM** | Keka, greytHR, Zoho People, Bayzat (UAE) | ✅ profiles · departments · org chart · leave + balances + approvals · attendance register + self check-in · holidays · onboarding/offboarding · My space<br>➕ **country-specific employee fields** (IN: PAN/UAN/bank + IFSC, PF/metro · AE: nationality, Emirates ID, passport, visa, labour card, MOHRE person ID, IBAN, routing code, monthly basic/housing/transport/other)<br>➕ **document expiry alerts** (passport, visa, Emirates ID within 60 days) on profile and directory<br>➕ **recruitment / ATS** (openings → candidate kanban → hire creates the employee)<br>➕ **performance** (goals with on-track status, review cycles with self + manager review)<br>➕ **expense claims** (employee submits → manager approves → reimbursed via payroll or paid directly)<br>➕ workspace **weekend** respected by leave and attendance · leave **pay %** (half-pay sick leave) |
| **Payroll** | Keka, RazorpayX Payroll, greytHR, Bayzat, Zoho Payroll UAE | ✅ runs draft→approved→paid · LOP from attendance · India PF/ESI/PT/TDS · payslips<br>➕ **country engines** behind one breakdown format: India (unchanged maths) and **UAE** (no income tax, GPSSA for UAE nationals, monthly **gratuity accrual** for expats)<br>➕ **WPS SIF file** download for approved UAE runs, with ID/IBAN validation<br>➕ **loans & salary advances** (ledger posting, monthly recovery in payroll)<br>➕ **claim reimbursements** paid through payroll<br>➕ **full & final settlement** (pending salary, leave encashment, gratuity for both countries, loan recovery, printable statement) |
| **CRM** | Zoho CRM, HubSpot, Freshsales | ✅ companies · contacts · pipeline · activities · forecast · won-deal automation<br>➕ **quotes** with per-line GST/VAT → printable quotation → **convert to invoice** (needs Finance)<br>➕ **web-to-lead form** at `/forms/<workspace>` with bot trap and rate limit |
| **Finance** | Zoho Books, Tally, QuickBooks, Xero | ✅ invoices · payments · expenses & bills · double-entry ledger · P&L · balance sheet · trial balance · AR aging · journals<br>➕ **country tax**: India GST (CGST+SGST intra-state / IGST inter-state, GSTIN) and **UAE VAT** (5 % standard, zero-rated, exempt, TRN, emirate place of supply)<br>➕ **tax return report**: GSTR-3B-style summary (IN) / VAT 201-style by emirate (AE) + **UAE corporate tax estimate**<br>➕ **credit notes** (optional restock) and **refunds**<br>➕ **recurring invoices** · **bank reconciliation** (CSV import, auto/manual matching)<br>➕ fiscal year follows the workspace (Apr–Mar IN, Jan–Dec AE) |
| **Inventory** | Zoho Inventory, Odoo, Tally | ✅ multi-warehouse · weighted-average cost · transfers/adjustments · POs · receive → bill · reorder planner<br>➕ **stock counts** with variance posting · warehouse limit per plan · country tax on products/vendors/POs |
| **Projects** | Asana, Zoho Projects, ClickUp | ✅ boards · list · Gantt · milestones · timesheets · profitability · bill hours → invoice<br>➕ billing time is blocked with an explanation when Finance is off |
| **Helpdesk** | Freshdesk, Zoho Desk | ✅ SLA timers · internal notes · canned replies · KB · customer portal · CSAT<br>➕ public portal only served when the plan includes it and Helpdesk is on |
| **Workspace** | — | ➕ **audit log** (Enterprise): filter by module, user, date and text; CSV export |

### Added after the audit
➕ Employee document vault (uploads up to 4 MB, stored in the database, on the employee profile and in My space) · ➕ asset management (`/app/hrm/assets`, assignment history, warranty insights) · ➕ CSV import for companies, contacts and products · ➕ customer statements (`/app/finance/statements`) · ➕ helpdesk round-robin assignment (Helpdesk → Settings) · ➕ automatic recurring invoices (daily Vercel Cron at `/api/cron/recurring-invoices`).

### Launch round (greytHR / Zoho People parity)
➕ Transactional email via Resend (invites, welcome, password reset, leave/claim/attendance notifications) · ➕ forgot/reset/change password, with all other sessions revoked on change · ➕ reporting managers approve their direct reports' leave and attendance corrections from My space · ➕ attendance regularisation requests · ➕ bulk employee CSV import and one-click / bulk "Invite to portal" · ➕ company announcements (overview, My space, optional email) · ➕ HR letters (offer, appointment, experience, relieving, salary certificate, NOC) with numbered, printable copies visible to the employee · ➕ India PF ECR 2.0 file, ESIC contribution file, and annual salary & TDS statement (Form 16 Part B style, reference only).

### Integrations and AI
➕ Ask AI (`/app/ask`): read-only, role-checked tools over workspace data, with an OpenAI-compatible LLM (Gemini by default) or a built-in rules fallback · ➕ signed outgoing webhooks for Zapier, Make, n8n and custom servers, with retries and a delivery log · ➕ Slack, Microsoft Teams and Google Chat channel alerts · ➕ REST API v1 with scoped API keys and an OpenAPI spec · ➕ iCal feeds for Google, Outlook and Apple Calendar · ➕ Razorpay payment links on invoices, recorded automatically via signed webhook, shareable by email or WhatsApp · ➕ Sign in with Google and Microsoft.

### Not built yet
Abu Dhabi (ADPF) and GCC-national pension schemes · shifts and rosters, biometric device sync · investment declarations and the India old tax regime · official Form 16 (issued via TRACES) · surveys · native mobile apps · multi-currency, manufacturing, consolidation, e-invoicing (IRN/e-way bill).

## 2. Module choice and plans

Workspaces **choose their modules** (Settings → Modules). A disabled module disappears from navigation; its pages, server actions and exports are blocked; automations that would write into it are skipped; cross-module buttons (e.g. "Convert to invoice", "Bill hours") explain why they're unavailable. Data is kept, so re-enabling restores everything.

| | **Starter** | **Growth** | **Enterprise** |
| --- | --- | --- | --- |
| Modules | **Pick any 3** of HRM, CRM, Finance, Inventory, Projects, Helpdesk | All 8, including **Payroll & Analytics** | All 8 |
| Users | up to 25 | unlimited | unlimited |
| Cross-module workflow automations | core only (e.g. invoice → stock) | ✅ | ✅ |
| Recruitment, performance, expense claims | — | ✅ | ✅ |
| Quotes, stock counts, CSV exports | ✅ | ✅ | ✅ |
| Web-to-lead forms | — | ✅ | ✅ |
| Recurring invoices, bank reconciliation | — | ✅ | ✅ |
| Warehouses | 1 | 5 | unlimited |
| Customer support portal + public KB | — | ✅ | ✅ |
| Audit log | — | — | ✅ |
| Workspaces per owner | 1 | 3 | unlimited |

The free trial runs on **Growth**. Entitlements live in `src/lib/plans.ts`; `requireWorkspace({ module, feature })` in `src/lib/tenancy.ts` guards pages and actions, and `src/lib/entitlements.ts` covers public routes (support portal, web forms).

## 3. Countries

A workspace has one **country**, chosen at sign-up (auto-detected from the phone prefix +91 / +971) and fixed afterwards. The country sets:

| | 🇮🇳 India (`IN`) | 🇦🇪 United Arab Emirates (`AE`) |
| --- | --- | --- |
| Currency / format | INR, en-IN (lakh/crore) | AED, en-AE (fils) |
| Phone | +91 10-digit mobile | +971 mobile or landline |
| Regions | states + UTs | 7 emirates |
| Fiscal year | Apr–Mar | Jan–Dec |
| Weekend (default, editable) | Sat–Sun | Sat–Sun |
| Indirect tax | GST; CGST+SGST intra-state, IGST inter-state; GSTIN | VAT 5 % standard, 0 % zero-rated, exempt; TRN (15 digits) |
| Return report | GSTR-3B-style summary | VAT 201-style, standard-rated supplies by emirate |
| Corporate tax | — | 9 % above AED 375,000 (estimate) |
| Salary structure | Basic 50 %, HRA 40/50 %, Special | Basic/Housing/Transport/Other per employee (default 60/25/10/5 %) |
| Statutory deductions | PF 12 % (₹15k wage cap), ESI 0.75/3.25 % (≤ ₹21k), PT ₹200, TDS (new regime FY 2025-26) | No income tax. GPSSA for UAE nationals (Decree-Law 57/2023): 11 % employee; employer 12.5 %, or 15 % at AED 20,000+; full contract salary bounded AED 3,000–70,000 |
| End of service | Gratuity Act: 15/26 × basic × years after 5 years, ₹20 lakh cap (at settlement) | Art. 51: 21 days' basic/yr for 5 years, 30 days after, 1-year minimum, 2-year cap; accrued monthly as a provision (expats only) |
| Salary transfer file | Bank transfer CSV | **WPS SIF** (EDR per employee + SCR) |
| Workspace statutory IDs | TAN, EPF, ESIC codes | MOHRE establishment ID, WPS routing code, trade licence |

All country rules live in `src/lib/countries/`, `src/lib/payroll.ts` (IN) and `src/lib/payroll-ae.ts` (AE).

### Compliance caveats
Calculations follow the rules above and are covered by tests, but they are **estimates for review, not filed returns or legal advice**. Islamic holiday dates are tentative. ADPF/GCC pension schemes, UAE reverse charge/tourist refunds, and India's old tax regime aren't modelled. Have a local accountant validate the figures before production use.

## 4. Verification

- `npm test` — unit tests for both payroll engines, gratuity, WPS SIF, settlements, plans/automations, finance tax returns and bank matching, CRM quotes, HRM validation and people workflows.
- `npm run smoke` — creates an India and a UAE workspace on a throwaway DB copy, checks country defaults, runs payroll with a claim and an advance through payment, and asserts the ledger balances with payables matching payslips.
- Browser check (UAE): sign-up with +971 picks UAE/AED; settings show emirate/TRN/MOHRE/WPS fields; employee form shows UAE fields with visa-expiry warning; payroll run shows GPSSA and gratuity correctly.
- Stripe billing was deliberately not exercised in this audit.
