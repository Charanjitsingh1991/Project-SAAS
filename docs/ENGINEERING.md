# Engineering conventions (saas.tech app)

Read this before changing any module. The product spec is in `docs/MODULES.md`; the competitive audit, plans and country rules are in `docs/AUDIT_PLANS_COUNTRIES.md`.

## Countries (India `IN`, UAE `AE`) — never hard-code a country
- `const pack = packOf(ws.org)` (from `@/lib/countries`) — or `packFor(ws)` from tenancy — gives currency, regions (`pack.regionLabel`, `pack.regions`), tax (`pack.tax.name` GST/VAT, `pack.tax.idLabel` GSTIN/TRN, `pack.tax.idPattern`, `pack.tax.rates` with `code/rate/label/kind`, `pack.tax.defaultCode`, `pack.tax.split(taxAmount, rate, placeOfSupply, orgRegion)` → display lines CGST+SGST / IGST / VAT), `pack.tax.invoiceTitle`, `pack.corporateTax` (AE), statutory org fields, HR field defs (`pack.hr.employeeFields` → which `employees` columns to show + validation regex), default leave types and holidays, payroll component labels, `pack.payroll.statutoryNote`.
- Helpers: `taxOption(pack, code, rate)`, `defaultTaxRate(pack)`, `weekendOf(org)` (array of weekday numbers, 0=Sun), `statutoryOf(org)`, `fiscalYearFor(ymd, org.fiscalYearStart)`, `NATIONALITIES`, `nationalityName()`, `countryFromPhone()`, `isValidPhone()`.
- Currency: always `ws.org.currency` (INR or AED). Never show ₹, "GST", "GSTIN", "PAN", "state" etc. as literals — use the pack. Amount in words: `amountInWords(minor, currency)`.
- Tax-id columns are still named `gstin` / `customerGstin` in the DB but hold the GSTIN **or TRN** (label with `pack.tax.idLabel`). `state` / `placeOfSupply` hold a state **or emirate**.
- Invoice/quote/credit-note lines carry `taxCode` (e.g. `SR`/`ZR`/`EX` or `GST18`/`EXEMPT`). VAT returns use the code's `kind`.
- Weekends: never assume Sat/Sun — use `weekendOf(ws.org)`.
- Fiscal year: `ws.org.fiscalYearStart` (IN default 4 = April, AE default 1 = January).

## Plans & modules
- `src/lib/plans.ts`: Starter (any 3 core modules, 25 users, 1 warehouse), Growth (all modules + features), Enterprise (+ audit log). Trials run on Growth.
- `canUseModule(ws, key)` already includes the owner's module selection. Gate premium features with `requireWorkspace({ module, feature: "recruitment" })` on pages/actions, and `hasFeature(ws, "…")` to hide buttons/links. Features: automations, recruitment, performance, expenseClaims, webForms, recurringInvoices, bankReconciliation, supportPortal, auditLog.
- Links into another module must check `canUseModule(ws, thatModule)` before rendering (a disabled module is invisible).
- Limits: `planOf(ws).maxWarehouses`, `.maxUsers`.

## Posting engine additions (`src/lib/posting.ts`)
- Expense claims: `approveClaim(ctx, claimId, date?)`.
- Loans: `disburseLoan(ctx, loanId)`.
- Final settlement: `paySettlement(ctx, settlementId, date)`.
- Credit notes: `issueCreditNote(ctx, invoiceId, { date, reason, restock, lines: [{ invoiceLineId, quantity }] })` and `refundCustomer(...)`.
- Recurring invoices: `generateRecurringInvoice(ctx, id, { force })` and `runDueRecurring(ctx)` (call lazily on Finance page load).
- Quotes: `convertQuoteToInvoice(ctx, quoteId)`.
- Stock counts: `completeStockCount(ctx, countId)`.
- Payroll: `markPayrollPaid` now posts from each payslip's `breakdown` JSON (`src/lib/payroll-types.ts`). It marks claims linked by `payslipId` reimbursed and reduces loan balances by `payslip.loanDeduction`.
- Invoice balance due = `total − amountPaid − amountCredited`.
- `moveStock` posts opening/adjustment/issue movements to the ledger automatically. Pass `post: false` only when a document posts the value itself.
- Shared CSV parser: `parseCsv()` in `src/lib/csv.ts`.

## Stack facts
- **Framework:** Next.js 16 App Router, with `cacheComponents: true`. This version differs from older Next.js; the docs are in `node_modules/next/dist/docs/`.
  - `params` / `searchParams` are Promises, e.g. `PageProps<"/app/crm/[id]">`. Run `npx next typegen` to generate the global `PageProps` / `LayoutProps` types for new routes.
  - Read request data (cookies, searchParams, DB queries) only inside async server components rendered under a `<Suspense>`. The `/app` layout already wraps every page in Suspense.
  - **Never** use `new Date()` / `Date.now()` in a *client* component's render, and never at module top level. Do it in server components or event handlers.
  - After a mutation in a server action, call `refresh()` from `next/cache` to re-render; `redirect()` comes from `next/navigation`.
  - Files with `"use server"` may only export async functions. `page.tsx` may only export `default`, `metadata` and route config.
