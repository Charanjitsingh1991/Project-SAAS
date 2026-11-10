/** All money is stored as integer minor units (paise / cents). */

export function formatMoney(minor: number, currency = "INR", opts: { decimals?: boolean } = {}) {
  const showDecimals = opts.decimals ?? minor % 100 !== 0;
  return new Intl.NumberFormat(localeFor(currency), {
    style: "currency",
    currency,
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(minor / 100);
}

const LOCALES: Record<string, string> = { INR: "en-IN", AED: "en-AE", USD: "en-US", EUR: "en-IE", GBP: "en-GB" };
export function localeFor(currency: string) {
  return LOCALES[currency] ?? "en-US";
}

/** Compact form for KPI tiles: ₹4.8L, ₹1.2Cr, $12.4K. */
export function formatMoneyCompact(minor: number, currency = "INR") {
  const major = minor / 100;
  if (currency === "INR") {
    const abs = Math.abs(major);
    if (abs >= 1e7) return `₹${(major / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
    if (abs >= 1e5) return `₹${(major / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
    return formatMoney(Math.round(major) * 100, currency);
  }
  return new Intl.NumberFormat(localeFor(currency), { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(major);
}

/** "1,234.5" | "1234" | 1234.5 (major units) → minor units integer. */
export function toMinor(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,\s₹$€£]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** Minor units → plain major-unit number for form defaultValues. */
export function fromMinor(minor: number | null | undefined) {
  return (minor ?? 0) / 100;
}

/** Tax on an amount: percent may be fractional; rounds once to the minor unit. */
export function taxOf(amountMinor: number, ratePercent: number) {
  return Math.round((amountMinor * ratePercent) / 100);
}

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function twoDigits(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`;
}
function threeDigits(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} hundred` : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
}

/** Amount in words, Indian system for INR (lakh/crore), international otherwise. */
export function amountInWords(minor: number, currency = "INR") {
  const major = Math.floor(Math.abs(minor) / 100);
  const fraction = Math.abs(minor) % 100;
  let words: string;
  if (major === 0) words = "zero";
  else if (currency === "INR") {
    const crore = Math.floor(major / 1e7);
    const lakh = Math.floor((major % 1e7) / 1e5);
    const thousand = Math.floor((major % 1e5) / 1e3);
    const rest = major % 1e3;
    words = [
      crore ? `${threeDigits(crore)} crore` : "",
      lakh ? `${twoDigits(lakh)} lakh` : "",
      thousand ? `${twoDigits(thousand)} thousand` : "",
      rest ? threeDigits(rest) : "",
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    const parts: string[] = [];
    const scales = ["", "thousand", "million", "billion"];
    let n = major;
    let i = 0;
    while (n > 0) {
      const chunk = n % 1000;
      if (chunk) parts.unshift(`${threeDigits(chunk)}${scales[i] ? ` ${scales[i]}` : ""}`);
      n = Math.floor(n / 1000);
      i++;
    }
    words = parts.join(" ");
  }
  const UNITS: Record<string, [string, string]> = { INR: ["rupees", "paise"], AED: ["UAE dirhams", "fils"], USD: ["US dollars", "cents"], EUR: ["euros", "cents"], GBP: ["pounds", "pence"] };
  const unit = UNITS[currency] ?? [currency, "cents"];
  const out = `${words} ${unit[0]}${fraction ? ` and ${twoDigits(fraction)} ${unit[1]}` : ""} only`;
  return out.charAt(0).toUpperCase() + out.slice(1);
}
