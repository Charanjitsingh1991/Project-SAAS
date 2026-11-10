# saas.tech — Marketing site + auth backend

Next.js 16 (App Router) site for **saas.tech**, an all-in-one HRM / CRM / Finance / Inventory / Payroll platform.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Actions, Cache Components), React 19, TypeScript |
| Styling | Tailwind CSS v4, custom light "paper & ink" theme |
| Motion | [Motion](https://motion.dev) (`motion/react`, the successor of Framer Motion), Lenis smooth scroll |
| Icons / fonts | lucide-react · Bricolage Grotesque, Instrument Serif, Geist, JetBrains Mono via `next/font` |
| Database | Drizzle ORM + libSQL (local SQLite file in dev, Turso in production) |
| Auth | Email + password, bcrypt hashes, signed JWT in an httpOnly cookie (`jose`), `proxy.ts` route guard |
| Validation | Zod |

## Getting started

```bash
npm install
cp .env.example .env.local            # then set SESSION_SECRET (openssl rand -base64 32)
npm run db:push                       # creates tables in ./local.db
npm run dev                           # http://localhost:3000
```

## Features

- **Landing page**: kinetic hero with draggable module stickers, a velocity-reactive marquee, a scroll scene where nine scattered tools collapse into one platform, a pinned horizontal module scroller, a live-typing Copilot demo, counters, swipeable testimonials, pricing with an animated toggle, FAQ, and a footer wordmark reveal.
- **Sign up / Log in** (`/signup`, `/login`): server-side validation, duplicate-email check, generic error on bad credentials, 7-day session cookie.
- **Dashboard** (`/dashboard`): protected route showing the account and any enquiries sent from the user's email.
- **Contact form**: stores enquiries (name, email, company, team size, modules of interest, message, status) in the `enquiries` table. Includes a honeypot field for spam.

## Database

Schema lives in `src/db/schema.ts` (`users`, `enquiries`).

- `npm run db:push` applies the schema.
- `npm run db:studio` opens Drizzle Studio to browse users and enquiries.

**Production:** create a Turso database, then set `DATABASE_URL=libsql://…` and `DATABASE_AUTH_TOKEN` in your host's environment along with `SESSION_SECRET`. Run `npm run db:push` once against it.

## Project layout

```
src/
  app/            routes (/, /login, /signup, /dashboard) + server actions
  components/     nav, logo, auth form, sections/*, ui/* (motion primitives)
  db/             Drizzle client + schema
  lib/            session (jwt, cookies), data-access layer, zod schemas
  proxy.ts        redirects for /dashboard and auth pages
```
