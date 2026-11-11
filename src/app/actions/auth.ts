"use server";

import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { LoginSchema, SignupSchema, type FormState } from "@/lib/definitions";
import { COUNTRIES, countryFromPhone, isValidPhone, normalizePhone } from "@/lib/countries";
import {
  LOGIN_MAX_FAILS_PER_EMAIL,
  LOGIN_MAX_FAILS_PER_IP,
  LOGIN_WINDOW_MS,
  SIGNUP_MAX_PER_IP_HOUR,
  isDisposableEmail,
} from "@/lib/email-verification";
import { createSession, deleteSession } from "@/lib/session";
import { syncSeats } from "@/lib/stripe";
import { ORG_COOKIE, isPlatformAdmin } from "@/lib/tenancy";
import { clearHits, clientIp, consume, recentHits, recordHit } from "@/lib/throttle";
import { issueCode } from "@/lib/verification";

/** Only allow same-site relative redirects. */
function safeNext(value: FormDataEntryValue | null) {
  const s = typeof value === "string" ? value : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : null;
}

async function setActiveOrg(orgId: number) {
  (await cookies()).set(ORG_COOKIE, String(orgId), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

async function openInvite(token: string) {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.token, token), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
    .limit(1);
  return invite ?? null;
}

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    company: String(formData.get("company") ?? "") || undefined,
    country: String(formData.get("country") ?? "IN"),
    phone: String(formData.get("phone") ?? "") || undefined,
    password: String(formData.get("password") ?? ""),
  };
  const inviteToken = String(formData.get("invite") ?? "");
  const values = { name: raw.name, email: raw.email, company: raw.company ?? "", country: raw.country, phone: raw.phone ?? "" };
  // Hidden field people never see; bots that fill every input get a vague error.
  if (String(formData.get("website") ?? "")) return { message: "We couldn't create your account. Please try again.", values };

  const parsed = SignupSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const { name, email, company, password } = parsed.data;
  // Phone: optional for invited users; when given it must match the country (and +971/+91 auto-picks the country).
  const phone = parsed.data.phone ? normalizePhone(parsed.data.phone) : null;
  const country = (phone && countryFromPhone(phone)) || parsed.data.country;
  if (phone && !isValidPhone(phone, country)) {
    return { errors: { phone: [`Enter a valid ${COUNTRIES[country].name} mobile number, e.g. ${COUNTRIES[country].phone.example}.`] }, values };
  }
  if (!inviteToken && !phone) return { errors: { phone: ["Enter your mobile number."] }, values };
  const invite = inviteToken ? await openInvite(inviteToken) : null;
  if (inviteToken && !invite) return { message: "This invite link has expired or was already used.", values };
  if (invite && invite.email.toLowerCase() !== email) {
    return { errors: { email: [`This invite is for ${invite.email}.`] }, values };
  }
  if (!invite) {
    if (isDisposableEmail(email)) return { errors: { email: ["Please use your work or personal email, not a temporary inbox."] }, values };
    // Invites are exempt: a whole office may join from one IP.
    if (!(await consume(`signup:ip:${await clientIp()}`, SIGNUP_MAX_PER_IP_HOUR, 60 * 60 * 1000))) {
      return { message: "Too many sign-ups from your network. Please try again in an hour.", values };
    }
  }

  const [existing] = await db
    .select({ id: schema.users.id, verified: schema.users.emailVerifiedAt })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing?.verified) {
    return { errors: { email: ["An account with this email already exists."] }, values };
  }

  // The invite link was emailed to this address, so following it proves ownership.
  const emailVerifiedAt = invite ? new Date() : null;
  const passwordHash = await bcrypt.hash(password, 12);
  let userId: number;
  if (existing) {
    // Nobody has proved this address yet, so a fresh sign-up replaces the pending one.
    await db.update(schema.users).set({ name, company, phone, passwordHash, emailVerifiedAt }).where(eq(schema.users.id, existing.id));
    userId = existing.id;
  } else {
    [{ id: userId }] = await db
      .insert(schema.users)
      .values({ name, email, company, phone, passwordHash, emailVerifiedAt })
      .returning({ id: schema.users.id });
  }

  if (invite) {
    await db.insert(schema.memberships).values({ orgId: invite.orgId, userId, role: invite.role });
    await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
    await syncSeats(invite.orgId);
    await createSession(userId);
    await setActiveOrg(invite.orgId);
    redirect("/app");
  }

  // The workspace is created once the emailed code is entered (completeVerification).
  await issueCode({ id: userId, email, name });
  await createSession(userId);
  redirect("/verify-email");
}

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const parsed = LoginSchema.safeParse(raw);
  const values = { email: raw.email };
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const emailKey = `login:email:${parsed.data.email}`;
  const ipKey = `login:ip:${await clientIp()}`;
  if (
    (await recentHits(emailKey, LOGIN_WINDOW_MS)) >= LOGIN_MAX_FAILS_PER_EMAIL ||
    (await recentHits(ipKey, LOGIN_WINDOW_MS)) >= LOGIN_MAX_FAILS_PER_IP
  ) {
    return { message: "Too many failed attempts. Wait 15 minutes or reset your password.", values };
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);

  // Same message for unknown email and wrong password to avoid account enumeration.
  const valid = user && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  if (!valid) {
    await recordHit(emailKey);
    await recordHit(ipKey);
    return { message: "Email or password is incorrect.", values };
  }
  await clearHits(emailKey);

  await createSession(user.id);
  if (!user.emailVerifiedAt) {
    await issueCode(user);
    redirect("/verify-email");
  }
  redirect(safeNext(formData.get("next")) ?? (isPlatformAdmin(user.email) ? "/admin" : "/app"));
}

export async function logout() {
  await deleteSession();
  (await cookies()).delete(ORG_COOKIE);
  redirect("/");
}
