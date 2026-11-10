import "server-only";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Local SQLite file in development; set DATABASE_URL (+ DATABASE_AUTH_TOKEN) to a Turso/libSQL URL in production.
// Vercel's filesystem is read-only and ephemeral, so a local SQLite file can't work there.
if (process.env.VERCEL && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add your Turso URL (libsql://…) and DATABASE_AUTH_TOKEN in Vercel → Settings → Environment Variables.");
}

const client = createClient({
  url: process.env.DATABASE_URL ?? "file:local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
export { schema };
