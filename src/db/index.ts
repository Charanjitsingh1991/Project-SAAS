import "server-only";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { databaseConfig } from "./config";
import * as schema from "./schema";

// Local SQLite file in development; a Turso/libSQL URL in production (see ./config).
const client = createClient(databaseConfig());

export const db = drizzle(client, { schema });
export { schema };
