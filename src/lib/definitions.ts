import { z } from "zod";

export const SignupSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name."),
  email: z.email("Enter a valid email.").trim().toLowerCase(),
  company: z.string().trim().max(120).optional(),
  password: z
    .string()
    .min(8, "At least 8 characters.")
    .regex(/[a-zA-Z]/, "Include at least one letter.")
    .regex(/[0-9]/, "Include at least one number."),
});

export const LoginSchema = z.object({
  email: z.email("Enter a valid email.").trim().toLowerCase(),
  password: z.string().min(1, "Password is required."),
});

export const EnquirySchema = z.object({
  name: z.string().trim().min(2, "Please enter your name."),
  email: z.email("Enter a valid email.").trim().toLowerCase(),
  company: z.string().trim().max(120).optional(),
  teamSize: z.string().trim().max(20).optional(),
  interest: z.string().trim().max(200).optional(),
  message: z.string().trim().min(10, "Tell us a little more (10+ characters).").max(4000),
});

export type FormState =
  | {
      ok?: boolean;
      message?: string;
      errors?: Record<string, string[] | undefined>;
      values?: Record<string, string>;
    }
  | undefined;
