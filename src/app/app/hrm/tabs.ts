import type { Feature } from "@/lib/plans";
import { canManage } from "@/lib/roles";
import { hasFeature, type ActiveWorkspace } from "@/lib/tenancy";

export const HRM_TABS: readonly { key: string; href: string; label: string; feature?: Feature; manage?: boolean }[] = [
  { key: "directory", href: "/app/hrm", label: "Directory" },
  { key: "org-chart", href: "/app/hrm/org-chart", label: "Org chart" },
  { key: "departments", href: "/app/hrm/departments", label: "Departments" },
  { key: "leave", href: "/app/hrm/leave", label: "Leave" },
  { key: "attendance", href: "/app/hrm/attendance", label: "Attendance" },
  { key: "holidays", href: "/app/hrm/holidays", label: "Holidays" },
  { key: "shifts", href: "/app/hrm/shifts", label: "Shifts" },
  { key: "documents", href: "/app/hrm/documents", label: "Documents" },
  { key: "letters", href: "/app/hrm/letters", label: "Letters" },
  { key: "assets", href: "/app/hrm/assets", label: "Assets" },
  { key: "claims", href: "/app/hrm/claims", label: "Claims", feature: "expenseClaims", manage: true },
  { key: "recruitment", href: "/app/hrm/recruitment", label: "Recruitment", feature: "recruitment" },
  { key: "performance", href: "/app/hrm/performance", label: "Performance", feature: "performance" },
] as const;

export type HrmTab = "directory" | "org-chart" | "departments" | "leave" | "attendance" | "holidays" | "shifts" | "documents" | "letters" | "assets" | "claims" | "recruitment" | "performance";

/** Tabs for the HRM header; hides tabs whose plan feature the workspace lacks, and manager-only tabs for other roles. */
export function hrmTabs(ws: ActiveWorkspace, active: HrmTab) {
  return HRM_TABS.filter((t) => (!t.feature || hasFeature(ws, t.feature)) && (!t.manage || canManage(ws.role))).map((t) => ({ href: t.href, label: t.label, active: t.key === active }));
}
