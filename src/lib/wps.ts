/**
 * UAE Wages Protection System salary information file (SIF).
 * One EDR line per employee, then a single SCR control line. Amounts in AED with 2 decimals.
 * The fixed + variable amounts on each EDR equal the net salary transferred.
 */

export type SifEmployee = {
  name: string;
  personId: string | null; // MOHRE 14-digit person ID
  routingCode: string | null; // employee bank / exchange agent routing code (9 digits)
  iban: string | null; // AE + 21 digits (or 16-digit salary card number)
  net: number; // minor units
  variable: number; // bonus, overtime, reimbursements (minor units, within net)
  leaveDays: number;
};

export type SifInput = {
  employerId: string | null; // MOHRE establishment ID (13 digits)
  employerRouting: string | null; // employer's bank routing code (9 digits)
  period: string; // YYYY-MM
  createdAt: Date; // file creation time (UAE time is applied by the caller)
  reference: string;
  employees: SifEmployee[];
};

const amt = (minor: number) => (minor / 100).toFixed(2);
const pad = (n: number) => String(n).padStart(2, "0");

export function validateSif(i: SifInput): string[] {
  const errors: string[] = [];
  if (!/^\d{13}$/.test(i.employerId ?? "")) errors.push("Workspace MOHRE establishment ID must be 13 digits (Settings → Company).");
  if (!/^\d{9}$/.test(i.employerRouting ?? "")) errors.push("Workspace WPS bank routing code must be 9 digits (Settings → Company).");
  for (const e of i.employees) {
    if (!/^\d{14}$/.test(e.personId ?? "")) errors.push(`${e.name}: MOHRE person ID must be 14 digits.`);
    if (!/^\d{9}$/.test(e.routingCode ?? "")) errors.push(`${e.name}: bank routing code must be 9 digits.`);
    if (!/^(AE\d{21}|\d{16})$/.test(e.iban ?? "")) errors.push(`${e.name}: IBAN must be AE + 21 digits (or a 16-digit salary card).`);
    if (e.net <= 0) errors.push(`${e.name}: net pay must be positive.`);
  }
  return errors;
}

export function buildSif(i: SifInput) {
  const [y, m] = i.period.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = `${i.period}-01`;
  const end = `${i.period}-${pad(days)}`;
  const d = i.createdAt;
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hhmm = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  const lines = i.employees.map((e) => {
    const variable = Math.min(Math.max(e.variable, 0), e.net);
    return ["EDR", e.personId, e.routingCode, e.iban, start, end, days, amt(e.net - variable), amt(variable), e.leaveDays].join(",");
  });
  const total = i.employees.reduce((s, e) => s + e.net, 0);
  const ref = i.reference.replace(/[,\r\n]/g, " ").slice(0, 35);
  lines.push(["SCR", i.employerId, i.employerRouting, date, hhmm, `${pad(m)}${y}`, i.employees.length, amt(total), "AED", ref].join(","));
  const stamp = `${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${hhmm}${pad(d.getUTCSeconds())}`;
  return { content: `${lines.join("\r\n")}\r\n`, fileName: `${i.employerId}${stamp}.SIF` };
}
