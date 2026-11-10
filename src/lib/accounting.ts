/** Client-safe accounting constants shared by Finance, Inventory, Payroll and the ledger. */

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export const DEFAULT_ACCOUNTS: { code: string; name: string; type: AccountType; key: string }[] = [
  { code: "1000", name: "Bank & cash", type: "asset", key: "bank" },
  { code: "1100", name: "Accounts receivable", type: "asset", key: "ar" },
  { code: "1200", name: "Inventory", type: "asset", key: "inventory" },
  { code: "1300", name: "GST input credit", type: "asset", key: "gst_in" },
  { code: "2000", name: "Accounts payable", type: "liability", key: "ap" },
  { code: "2100", name: "GST payable", type: "liability", key: "gst_out" },
  { code: "2200", name: "PF & ESI payable", type: "liability", key: "pf_payable" },
  { code: "2300", name: "TDS payable", type: "liability", key: "tds_payable" },
  { code: "2400", name: "Professional tax payable", type: "liability", key: "pt_payable" },
  { code: "3000", name: "Owner's equity", type: "equity", key: "equity" },
  { code: "4000", name: "Sales", type: "income", key: "sales" },
  { code: "4900", name: "Other income", type: "income", key: "other_income" },
  { code: "5000", name: "Cost of goods sold", type: "expense", key: "cogs" },
  { code: "6000", name: "Salaries & wages", type: "expense", key: "salaries" },
  { code: "6010", name: "Employer PF & ESI", type: "expense", key: "employer_contrib" },
  { code: "6100", name: "Rent", type: "expense", key: "rent" },
  { code: "6200", name: "Software & subscriptions", type: "expense", key: "software" },
  { code: "6300", name: "Travel", type: "expense", key: "travel" },
  { code: "6400", name: "Marketing", type: "expense", key: "marketing" },
  { code: "6500", name: "Office supplies", type: "expense", key: "supplies" },
  { code: "6600", name: "Utilities", type: "expense", key: "utilities" },
  { code: "6700", name: "Professional fees", type: "expense", key: "professional_fees" },
  { code: "6800", name: "Repairs & maintenance", type: "expense", key: "maintenance" },
  { code: "6900", name: "Other expenses", type: "expense", key: "other_expense" },
];

/** Categories a user can pick for a manual expense (value = account system key). */
export const EXPENSE_CATEGORIES = [
  { value: "rent", label: "Rent" },
  { value: "software", label: "Software & subscriptions" },
  { value: "travel", label: "Travel" },
  { value: "marketing", label: "Marketing" },
  { value: "supplies", label: "Office supplies" },
  { value: "utilities", label: "Utilities" },
  { value: "professional_fees", label: "Professional fees" },
  { value: "maintenance", label: "Repairs & maintenance" },
  { value: "other_expense", label: "Other expenses" },
] as const;

/** Every category key that can appear on an expense row (incl. automatic ones). */
export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  ...Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c.label])),
  inventory: "Inventory purchase",
  salaries: "Salaries & wages",
};

export const GST_RATES = [0, 5, 12, 18, 28] as const;

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
  "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Lakshadweep", "Puducherry",
] as const;

/** Fiscal year (India: April–March) containing a date. Returns [start, end] as YYYY-MM-DD. */
export function fiscalYear(ymd: string, startMonth = 4): [string, string] {
  const [y, m] = ymd.split("-").map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  const start = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, 0));
  return [start, endDate.toISOString().slice(0, 10)];
}
