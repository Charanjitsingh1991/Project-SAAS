import { addDaysYmd } from "./format";
import { isValidYmd } from "./hrm";

/** How far back an employee may ask for an attendance correction. */
export const REGULARIZATION_WINDOW_DAYS = 30;

export const REGULARIZATION_STATUSES_ALLOWED = ["present", "half_day", "wfh"] as const;

export type ApprovalActor = {
  /** User can open the HRM module (owner/admin/hr). */
  hrm: boolean;
  /** The actor's own linked employee id, if any. */
  actorEmployeeId: number | null;
  /** The employee whose request is being decided, and their reporting manager. */
  subjectEmployeeId: number;
  subjectManagerId: number | null;
  /** Managers may only act on requests that are still pending. */
  requestStatus?: string;
};

/** HR/admin/owner can decide anyone's request but their own; a reporting manager can decide direct reports' pending requests. */
export function canDecideRequest(a: ApprovalActor): { ok: true; via: "hrm" | "manager" } | { ok: false; message: string } {
  if (a.actorEmployeeId !== null && a.actorEmployeeId === a.subjectEmployeeId) {
    return { ok: false, message: "You can't approve or reject your own request." };
  }
  if (a.hrm) return { ok: true, via: "hrm" };
  if (a.actorEmployeeId !== null && a.subjectManagerId === a.actorEmployeeId) {
    if (a.requestStatus !== undefined && a.requestStatus !== "pending") return { ok: false, message: "Only pending requests can be decided." };
    return { ok: true, via: "manager" };
  }
  return { ok: false, message: "You're not allowed to decide this request." };
}

/** Past dates only (today is allowed for a missed punch), no older than the window. Returns an error message or null. */
export function regularizationDateError(date: string, today: string, windowDays = REGULARIZATION_WINDOW_DAYS): string | null {
  if (!isValidYmd(date)) return "Pick a valid date.";
  if (date > today) return "You can't request a correction for a future date.";
  if (date < addDaysYmd(today, -windowDays)) return `Corrections can only be requested for the last ${windowDays} days.`;
  return null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Normalises optional HH:MM inputs; returns an error when malformed or out of order. */
export function parseRegularizationTimes(checkIn: string, checkOut: string): { checkIn: string | null; checkOut: string | null; error?: string } {
  const i = checkIn.trim();
  const o = checkOut.trim();
  if (i && !TIME.test(i)) return { checkIn: null, checkOut: null, error: "Enter check-in as HH:MM." };
  if (o && !TIME.test(o)) return { checkIn: null, checkOut: null, error: "Enter check-out as HH:MM." };
  if (i && o && o < i) return { checkIn: null, checkOut: null, error: "Check-out can't be earlier than check-in." };
  return { checkIn: i || null, checkOut: o || null };
}

/** Caps notification fan-out and removes blanks, the requester, and duplicates (case-insensitive). */
export function pickRecipients(emails: (string | null | undefined)[], exclude: (string | null | undefined)[] = [], cap = 5): string[] {
  const skip = new Set(exclude.filter(Boolean).map((e) => e!.trim().toLowerCase()));
  const out: string[] = [];
  for (const e of emails) {
    const v = e?.trim();
    if (!v || !v.includes("@")) continue;
    const k = v.toLowerCase();
    if (skip.has(k)) continue;
    skip.add(k);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}
