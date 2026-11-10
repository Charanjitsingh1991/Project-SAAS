/**
 * Database connection settings, shared by the app, drizzle-kit and the migration script.
 * Accepts DATABASE_URL/DATABASE_AUTH_TOKEN, or the TURSO_DATABASE_URL/TURSO_AUTH_TOKEN names
 * that the Turso integration on the Vercel Marketplace uses.
 */
export function databaseConfig() {
  const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
  // Vercel's filesystem is read-only and ephemeral, so a local SQLite file can't work there.
  if (process.env.VERCEL && !url) {
    throw new Error(
      "No database configured. Set DATABASE_URL (libsql://…) and DATABASE_AUTH_TOKEN, or connect Turso from the Vercel Marketplace, in Vercel → Settings → Environment Variables.",
    );
  }
  return { url: url || "file:local.db", authToken: authToken || undefined };
}
