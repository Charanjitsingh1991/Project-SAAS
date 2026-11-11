# saasmodels.tech

Marketing site **and** multi-tenant SaaS app for saasmodels.tech: HRM, CRM, Finance, Inventory, Payroll, Projects, Helpdesk and Analytics in one workspace, with company accounts, roles, a 14-day card-free trial and Stripe billing.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Actions, Cache Components), React 19, TypeScript |
| Styling / motion | Tailwind CSS v4 (light "paper & ink" theme), Motion (`motion/react`), Lenis |
| Database | Drizzle ORM + libSQL (local SQLite file in dev, Turso in production) |
| Auth | Email + password (bcrypt), signed JWT in an httpOnly cookie (`jose`), `proxy.ts` route guard |
| Payments | Stripe Checkout (per-seat subscriptions), Customer Portal, webhooks |

## Getting started

```bash
npm install
cp .env.example .env.local     # set SESSION_SECRET and ADMIN_EMAILS at minimum
npm run db:push                # creates all tables in ./local.db
npm run dev                    # http://localhost:3000
```

## How it works

### Sign-up → workspace → trial
1. `/signup` creates the user and emails a 6-digit code (`/verify-email`). Entering it creates the company workspace (they become its **Owner**). Until then the account can't open `/app` or `/admin`. Invite links, password-reset links and Google/Microsoft sign-in count as verified.
   - Abuse limits: 5 sign-ups per IP per hour, log-in paused after 8 failed attempts per email (30 per IP) in 15 minutes, a hidden honeypot field, and common throwaway-email domains are refused. Codes expire after 10 minutes and allow 5 tries.
   - The nightly `/api/cron/webhooks` job deletes unverified sign-ups older than 7 days.
2. The 14-day trial starts immediately, with no card. Day 1 is the sign-up date in `APP_TIMEZONE`.
3. From **00:00 on day 14**, everyone in the workspace sees a red banner: add a payment method, or services will be disabled.
4. At **00:00 on day 15**, an unpaid workspace is **deactivated**. Every module redirects to `/app/billing`, but data is kept.
5. Adding a card through Stripe Checkout reactivates the workspace instantly. Paying early keeps the remaining free days, and Stripe charges when the trial ends.

The logic lives in `src/lib/trial.ts` (`accessFor`) and is enforced by `requireWorkspace()` in `src/lib/tenancy.ts` on every page and server action.

### Roles
Owners and admins invite people from **Team & roles** (`/app/team`). Each invite gets a link that is valid for 7 days, and the invitee creates an account and joins the workspace.

| Role | Modules |
| --- | --- |
| Owner / Admin | Everything + team + billing |
| HR | People, Payroll, Projects |
| Sales | CRM, Helpdesk, Inventory, Projects |
| Finance | Finance, Payroll, Inventory, Analytics |
| Employee | Projects, Helpdesk |

Plans: **Starter** includes HRM, CRM and Projects. **Growth** includes everything. Trials get everything. The configuration is in `src/lib/roles.ts`.

### Modules (`/app/*`)
The full functional blueprint for every module is in **[`docs/MODULES.md`](docs/MODULES.md)** and the engineering conventions in **[`docs/ENGINEERING.md`](docs/ENGINEERING.md)**.

- **HRM** — employee profiles, departments, org chart, leave with balances and approvals, attendance register, holidays, onboarding/offboarding, and **My space** self-service for every employee.
- **Payroll** — monthly runs from CTC with loss-of-pay, PF, ESI, PT and TDS (new regime), draft → approved → paid, printable payslips, statutory summary and bank-transfer CSV.
- **CRM** — companies (360° view), contacts, drag-and-drop pipeline, activities and follow-ups, forecast and lead scoring.
- **Finance** — GST invoices with line items (CGST/SGST vs IGST), payments, expenses and vendor bills, a double-entry ledger, P&L, balance sheet, trial balance, AR aging, GST summary and manual journals.
- **Inventory** — multi-warehouse stock, weighted-average costing, transfers and adjustments, purchase orders, a reorder planner and stock-out forecast.
- **Projects** — boards, list, Gantt timeline, milestones, timesheets, profitability, and billing hours to invoices.
- **Helpdesk** — tickets with SLA timers, internal notes, canned replies, knowledge base, and a public customer portal at `/support/<workspace>` with CSAT.
- **Analytics** — cross-module dashboard plus a rule-based insights feed.

