import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { SESSION_COOKIE, decrypt } from "./jwt";

/** Returns a narrow user object for the current session, or null. */
export async function getCurrentUser() {
  const session = await decrypt((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session?.userId) return null;

  const [user] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      company: schema.users.company,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);

  return user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
