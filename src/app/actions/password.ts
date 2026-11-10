"use server";

import bcrypt from "bcryptjs";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/dal";
import { sendEmail } from "@/lib/email";
import { LoginSchema, type FormState } from "@/lib/definitions";
import {
  BCRYPT_COST,
  NewPasswordSchema,
  RESET_MAX_PER_HOUR,
  generateResetToken,
  hashResetToken,
  isResetUsable,
  resetExpiry,
} from "@/lib/password-reset";
import { createSession } from "@/lib/session";
import { appOrigin } from "@/lib/url";

const GENERIC = "If an account exists for that email, we've emailed a reset link. It's valid for 60 minutes.";

const EmailSchema = LoginSchema.pick({ email: true });
const PasswordPair = z
  .object({ password: NewPasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match." });

async function notifyChanged(email: string, name: string) {
  await sendEmail({
    to: email,
    subject: "Your saasmodels.tech password was changed",
    paragraphs: [
      `Hi ${name.split(" ")[0]},`,
      "The password for your saasmodels.tech account was just changed.",
      "If this wasn't you, reset your password immediately and contact support.",
    ],
    action: { label: "Reset password", url: `${await appOrigin()}/forgot-password` },
  });
}

export async function requestPasswordReset(_: FormState, formData: FormData): Promise<FormState> {
  const raw = String(formData.get("email") ?? "");
  const parsed = EmailSchema.safeParse({ email: raw });
  if (!parsed.success) return { errors: { email: ["Enter a valid email."] }, values: { email: raw } };

  const [user] = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);

  if (user) {
    const recent = await db
      .select({ id: schema.passwordResets.id })
      .from(schema.passwordResets)
      .where(
        and(
          eq(schema.passwordResets.userId, user.id),
          isNull(schema.passwordResets.usedAt),
          gt(schema.passwordResets.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
        ),
      );
    if (recent.length < RESET_MAX_PER_HOUR) {
      const token = generateResetToken();
      await db.insert(schema.passwordResets).values({ userId: user.id, tokenHash: hashResetToken(token), expiresAt: resetExpiry() });
      await sendEmail({
        to: user.email,
        subject: "Reset your saasmodels.tech password",
        paragraphs: [
          `Hi ${user.name.split(" ")[0]},`,
          "We received a request to reset your password. The link below is valid for 60 minutes and can be used once.",
          "If you didn't ask for this, you can ignore this email.",
        ],
        action: { label: "Choose a new password", url: `${await appOrigin()}/reset-password/${token}` },
      });
    }
  }
  return { ok: true, message: GENERIC, values: {} };
}

export async function resetPassword(_: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const parsed = PasswordPair.safeParse({ password: String(formData.get("password") ?? ""), confirm: String(formData.get("confirm") ?? "") });
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };

  const [row] = await db.select().from(schema.passwordResets).where(eq(schema.passwordResets.tokenHash, hashResetToken(token))).limit(1);
  if (!row || !isResetUsable(row)) return { message: "This reset link is invalid or has expired. Request a new one." };

  // Claim the token atomically so a concurrent submit can't reuse it.
  const claimed = await db
    .update(schema.passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.passwordResets.id, row.id), isNull(schema.passwordResets.usedAt)))
    .returning({ id: schema.passwordResets.id });
  if (!claimed.length) return { message: "This reset link is invalid or has expired. Request a new one." };

  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_COST);
  const [user] = await db
    .update(schema.users)
    .set({ passwordHash, passwordChangedAt: new Date() })
    .where(eq(schema.users.id, row.userId))
    .returning({ id: schema.users.id, name: schema.users.name, email: schema.users.email });
  if (!user) return { message: "This reset link is invalid or has expired. Request a new one." };

  await db
    .update(schema.passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.passwordResets.userId, user.id), isNull(schema.passwordResets.usedAt), ne(schema.passwordResets.id, row.id)));

  await notifyChanged(user.email, user.name);
  await createSession(user.id);
  redirect("/app");
}

export async function changePassword(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const parsed = PasswordPair.safeParse({ password: String(formData.get("password") ?? ""), confirm: String(formData.get("confirm") ?? "") });
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };

  const [row] = await db.select({ hash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  if (!row || !(await bcrypt.compare(current, row.hash))) return { errors: { current: ["Current password is incorrect."] } };
  if (current === parsed.data.password) return { errors: { password: ["Choose a password different from your current one."] } };

  await db
    .update(schema.users)
    .set({ passwordHash: await bcrypt.hash(parsed.data.password, BCRYPT_COST), passwordChangedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  // Other devices are signed out; keep this one signed in with a fresh session.
  await createSession(user.id);
  await notifyChanged(user.email, user.name);
  return { ok: true, message: "Password updated. Other devices have been signed out." };
}
