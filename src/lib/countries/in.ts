import type { CountryPack } from "./types";

export const INDIA: CountryPack = {
  code: "IN",
  name: "India",
  flag: "🇮🇳",
  currency: "INR",
  currencyName: { major: "rupees", minor: "paise" },
  locale: "en-IN",
  timezone: "Asia/Kolkata",
  phone: { code: "+91", pattern: "^\\+91[6-9]\\d{9}$", example: "+91 98765 43210" },
  regionLabel: "State",
  regions: [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
    "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
    "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
    "Ladakh", "Lakshadweep", "Puducherry",
  ],
  fiscalYearStartMonth: 4,
  weekendDays: [0, 6],
  tax: {
    name: "GST",
    idLabel: "GSTIN",
    idPattern: "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$",
    idExample: "29ABCDE1234F1Z5",
    // GST 2.0 slabs (effective 22 Sep 2025): 5 %, 18 %, 40 % plus 0 % and 3 % (precious metals).
    rates: [
      { code: "GST18", rate: 18, label: "GST 18%", kind: "standard" },
      { code: "GST5", rate: 5, label: "GST 5%", kind: "standard" },
      { code: "GST40", rate: 40, label: "GST 40%", kind: "standard" },
      { code: "GST3", rate: 3, label: "GST 3%", kind: "standard" },
      { code: "GST0", rate: 0, label: "GST 0% (nil-rated)", kind: "zero" },
      { code: "EXEMPT", rate: 0, label: "Exempt", kind: "exempt" },
    ],
    defaultCode: "GST18",
    split(taxAmount, rate, placeOfSupply, orgRegion) {
      if (!taxAmount) return [];
      const intra = !placeOfSupply || !orgRegion || placeOfSupply === orgRegion;
      if (!intra) return [{ label: `IGST ${rate}%`, rate, amount: taxAmount }];
      const cgst = Math.floor(taxAmount / 2);
      return [
        { label: `CGST ${rate / 2}%`, rate: rate / 2, amount: cgst },
        { label: `SGST ${rate / 2}%`, rate: rate / 2, amount: taxAmount - cgst },
      ];
    },
    invoiceTitle: "Tax Invoice",
    inputAccountName: "GST input credit",
    outputAccountName: "GST payable",
    returnName: "GST summary (GSTR-3B)",
  },
  company: { registrationLabel: "CIN" },
  statutoryOrgFields: [
    { key: "tan", label: "TAN", placeholder: "BLRA12345B", pattern: "^[A-Z]{4}[0-9]{5}[A-Z]$", patternHint: "4 letters, 5 digits, 1 letter" },
    { key: "epfCode", label: "EPF establishment code", placeholder: "KNBNG0012345000" },
    { key: "esicCode", label: "ESIC employer code", placeholder: "53000123450001001" },
    { key: "ptRegistration", label: "Professional tax registration", placeholder: "PTEC123456789" },
  ],
  hr: {
    employeeFields: [
      { key: "pan", label: "PAN", type: "text", placeholder: "ABCDE1234F", pattern: "^[A-Z]{5}[0-9]{4}[A-Z]$", patternHint: "5 letters, 4 digits, 1 letter", uppercase: true, sensitive: true, section: "identity" },
      { key: "uan", label: "UAN (EPF)", type: "text", placeholder: "100123456789", pattern: "^\\d{12}$", patternHint: "12 digits", section: "identity" },
      { key: "bankAccount", label: "Bank account no.", type: "text", placeholder: "50100123456789", pattern: "^\\d{9,18}$", patternHint: "9–18 digits", sensitive: true, section: "bank" },
      { key: "ifsc", label: "IFSC", type: "text", placeholder: "HDFC0001234", pattern: "^[A-Z]{4}0[A-Z0-9]{6}$", patternHint: "e.g. HDFC0001234", uppercase: true, section: "bank" },
      { key: "bankName", label: "Bank name", type: "text", placeholder: "HDFC Bank", section: "bank" },
      { key: "passportNumber", label: "Passport no.", type: "text", placeholder: "N1234567", uppercase: true, section: "identity" },
      { key: "passportExpiry", label: "Passport expiry", type: "date", section: "identity" },
    ],
    leaveTypes: [
      { name: "Casual leave", code: "CL", annualQuota: 12, payPercent: 100, appliesTo: "all", color: "mint" },
      { name: "Sick leave", code: "SL", annualQuota: 12, payPercent: 100, appliesTo: "all", color: "sky" },
      { name: "Earned leave", code: "EL", annualQuota: 15, payPercent: 100, appliesTo: "all", color: "lime" },
      { name: "Maternity leave", code: "ML", annualQuota: 182, payPercent: 100, appliesTo: "female", color: "lilac" },
      { name: "Paternity leave", code: "PL", annualQuota: 15, payPercent: 100, appliesTo: "male", color: "peach" },
      { name: "Leave without pay", code: "LWP", annualQuota: 0, payPercent: 0, appliesTo: "all", color: "rose" },
    ],
    holidays(year) {
      const fixed = [
        { date: `${year}-01-26`, name: "Republic Day" },
        { date: `${year}-05-01`, name: "Labour Day", optional: true },
        { date: `${year}-08-15`, name: "Independence Day" },
        { date: `${year}-10-02`, name: "Gandhi Jayanti" },
        { date: `${year}-12-25`, name: "Christmas" },
      ];
      const festivals: Record<number, { date: string; name: string; optional?: boolean }[]> = {
        2026: [
          { date: "2026-03-04", name: "Holi" },
          { date: "2026-03-21", name: "Id-ul-Fitr" },
          { date: "2026-04-03", name: "Good Friday" },
          { date: "2026-10-20", name: "Dussehra" },
          { date: "2026-11-08", name: "Diwali" },
          { date: "2026-11-24", name: "Guru Nanak Jayanti", optional: true },
        ],
        2027: [
          { date: "2027-03-22", name: "Holi" },
          { date: "2027-03-10", name: "Id-ul-Fitr" },
          { date: "2027-03-26", name: "Good Friday" },
          { date: "2027-10-09", name: "Dussehra" },
          { date: "2027-10-29", name: "Diwali" },
        ],
      };
      return [...fixed, ...(festivals[year] ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    },
    probationMonths: 6,
    noticeDays: 30,
    hoursPerWeek: 48,
  },
  payroll: {
    engine: "IN",
    components: [
      { code: "basic", label: "Basic" },
      { code: "hra", label: "House rent allowance" },
      { code: "special", label: "Special allowance" },
    ],
    defaultSplit: { basic: 0.5, hra: 0.2, special: 0.3 },
    statutoryNote: "PF 12% of basic (wage cap ₹15,000) · ESI 0.75%/3.25% when gross ≤ ₹21,000 · Professional tax ₹200 · TDS under the new regime with ₹75,000 standard deduction and 87A rebate up to ₹12L.",
    salaryFileName: "Bank transfer file",
  },
};
