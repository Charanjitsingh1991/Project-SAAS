export const HRM_TABS = [
  { key: "directory", href: "/app/hrm", label: "Directory" },
  { key: "org-chart", href: "/app/hrm/org-chart", label: "Org chart" },
  { key: "departments", href: "/app/hrm/departments", label: "Departments" },
  { key: "leave", href: "/app/hrm/leave", label: "Leave" },
  { key: "attendance", href: "/app/hrm/attendance", label: "Attendance" },
  { key: "holidays", href: "/app/hrm/holidays", label: "Holidays" },
] as const;

export type HrmTab = (typeof HRM_TABS)[number]["key"];

export function hrmTabs(active: HrmTab) {
  return HRM_TABS.map((t) => ({ href: t.href, label: t.label, active: t.key === active }));
}
