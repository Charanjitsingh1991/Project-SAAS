"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { ctxOf } from "@/lib/activity";
import { rejectClaim } from "@/lib/claims";
import type { FormState } from "@/lib/definitions";
import { notifyClaimDecided } from "@/lib/notify";
import { approveClaim } from "@/lib/posting";
import { requireWorkspace } from "@/lib/tenancy";

const GUARD = { module: "hrm", manage: true, feature: "expenseClaims" } as const;

export async function approveClaimAction(fd: FormData) {
  const ws = await requireWorkspace(GUARD);
  const id = Number(fd.get("id"));
  const err = await approveClaim(ctxOf(ws), id);
  if (err) redirect(`/app/hrm/claims?error=${encodeURIComponent(err)}`);
  await notifyClaimDecided(ws.org.id, id, ws.org.currency);
  refresh();
}

export async function rejectClaimAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace(GUARD);
  const id = Number(fd.get("id"));
  const err = await rejectClaim(ctxOf(ws), id, String(fd.get("reason") ?? ""));
  if (err) return { errors: { reason: [err] } };
  await notifyClaimDecided(ws.org.id, id, ws.org.currency);
  refresh();
  return { ok: true, message: "Claim rejected." };
}
