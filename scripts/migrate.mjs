// Applies pending SQL migrations from ./drizzle to the configured database.
// Runs automatically before `next build` (see package.json). It is a no-op for the local
// SQLite file unless MIGRATE_LOCAL=1, because local development uses `npm run db:push`.
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined;
const migrationsFolder = "./drizzle";

if (!url) {
  if (process.env.VERCEL) {
    console.error(
      "\n✖ No database configured. Set DATABASE_URL and DATABASE_AUTH_TOKEN (from Turso), or connect Turso from the Vercel Marketplace, then redeploy.\n",
    );
    process.exit(1);
  }
  console.log("migrate: no DATABASE_URL, skipping (local development uses `npm run db:push`).");
  process.exit(0);
}
if (url.startsWith("file:") && process.env.MIGRATE_LOCAL !== "1") {
  console.log(`migrate: ${url} is a local file, skipping (set MIGRATE_LOCAL=1 to force).`);
  process.exit(0);
}

const client = createClient({ url, authToken });
const db = drizzle(client);

const tables = async () =>
  new Set((await client.execute("select name from sqlite_master where type = 'table'")).rows.map((r) => String(r.name)));

try {
  const existing = await tables();
  // A database created earlier with `drizzle-kit push` already has the tables but no migration history.
  // Record the current migrations as applied instead of failing on CREATE TABLE.
  if (existing.has("users") && !existing.has("__drizzle_migrations")) {
    const files = readMigrationFiles({ migrationsFolder });
    await client.execute('CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    for (const m of files) {
      await client.execute({ sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)', args: [m.hash, m.folderMillis] });
    }
    console.log(`migrate: existing schema found without history; baselined ${files.length} migration(s). Check it matches with \`npm run db:push\` locally if unsure.`);
  }
  await migrate(db, { migrationsFolder });
  console.log("migrate: database is up to date.");
} catch (e) {
  console.error("migrate: failed.", e);
  process.exit(1);
} finally {
  client.close();
}
