"use server";

import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/dal";
import { syncSeats } from "@/lib/stripe";
import { ORG_COOKIE } from "@/lib/tenancy";

export async function acceptInvite(fd: FormData) {
  const user = await getCurrentUser();
  const token = String(fd.get("token") ?? "");
  if (!user) redirect(`/login?next=/invite/${token}`);

  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.token, token), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
    .limit(1);
  if (!invite || invite.email.toLowerCase() !== user.email.toLowerCase()) redirect(`/invite/${token}`);

  await db.insert(schema.memberships).values({ orgId: invite.orgId, userId: user.id, role: invite.role }).onConflictDoNothing();
  await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
  await syncSeats(invite.orgId);
  (await cookies()).set(ORG_COOKIE, String(invite.orgId), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/app");
}
