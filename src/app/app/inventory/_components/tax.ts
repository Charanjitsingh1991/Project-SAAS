import type { CountryPack } from "@/lib/countries";
import { defaultTaxRate } from "@/lib/countries";

/** Plain, client-safe tax settings for inventory forms (packs contain functions). */
export type InventoryTax = { name: string; idLabel: string; idExample: string; rates: number[]; defaultRate: number };

export function inventoryTax(pack: CountryPack): InventoryTax {
  return {
    name: pack.tax.name,
    idLabel: pack.tax.idLabel,
    idExample: pack.tax.idExample,
    rates: [...new Set(pack.tax.rates.map((r) => r.rate))].sort((a, b) => a - b),
    defaultRate: defaultTaxRate(pack),
  };
}
