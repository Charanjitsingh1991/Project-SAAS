export const ASSET_CATEGORIES = ["laptop", "phone", "vehicle", "furniture", "other"] as const;
export const ASSET_STATUSES = ["available", "assigned", "in_repair", "retired"] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Statuses a user may set directly; "assigned" is only reached by assigning to an employee. */
export const MANUAL_STATUSES = ["available", "in_repair", "retired"] as const;

/** Returns an error message, or null when the asset can be assigned. */
export function canAssign(status: AssetStatus): string | null {
  if (status === "assigned") return "This asset is already assigned. Return it first.";
  if (status === "in_repair") return "This asset is in repair and can't be assigned.";
  if (status === "retired") return "This asset is retired and can't be assigned.";
  return null;
}

/** Manual status changes are blocked while the asset is out with an employee. */
export function canSetStatus(current: AssetStatus, next: AssetStatus): string | null {
  if (next === "assigned") return "Assign the asset to an employee instead.";
  if (current === "assigned") return "Return the asset before changing its status.";
  return null;
}

export function warrantyState(expiry: string | null, today: string, withinDays = 30): "none" | "expired" | "expiring" | "ok" {
  if (!expiry) return "none";
  if (expiry < today) return "expired";
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + withinDays);
  return expiry <= limit.toISOString().slice(0, 10) ? "expiring" : "ok";
}
