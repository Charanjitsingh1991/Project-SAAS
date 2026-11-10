import type { Feature } from "@/lib/plans";
import { hasFeature, type ActiveWorkspace } from "@/lib/tenancy";

export const HRM_TABS: readonly { key: string; href: string; label: string; feature?: Feature }[] = [
  { key: "directory", href: "/app/hrm", label: "Directory" },
  { key: "org-chart", href: "/app/hrm/org-chart", label: "Org chart" },
  { key: "departments", href: "/app/hrm/departments", label: "Departments" },
  { key: "leave", href: "/app/hrm/leave", label: "Leave" },
  { key: "attendance", href: "/app/hrm/attendance", label: "Attendance" },
  { key: "holidays", href: "/app/hrm/holidays", label: "Holidays" },
  { key: "claims", href: "/app/hrm/claims", label: "Claims", feature: "expenseClaims" },
  { key: "recruitment", href: "/app/hrm/recruitment", label: "Recruitment", feature: "recruitment" },
  { key: "performance", href: "/app/hrm/performance", label: "Performance", feature: "performance" },
] as const;

export type HrmTab = "directory" | "org-chart" | "departments" | "leave" | "attendance" | "holidays" | "claims" | "recruitment" | "performance";

/** Tabs for the HRM header; plan-gated tabs are hidden when the workspace lacks the feature. */
export function hrmTabs(ws: ActiveWorkspace, active: HrmTab) {
  return HRM_TABS.filter((t) => !t.feature || hasFeature(ws, t.feature)).map((t) => ({ href: t.href, label: t.label, active: t.key === active }));
}
