"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { askQuestion, MAX_QUESTION_CHARS } from "@/lib/ai/ask";
import { requireWorkspace } from "@/lib/tenancy";
import type { AskState } from "./types";

const Schema = z.object({ question: z.string().trim().min(2, "Type a question.").max(MAX_QUESTION_CHARS, `Keep it under ${MAX_QUESTION_CHARS} characters.`) });

export async function askAction(_: AskState, fd: FormData): Promise<AskState> {
  const ws = await requireWorkspace({ feature: "copilot" });
  const raw = String(fd.get("question") ?? "");
  const parsed = Schema.safeParse({ question: raw });
  if (!parsed.success) return { ok: false, question: raw.slice(0, MAX_QUESTION_CHARS), error: parsed.error.issues[0]?.message ?? "Invalid question." };

  try {
    const out = await askQuestion(ws, parsed.data.question);
    refresh();
    return { ...out };
  } catch {
    return { ok: false, question: parsed.data.question, error: "Something went wrong while answering. Please try again." };
  }
}
