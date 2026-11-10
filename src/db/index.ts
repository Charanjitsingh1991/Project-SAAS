import "server-only";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Local SQLite file in development. In production point at Turso: DATABASE_URL/DATABASE_AUTH_TOKEN,
// or the TURSO_* names the Vercel × Turso integration sets automatically.
const client = createClient({
  url: process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? "file:local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
export { schema };
