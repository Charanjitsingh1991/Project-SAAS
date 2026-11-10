"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { LoginSchema, SignupSchema, type FormState } from "@/lib/definitions";
import { createSession, deleteSession } from "@/lib/session";

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    company: String(formData.get("company") ?? "") || undefined,
    password: String(formData.get("password") ?? ""),
  };
  const parsed = SignupSchema.safeParse(raw);
  const values = { name: raw.name, email: raw.email, company: raw.company ?? "" };
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const { name, email, company, password } = parsed.data;
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
    .values({ name, email, company, passwordHash })
    .returning({ id: schema.users.id });

  await createSession(user.id);
  redirect("/dashboard");
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
  redirect("/dashboard");
}

export async function logout() {
  await deleteSession();
  redirect("/");
}
