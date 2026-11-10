/** Country-aware tax ID helpers (GSTIN / TRN) shared by CRM companies and inventory vendors. Pure. */
import type { CountryPack } from "@/lib/countries";

/** Plain props for forms (packs contain functions, so pass only what the UI needs). */
export type TaxFields = { idLabel: string; idExample: string; regionLabel: string; regions: readonly string[]; countryName: string };

export function taxFields(pack: CountryPack): TaxFields {
  return { idLabel: pack.tax.idLabel, idExample: pack.tax.idExample, regionLabel: pack.regionLabel, regions: pack.regions, countryName: pack.name };
}

export function normalizeTaxId(v: string | null | undefined) {
  const s = String(v ?? "").replace(/[\s-]/g, "").toUpperCase();
  return s || undefined;
}

/**
 * Validate a counterparty tax ID. Domestic parties (no country, or the workspace's country) must match the
 * pack pattern (GSTIN in India, 15-digit TRN in the UAE); foreign parties only need a plausible ID.
 */
export function taxIdError(pack: CountryPack, id: string | undefined, country?: string | null) {
  if (!id) return null;
  const c = (country ?? "").trim().toLowerCase();
  const domestic = !c || c === pack.name.toLowerCase() || c === pack.code.toLowerCase() || (pack.code === "AE" && c === "uae");
  if (domestic) return new RegExp(pack.tax.idPattern).test(id) ? null : `Enter a valid ${pack.tax.idLabel} (e.g. ${pack.tax.idExample}).`;
  return /^[A-Z0-9]{5,20}$/.test(id) ? null : "Enter a valid tax ID (5–20 letters/digits).";
}
