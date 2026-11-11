import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { SESSION_COOKIE, decrypt } from "./jwt";

/** The signed-in user whether or not their email is verified. Only the verify-email flow should use this directly. */
export const getSessionUser = cache(async () => {
  const session = await decrypt((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session?.userId) return null;

  const [user] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      company: schema.users.company,
      phone: schema.users.phone,
      createdAt: schema.users.createdAt,
      passwordChangedAt: schema.users.passwordChangedAt,
      emailVerifiedAt: schema.users.emailVerifiedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);

  if (!user) return null;
  // A password change revokes every session issued before it.
  if (user.passwordChangedAt && (session.iat ?? 0) < Math.floor(user.passwordChangedAt.getTime() / 1000)) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    company: user.company,
    phone: user.phone,
    createdAt: user.createdAt,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
});

/** Returns a narrow user object for the current session, or null. Unverified accounts count as signed out. */
export async function getCurrentUser() {
  const user = await getSessionUser();
  if (!user?.emailVerified) return null;
  return { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, createdAt: user.createdAt };
}

/** Sends a signed-out visitor to log in, and a signed-in but unverified one to enter their code. */
export async function redirectToAuth(): Promise<never> {
  const pending = await getSessionUser();
  redirect(pending ? "/verify-email" : "/login");
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) return redirectToAuth();
  return user;
}
