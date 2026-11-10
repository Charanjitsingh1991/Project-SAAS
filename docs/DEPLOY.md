# Deploying saasmodels.tech (Vercel + Turso)

The app runs on **Vercel** with a **Turso** database (hosted SQLite). The code already supports Turso — no code changes are needed, only settings.

## 1. Create the Turso database

You can do this from the Turso website or from the command line. Pick one.

### Option A — website (no installs)
1. Sign in at **app.turso.tech** → **Create database**. Name it `saasmodels` and pick the location closest to your users (for India/UAE, Mumbai or the nearest one offered).
2. Open the database and copy its **URL** — it looks like `libsql://saasmodels-<your-org>.turso.io`.
3. Create a **token** with read & write access and no expiry, and copy it. Treat it like a password.
4. Create the tables: from this repository on your computer run

   ```bash
   npm install
   DATABASE_URL="libsql://saasmodels-<your-org>.turso.io" DATABASE_AUTH_TOKEN="<token>" npm run db:push
   ```

   (Windows PowerShell: `$env:DATABASE_URL="…"; $env:DATABASE_AUTH_TOKEN="…"; npm run db:push`.)

### Option B — Turso CLI
```bash
# install: macOS
brew install tursodatabase/tap/turso
# or macOS/Linux (Windows: inside WSL)
curl -sSfL https://get.tur.so/install.sh | bash

turso auth login
turso db create saasmodels
turso db shell saasmodels < drizzle/0000_init.sql   # creates every table
turso db show saasmodels --url                       # → DATABASE_URL
turso db tokens create saasmodels                    # → DATABASE_AUTH_TOKEN (full access, never expires)
```

`drizzle/0000_init.sql` is the complete schema (all 74 tables). Start with an **empty** database — don't upload a local test database; customers create their own workspaces after sign-up.

> Later schema changes: run `npm run db:push` with the two variables above. It only applies the differences.

## 2. Deploy on Vercel
1. **vercel.com → Add New → Project →** import the GitHub repo `Charanjitsingh1991/Project-SAAS`. Framework: Next.js (auto-detected). No build settings to change.
2. **Settings → Environment Variables** (Production; add to Preview too if you use preview deployments):

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Turso URL (`libsql://…turso.io`) |
| `DATABASE_AUTH_TOKEN` | ✅ | Turso token |
| `SESSION_SECRET` | ✅ | random 32+ characters (`openssl rand -base64 32`) |
| `APP_URL` | ✅ | `https://saasmodels.tech` |
| `ADMIN_EMAILS` | ✅ | your email(s), comma-separated — opens `/admin` |
| `APP_TIMEZONE` | ✅ | `Asia/Kolkata` (trial days are counted in this zone) |
| `CRON_SECRET` | ✅ | random 32+ characters — protects the daily automation job |
| `RESEND_API_KEY` | for email | from resend.com (free tier available) |
| `EMAIL_FROM` | for email | e.g. `saasmodels.tech <no-reply@saasmodels.tech>` — the domain must be verified in Resend |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | enables "Continue with Google" (redirect URI `https://saasmodels.tech/api/auth/google/callback`) |
| `STRIPE_*` | later | see README → Connecting Stripe |

   If you connect Turso through **Vercel → Storage / Marketplace → Turso** instead, it sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; the app accepts those names too.
3. **Deploy.** Then **Settings → Domains → add `saasmodels.tech`** (and `www`), and create the DNS records Vercel shows at your domain registrar.
4. **Settings → Functions → Region:** choose the region closest to your Turso database (e.g. Mumbai, `bom1`) — every page talks to the database, so keeping them together makes the app noticeably faster.
5. The **daily automation** (recurring invoices, document-expiry reminders, overdue digests, trial reminders) is declared in `vercel.json` and runs once a day automatically once `CRON_SECRET` is set.

## 3. Email (Resend)
Without email settings the app still works, but invite links must be copied and sent by hand, and password resets can't be emailed. To turn email on:
1. Create a Resend account → **Domains → Add `saasmodels.tech`** → add the DNS records it shows (SPF/DKIM) at your registrar → wait for "Verified".
2. Create an API key → set `RESEND_API_KEY` and `EMAIL_FROM` on Vercel → redeploy.

## 4. After the first deploy
1. Open `https://saasmodels.tech/signup` and create your own account with the email in `ADMIN_EMAILS` → you get `/admin` (all workspaces, users, enquiries).
2. Each customer company signs up at `/signup`; the phone number picks India or UAE. They invite their staff from **Team & roles** or **HRM → Invite to employee portal**; employees sign in at `/login` and land in **My space**.

## Notes and limits
- **Vercel Hobby (free)** is intended for personal, non-commercial projects; plan to move to Pro once you start charging customers. Hobby cron jobs run once a day (±59 min).
- **Turso free tier** has storage and monthly read/write limits — check app.turso.tech → Usage and upgrade before you hit them. Uploaded documents are stored in the database (5 MB per file).
- **Backups:** Turso keeps point-in-time history depending on plan; you can also take a manual dump any time with `turso db shell saasmodels .dump > backup.sql`.
