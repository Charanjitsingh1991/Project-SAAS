"use server";

import { z } from "zod";
import { db, schema } from "@/db";
import { EnquirySchema, type FormState } from "@/lib/definitions";

export async function submitEnquiry(_: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(
    ["name", "email", "company", "teamSize", "interest", "message"].map((k) => [
      k,
      String(formData.get(k) ?? ""),
    ]),
  );
  // Honeypot: real users never fill this hidden field.
  if (formData.get("website")) return { ok: true, message: "Thanks! We'll be in touch." };

  const parsed = EnquirySchema.safeParse({
    ...raw,
    company: raw.company || undefined,
    teamSize: raw.teamSize || undefined,
    interest: raw.interest || undefined,
  });
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors, values: raw };
  }

  await db.insert(schema.enquiries).values(parsed.data);
  return {
    ok: true,
    message: `Thanks ${parsed.data.name.split(" ")[0]} — someone from our team will reply within one business day.`,
  };
}
