"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getSessionUser } from "@/lib/dal";
import type { FormState } from "@/lib/definitions";
import { OTP_MAX_ATTEMPTS, isOtpUsable, normalizeOtp, otpMatches } from "@/lib/email-verification";
import { ORG_COOKIE, isPlatformAdmin } from "@/lib/tenancy";
import { completeVerification, issueCode, latestCode } from "@/lib/verification";

async function pendingUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.emailVerified) redirect("/app");
  return user;
}

export async function verifyEmail(_: FormState, formData: FormData): Promise<FormState> {
  const user = await pendingUser();
  const code = normalizeOtp(String(formData.get("code") ?? ""));
  if (!code) return { errors: { code: ["Enter the 6-digit code from the email."] } };

  const row = await latestCode(user.id);
  if (!row || !isOtpUsable(row)) {
    return { message: "This code has expired or was used too many times. Send yourself a new one." };
  }
  if (!otpMatches(user.id, code, row.codeHash)) {
    const [after] = await db
      .update(schema.emailVerifications)
      .set({ attempts: sql`${schema.emailVerifications.attempts} + 1` })
      .where(eq(schema.emailVerifications.id, row.id))
      .returning({ attempts: schema.emailVerifications.attempts });
    const left = OTP_MAX_ATTEMPTS - (after?.attempts ?? OTP_MAX_ATTEMPTS);
    return {
      errors: { code: [left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong codes. Send yourself a new one."] },
    };
  }

  const claimed = await db
    .update(schema.emailVerifications)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.emailVerifications.id, row.id), isNull(schema.emailVerifications.usedAt)))
    .returning({ id: schema.emailVerifications.id });
  if (!claimed.length) return { message: "This code was already used. Send yourself a new one." };

  const orgId = await completeVerification(user);
  (await cookies()).set(ORG_COOKIE, String(orgId), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect(isPlatformAdmin(user.email) ? "/admin" : "/app");
}

export async function resendCode(): Promise<FormState> {
  const user = await pendingUser();
  const r = await issueCode(user);
  if (r.ok) return { ok: true, message: `We sent a new code to ${user.email}.` };
  if (r.reason === "cooldown") return { message: `Please wait ${r.waitSec}s before asking for another code.` };
  if (r.reason === "hourly") return { message: "You've asked for several codes. Please wait an hour and try again." };
  return { message: "We couldn't send the email just now. Please try again in a minute." };
}