- **Libraries:** React 19, TypeScript strict, Tailwind v4, zod v4, Drizzle ORM on libSQL/SQLite, and lucide-react icons.
  - zod v4: use `z.email()`, `z.coerce.number()`, and `z.flattenError(e).fieldErrors`.
  - Drizzle: use `db.$count(table, where)`; use `sql<number>` for aggregates and wrap them in `Number()`, because SQLite may return strings.
- **No new npm dependencies.**

## Data rules
- **Multi-tenancy:** every query filters `eq(table.orgId, ws.org.id)`, and every insert sets `orgId`. Any foreign id coming from a form must be checked to belong to the same org before use. A detail page whose id is from another org → `notFound()`.
- **Money:** INTEGER **minor units**, from `src/lib/money.ts`.
  - Parse form input with `toMinor()`, display with `formatMoney(minor, ws.org.currency)` (or `formatMoneyCompact` for KPI tiles), and pre-fill inputs with `fromMinor()`.
  - Compute tax with `taxOf(amount, rate)`.
- **Dates:** calendar dates are `"YYYY-MM-DD"` strings. Use `todayYmd()`, `addDaysYmd()`, `daysBetween()` and `formatDate()` from `src/lib/format.ts`.
- **Document numbers:** `nextNumber(orgId, "invoice" | "po" | "ticket" | "employee" | "project")` from `src/lib/sequence.ts`.
- **Cross-module money and stock events MUST go through `src/lib/posting.ts`:**
  - Invoices: `createDraftInvoice`, `saveInvoiceLines`, `sendInvoice`, `voidInvoice`.
  - Payments: `recordPayment`, `deletePayment`.
  - Expenses and bills: `createExpense`, `payBill`, `deleteExpense`.
  - Payroll: `markPayrollPaid`.
  - Purchasing: `receivePurchaseOrder`.
  - CRM: `onDealWon`.
  - Projects: `invoiceProjectTime`.
  - Stock changes go through `moveStock()` in `src/lib/stock.ts`.
  - Manual journals go through `postJournal()` in `src/lib/ledger.ts`.
  - Never write `journal_*`, `stock_levels` or invoice totals directly.
- **Automation toggles:** `automationsFor(orgId)` in posting.ts, or `parseAutomations(org.automations)` in `src/lib/automations.ts`.
- **Activity log:** call `logActivity(ctxOf(ws), { module, entityType, entityId, action, summary })` from `src/lib/activity.ts` after meaningful mutations. Summaries are plain sentences, e.g. "Approved leave for Priya Sharma".

## Auth and access
- **Every page and every action** starts with `const ws = await requireWorkspace({ module: "<key>" })` from `src/lib/tenancy.ts`.
  - It returns `ws.user`, `ws.org` (incl. `currency`, `state`, `slug`), `ws.role` and `ws.access`.
  - Use `{ manage: true }` for owner/admin-only settings.
  - `canUseModule(ws, key)` and `canManage(ws.role)` are available.
- Module keys are `hrm`, `payroll`, `crm`, `finance`, `inventory`, `projects`, `helpdesk`, `analytics`. Role access is in `src/lib/roles.ts`.

## UI kit (reuse; keep the light "paper & ink" look)
- `src/components/app/ui.tsx`:
  - `PageHeader` (title, description, actions, tabs), `Card`, `Stat`, `Badge`
  - `StatusBadge` (colours for every status in `STATUS_TONE`), `EmptyState`, `Table` / `Th` / `Td`
- `src/components/app/forms.tsx`:
  - `ActionForm` for `(prev: FormState, fd: FormData) => Promise<FormState>` actions. It shows field errors from `{ errors }` and a message, and resets on `{ ok: true }`.
  - Inputs: `Input`, `Select`, `Textarea`.
  - Buttons: `SubmitButton`, `StatusSelect` (auto-submitting inline select, hidden `id` + `status`/custom `name`), `ActionButton` (void action with hidden fields + optional confirm).
- `src/components/app/kanban.tsx`: `Kanban` drag-and-drop board with optimistic moves. Give each card a `StatusSelect` too, for keyboard and touch users.
- **Tones:** mint, butter, sky, peach, lilac, rose, lime, ink, signal.
- **Typography:** `font-display` headings, `font-mono` uppercase micro-labels, `text-ink-soft` / `text-ink-mute` secondary text.
- **Printable pages** use `print:hidden` on chrome. The app sidebar is hidden in print.
- **CSV export:** link to `/api/export/<entity>` (for example `employees`, `invoices`). It is implemented centrally.

## Seeds
Each module owns `src/lib/seed/<module>.ts` exporting `seed<Module>(ctx)`. Seeds run in this order: hrm → crm → inventory → finance → projects → payroll → helpdesk. Later seeds read earlier data from the DB. Seeds must use the same posting functions as the UI, so the ledger, stock and totals are consistent.

## Verifying your work
- Run `npx next typegen && npx tsc --noEmit` and `npx eslint <your paths>`; both must be clean for your files.
- Do not run `next build` / `next dev` / `npm install` / `db:push` / git. The integrator runs the app and the end-to-end tests.
- Use the **Write/Edit tools** to create files; shell heredocs may be blocked.
