export const HRM_TABS = (active: "people" | "leave") => [
  { href: "/app/hrm", label: "Employees", active: active === "people" },
  { href: "/app/hrm/leave", label: "Leave", active: active === "leave" },
];
