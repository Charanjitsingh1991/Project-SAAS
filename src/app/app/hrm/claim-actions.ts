"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { ctxOf } from "@/lib/activity";
import { rejectClaim } from "@/lib/claims";
import type { FormState } from "@/lib/definitions";
import { approveClaim } from "@/lib/posting";
import { requireWorkspace } from "@/lib/tenancy";

const GUARD = { module: "hrm", manage: true, feature: "expenseClaims" } as const;

export async function approveClaimAction(fd: FormData) {
  const ws = await requireWorkspace(GUARD);
  const err = await approveClaim(ctxOf(ws), Number(fd.get("id")));
  if (err) redirect(`/app/hrm/claims?error=${encodeURIComponent(err)}`);
  refresh();
}

export async function rejectClaimAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace(GUARD);
  const err = await rejectClaim(ctxOf(ws), Number(fd.get("id")), String(fd.get("reason") ?? ""));
  if (err) return { errors: { reason: [err] } };
  refresh();
  return { ok: true, message: "Claim rejected." };
}