**Built-in automations** (toggle under Settings):
- won deal → draft invoice + project
- invoice sent → ledger + stock issue
- PO received → stock + vendor bill
- payroll paid → salary journal
- approved leave → attendance → loss-of-pay

Press **⌘K** anywhere to search every module. New workspaces can click **Load sample data** to get a fully connected demo company.

### Platform admin (`/admin`)
Only for emails listed in `ADMIN_EMAILS`:
- **Workspaces:** status (trial day, paying, deactivated), card on file, and buttons to **extend a trial by 7 days** or end it.
- **Users:** every sign-up and the workspaces they belong to.
- **Enquiries:** contact-form messages, which you can mark *new*, *contacted* or *closed*.

## Connecting Stripe
1. Set `STRIPE_SECRET_KEY`. On the first checkout the app creates the **Starter** and **Growth** products with monthly and yearly per-seat USD prices (lookup keys `saasmodels_<plan>_<month|year>`), using the display prices in `PLAN_PRICES` in `src/lib/stripe.ts`. To use prices you made yourself, set the four `STRIPE_PRICE_*` IDs instead.
2. To change a price later, create a new price in Stripe and move the lookup key to it (tick "Transfer lookup key"); existing subscribers keep their old price.
3. Add a webhook endpoint `https://saasmodels.tech/api/stripe/webhook` with these events:
   - `checkout.session.completed`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - `invoice.paid`, `invoice.payment_failed`
   - `customer.updated`

   Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Enable the **Customer Portal** (Settings → Billing → Customer portal) so owners can change card or plan, download invoices, or cancel.

For local testing, run `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

Once connected:
- The card brand, last 4 digits and expiry are shown on the billing page.
- The seat count follows the number of members.
- `past_due` shows a warning but keeps access.
- A cancelled subscription deactivates the workspace after the period ends.

## Production (Vercel + Turso)
1. **Database.** Either install **Turso** from the Vercel Marketplace (Storage → Create → Turso), which adds `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the project, or create a database at turso.tech and add `DATABASE_URL` + `DATABASE_AUTH_TOKEN` yourself. Both naming styles work.
2. **Tables.** Nothing to run by hand: `npm run build` first runs `scripts/migrate.mjs`, which applies the SQL migrations in `drizzle/` to the database on every deploy. To move existing local data instead, see `turso db import`.
3. In Vercel, import the GitHub repository (framework preset: Next.js). Under **Settings → Environment Variables**, set:
   - `SESSION_SECRET` (`openssl rand -base64 32`)
   - `CRON_SECRET` (any random string; Vercel Cron sends it to `/api/cron/recurring-invoices`)
   - `ADMIN_EMAILS`, `APP_TIMEZONE`, `APP_URL` (your production URL)
   - `RESEND_API_KEY` and `EMAIL_FROM` for email (invites, password reset, notifications). Verify your sending domain in Resend first.
   - `ENCRYPTION_KEY` (32+ random characters, set once and never change; encrypts stored webhook URLs and Razorpay keys)
   - optional: `AI_API_KEY` for Ask AI (a free Google Gemini key from aistudio.google.com works; without it Ask AI uses built-in rules)
   - optional: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` for social sign-in (redirect URIs `<APP_URL>/api/auth/google/callback` and `<APP_URL>/api/auth/microsoft/callback`)
   - optional: the `STRIPE_*` variables (billing pages work in trial mode without them)
4. Deploy. `vercel.json` schedules the daily recurring-invoice run at 00:30 UTC. A deployment without a database fails with a clear error, because Vercel can't keep a local SQLite file.

After changing `src/db/schema.ts`, run `npm run db:generate` and commit the new file in `drizzle/`.

`npm run db:studio` opens Drizzle Studio for browsing data.
