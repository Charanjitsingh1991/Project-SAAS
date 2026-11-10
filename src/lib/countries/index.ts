import { UAE } from "./ae";
import { INDIA } from "./in";
import type { CountryCode, CountryPack, TaxRateOption } from "./types";

export type { CountryCode, CountryPack, TaxRateOption } from "./types";

export const COUNTRIES: Record<CountryCode, CountryPack> = { IN: INDIA, AE: UAE };
export const COUNTRY_LIST: CountryPack[] = [INDIA, UAE];

export function countryPack(code: string | null | undefined): CountryPack {
  return COUNTRIES[(code as CountryCode) ?? "IN"] ?? INDIA;
}

/** Workspace-like object → its pack. */
export function packOf(org: { country?: string | null }): CountryPack {
  return countryPack(org.country);
}

/** Detect country from an E.164-ish phone number (+91… / +971…). */
export function countryFromPhone(phone: string | null | undefined): CountryCode | null {
  const p = normalizePhone(phone);
  if (p.startsWith("+971")) return "AE";
  if (p.startsWith("+91")) return "IN";
  return null;
}

/** Strip spaces/dashes/brackets; convert 00 prefix to +. */
export function normalizePhone(phone: string | null | undefined) {
  let p = String(phone ?? "").replace(/[\s\-().]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  return p;
}

export function isValidPhone(phone: string, country: CountryCode) {
  return new RegExp(COUNTRIES[country].phone.pattern).test(normalizePhone(phone));
}

export function taxOption(pack: CountryPack, code: string | null | undefined, rate?: number): TaxRateOption {
  return (
    pack.tax.rates.find((r) => r.code === code) ??
    (rate !== undefined ? pack.tax.rates.find((r) => r.rate === rate && r.kind !== "exempt") : undefined) ??
    pack.tax.rates.find((r) => r.code === pack.tax.defaultCode)!
  );
}

export function defaultTaxRate(pack: CountryPack) {
  return taxOption(pack, pack.tax.defaultCode).rate;
}

/** Common nationalities for UAE workforce pickers (ISO code → name). */
export const NATIONALITIES: { code: string; name: string }[] = [
  { code: "AE", name: "United Arab Emirates" },
  { code: "IN", name: "India" },
  { code: "PK", name: "Pakistan" },
  { code: "BD", name: "Bangladesh" },
  { code: "PH", name: "Philippines" },
  { code: "EG", name: "Egypt" },
  { code: "LK", name: "Sri Lanka" },
  { code: "NP", name: "Nepal" },
  { code: "JO", name: "Jordan" },
  { code: "LB", name: "Lebanon" },
  { code: "SY", name: "Syria" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "OM", name: "Oman" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },
  { code: "KE", name: "Kenya" },
  { code: "OTHER", name: "Other" },
];

export function nationalityName(code: string | null | undefined) {
  return NATIONALITIES.find((n) => n.code === code)?.name ?? code ?? "—";
}

/** Fiscal year [start, end] (YYYY-MM-DD) containing a date, for a fiscal year starting in `startMonth`. */
export function fiscalYearFor(ymd: string, startMonth: number): [string, string] {
  const [y, m] = ymd.split("-").map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  const start = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(startYear + 1, startMonth - 1, 0)).toISOString().slice(0, 10);
  return [start, end];
}

/** Weekend set from an org's JSON column (falls back to the pack default). */
export function weekendOf(org: { weekendDays?: string | null; country?: string | null }): number[] {
  try {
    const v = JSON.parse(org.weekendDays ?? "");
    if (Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return v;
  } catch {}
  return packOf(org).weekendDays;
}

export function statutoryOf(org: { statutory?: string | null }): Record<string, string> {
  try {
    const v = JSON.parse(org.statutory ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
