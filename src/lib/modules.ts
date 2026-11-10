import {
  BarChart3,
  Boxes,
  FolderKanban,
  Headset,
  Landmark,
  Users,
  Wallet,
  Handshake,
  type LucideIcon,
} from "lucide-react";

export type Module = {
  key: string;
  name: string;
  short: string;
  tagline: string;
  description: string;
  features: string[];
  color: string; // tailwind bg class
  icon: LucideIcon;
  metric: { label: string; value: string };
};

export const MODULES: Module[] = [
  {
    key: "hrm",
    name: "People & HRM",
    short: "HRM",
    tagline: "Hire, onboard, grow.",
    description: "Recruitment pipelines, onboarding checklists, attendance, leave and performance reviews — with a self-service portal people actually open.",
    features: ["Applicant tracking", "Shift & leave planner", "Reviews & OKRs"],
    color: "bg-mint",
    icon: Users,
    metric: { label: "Onboarding time", value: "−63%" },
  },
  {
    key: "crm",
    name: "Sales CRM",
    short: "CRM",
    tagline: "Pipelines that close.",
    description: "Leads, deals, quotes and follow-ups in one view. Reps see stock, invoices and support tickets without leaving the deal.",
    features: ["Visual pipelines", "Quotes & e-sign", "Forecasting"],
    color: "bg-butter",
    icon: Handshake,
    metric: { label: "Win rate", value: "+23%" },
  },
  {
    key: "finance",
    name: "Finance & Accounts",
    short: "Finance",
    tagline: "Books that close themselves.",
    description: "General ledger, invoicing, expenses, bank reconciliation and GST/VAT-ready reports. Every sale and payroll run posts automatically.",
    features: ["Invoicing", "Bank reconciliation", "Multi-currency"],
    color: "bg-sky",
    icon: Landmark,
    metric: { label: "Month-end close", value: "3 days" },
  },
  {
    key: "inventory",
    name: "Inventory & Supply",
    short: "Inventory",
    tagline: "Know what's on the shelf.",
    description: "Multi-warehouse stock, purchase orders, batches and serials, vendor portal and reorder rules that run on their own.",
    features: ["Multi-warehouse", "Auto purchase orders", "Barcode & batches"],
    color: "bg-peach",
    icon: Boxes,
    metric: { label: "Stock-outs", value: "−41%" },
  },
  {
    key: "payroll",
    name: "Payroll",
    short: "Payroll",
    tagline: "Pay day, minus the panic.",
    description: "One-click payroll with taxes, deductions, reimbursements, payslips and statutory filings — straight from attendance data.",
    features: ["Auto tax rules", "Payslips & bank files", "Compliance filings"],
    color: "bg-lime",
    icon: Wallet,
    metric: { label: "Payroll run", value: "12 min" },
  },
  {
    key: "projects",
    name: "Projects",
    short: "Projects",
    tagline: "Plans meet reality.",
    description: "Boards, timelines and timesheets linked to budgets and billing, so you see margin on every project while it's still running.",
    features: ["Kanban & Gantt", "Timesheets", "Budget vs actual"],
    color: "bg-lilac",
    icon: FolderKanban,
    metric: { label: "On-time delivery", value: "94%" },
  },
  {
    key: "helpdesk",
    name: "Helpdesk",
    short: "Helpdesk",
    tagline: "Support with context.",
    description: "Email, chat and WhatsApp tickets with SLAs and a knowledge base — agents see the customer's orders and contract instantly.",
    features: ["Omnichannel inbox", "SLA automation", "Knowledge base"],
    color: "bg-rose",
    icon: Headset,
    metric: { label: "First reply", value: "< 9 min" },
  },
  {
    key: "analytics",
    name: "Analytics",
    short: "Analytics",
    tagline: "One source of truth.",
    description: "Dashboards that pull from every module at once, scheduled reports and an assistant you can ask questions in plain English.",
    features: ["Cross-module dashboards", "AI assistant", "Scheduled reports"],
    color: "bg-card",
    icon: BarChart3,
    metric: { label: "Reports built", value: "in seconds" },
  },
];
