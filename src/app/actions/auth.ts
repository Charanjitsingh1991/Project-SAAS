"use server";

import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { LoginSchema, SignupSchema, type FormState } from "@/lib/definitions";
import { COUNTRIES, countryFromPhone, isValidPhone, normalizePhone } from "@/lib/countries";
import { sendEmail } from "@/lib/email";
import { createOrganization } from "@/lib/org";
import { appOrigin } from "@/lib/url";
import { createSession, deleteSession } from "@/lib/session";
import { syncSeats } from "@/lib/stripe";
import { ORG_COOKIE } from "@/lib/tenancy";

/** Only allow same-site relative redirects. */
function safeNext(value: FormDataEntryValue | null) {
  const s = typeof value === "string" ? value : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/app";
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
  const parsed = SignupSchema.safeParse(raw);
  const values = { name: raw.name, email: raw.email, company: raw.company ?? "", country: raw.country, phone: raw.phone ?? "" };
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

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing.length) {
    return { errors: { email: ["An account with this email already exists."] }, values };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(schema.users)
    .values({ name, email, company, phone, passwordHash })
    .returning({ id: schema.users.id });

  let orgId: number;
  if (invite) {
    await db.insert(schema.memberships).values({ orgId: invite.orgId, userId: user.id, role: invite.role });
    await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
    orgId = invite.orgId;
    await syncSeats(orgId);
  } else {
    orgId = await createOrganization(user.id, company || `${name.split(" ")[0]}'s workspace`, { country, phone });
  }

  if (!invite) {
    await sendEmail({
      to: email,
      subject: "Welcome to saasmodels.tech",
      paragraphs: [`Hi ${name.split(" ")[0]},`, "Your workspace is ready and your 14-day trial has started. Set up your company and invite your team whenever you're ready."],
      action: { label: "Open your workspace", url: `${await appOrigin()}/app` },
    });
  }

  await createSession(user.id);
  await setActiveOrg(orgId);
  redirect("/app");
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

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);

  // Same message for unknown email and wrong password to avoid account enumeration.
  const valid = user && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  if (!valid) {
    return { message: "Email or password is incorrect.", values };
  }

  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function logout() {
  await deleteSession();
  (await cookies()).delete(ORG_COOKIE);
  redirect("/");
}
