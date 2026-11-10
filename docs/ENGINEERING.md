# Engineering conventions (saas.tech app)

Read this before changing any module. The product spec is in `docs/MODULES.md`.

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
