import type { CountryPack } from "./types";

export const UAE: CountryPack = {
  code: "AE",
  name: "United Arab Emirates",
  flag: "🇦🇪",
  currency: "AED",
  currencyName: { major: "dirhams", minor: "fils" },
  locale: "en-AE",
  timezone: "Asia/Dubai",
  phone: { code: "+971", pattern: "^\\+971(5[024568]\\d{7}|[234679]\\d{7})$", example: "+971 50 123 4567" },
  regionLabel: "Emirate",
  regions: ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"],
  fiscalYearStartMonth: 1,
  weekendDays: [0, 6],
  tax: {
    name: "VAT",
    idLabel: "TRN",
    idPattern: "^100\\d{12}$",
    idExample: "100123456700003",
    rates: [
      { code: "SR", rate: 5, label: "Standard rated 5%", kind: "standard" },
      { code: "ZR", rate: 0, label: "Zero rated 0%", kind: "zero" },
      { code: "EX", rate: 0, label: "Exempt", kind: "exempt" },
    ],
    defaultCode: "SR",
    split(taxAmount, rate) {
      return taxAmount ? [{ label: `VAT ${rate}%`, rate, amount: taxAmount }] : [];
    },
    invoiceTitle: "Tax Invoice",
    inputAccountName: "VAT recoverable",
    outputAccountName: "VAT payable",
    returnName: "VAT return (VAT 201)",
  },
  corporateTax: {
    rate: 9,
    threshold: 375_000_00,
    note: "UAE corporate tax: 0% up to AED 375,000 of taxable income, 9% above. Small Business Relief may apply for revenue ≤ AED 3m (tax periods ending on or before 31 Dec 2026). Estimate only — not a filed return.",
  },
  company: { registrationLabel: "Trade licence no." },
  statutoryOrgFields: [
    { key: "mohreEstablishmentId", label: "MOHRE establishment ID", placeholder: "1234567890123", pattern: "^\\d{13}$", patternHint: "13 digits" },
    { key: "wpsRoutingCode", label: "WPS bank routing code (agent)", placeholder: "602620101", pattern: "^\\d{9}$", patternHint: "9 digits" },
    { key: "tradeLicence", label: "Trade licence no.", placeholder: "CN-1234567" },
  ],
  hr: {
    employeeFields: [
      { key: "nationality", label: "Nationality", type: "country", section: "identity" },
      { key: "emiratesId", label: "Emirates ID", type: "text", placeholder: "784-1990-1234567-1", pattern: "^784-?\\d{4}-?\\d{7}-?\\d$", patternHint: "784-YYYY-NNNNNNN-N", sensitive: true, section: "identity" },
      { key: "emiratesIdExpiry", label: "Emirates ID expiry", type: "date", section: "identity" },
      { key: "passportNumber", label: "Passport no.", type: "text", placeholder: "N1234567", uppercase: true, section: "identity" },
      { key: "passportExpiry", label: "Passport expiry", type: "date", section: "identity" },
      { key: "visaNumber", label: "Residence visa no.", type: "text", placeholder: "201/2025/1234567", section: "work_permit" },
      { key: "visaExpiry", label: "Visa expiry", type: "date", section: "work_permit" },
      { key: "labourCardNumber", label: "Labour card / work permit no.", type: "text", placeholder: "12345678", section: "work_permit" },
      { key: "wpsPersonId", label: "MOHRE person ID (WPS)", type: "text", placeholder: "10012345678901", pattern: "^\\d{14}$", patternHint: "14 digits", section: "work_permit" },
      { key: "iban", label: "IBAN", type: "text", placeholder: "AE070331234567890123456", pattern: "^AE\\d{21}$", patternHint: "AE + 21 digits", uppercase: true, sensitive: true, section: "bank" },
      { key: "bankName", label: "Bank name", type: "text", placeholder: "Emirates NBD", section: "bank" },
      { key: "bankRoutingCode", label: "Bank routing code", type: "text", placeholder: "302620122", pattern: "^\\d{9}$", patternHint: "9 digits", section: "bank" },
    ],
    // UAE Labour Law (Federal Decree-Law 33 of 2021).
    leaveTypes: [
      { name: "Annual leave", code: "AL", annualQuota: 30, payPercent: 100, appliesTo: "all", color: "lime" },
      { name: "Sick leave (full pay)", code: "SL", annualQuota: 15, payPercent: 100, appliesTo: "all", color: "sky" },
      { name: "Sick leave (half pay)", code: "SLH", annualQuota: 30, payPercent: 50, appliesTo: "all", color: "butter" },
      { name: "Maternity leave", code: "ML", annualQuota: 60, payPercent: 100, appliesTo: "female", color: "lilac" },
      { name: "Parental leave", code: "PRL", annualQuota: 5, payPercent: 100, appliesTo: "all", color: "peach" },
      { name: "Bereavement leave", code: "BL", annualQuota: 5, payPercent: 100, appliesTo: "all", color: "mint" },
      { name: "Unpaid leave", code: "UL", annualQuota: 0, payPercent: 0, appliesTo: "all", color: "rose" },
    ],
    holidays(year) {
      const fixed = [
        { date: `${year}-01-01`, name: "New Year's Day" },
        { date: `${year}-12-01`, name: "Commemoration Day" },
        { date: `${year}-12-02`, name: "National Day" },
        { date: `${year}-12-03`, name: "National Day holiday" },
      ];
      // Islamic holidays follow moon sighting; dates are tentative and editable.
      const lunar: Record<number, { date: string; name: string }[]> = {
        2026: [
          { date: "2026-03-19", name: "Eid al-Fitr (tentative)" },
          { date: "2026-03-20", name: "Eid al-Fitr holiday (tentative)" },
          { date: "2026-03-21", name: "Eid al-Fitr holiday (tentative)" },
          { date: "2026-05-26", name: "Arafat Day (tentative)" },
          { date: "2026-05-27", name: "Eid al-Adha (tentative)" },
          { date: "2026-05-28", name: "Eid al-Adha holiday (tentative)" },
          { date: "2026-05-29", name: "Eid al-Adha holiday (tentative)" },
          { date: "2026-06-16", name: "Islamic New Year (tentative)" },
          { date: "2026-08-25", name: "Prophet Muhammad's Birthday (tentative)" },
        ],
        2027: [
          { date: "2027-03-09", name: "Eid al-Fitr (tentative)" },
          { date: "2027-03-10", name: "Eid al-Fitr holiday (tentative)" },
          { date: "2027-03-11", name: "Eid al-Fitr holiday (tentative)" },
          { date: "2027-05-15", name: "Arafat Day (tentative)" },
          { date: "2027-05-16", name: "Eid al-Adha (tentative)" },
          { date: "2027-05-17", name: "Eid al-Adha holiday (tentative)" },
          { date: "2027-05-18", name: "Eid al-Adha holiday (tentative)" },
          { date: "2027-06-06", name: "Islamic New Year (tentative)" },
          { date: "2027-08-14", name: "Prophet Muhammad's Birthday (tentative)" },
        ],
      };
      return [...fixed, ...(lunar[year] ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    },
    probationMonths: 6,
    noticeDays: 30,
    hoursPerWeek: 48,
  },
  payroll: {
    engine: "AE",
    components: [
      { code: "basic", label: "Basic salary" },
      { code: "housing", label: "Housing allowance" },
      { code: "transport", label: "Transport allowance" },
      { code: "other", label: "Other allowances" },
    ],
    defaultSplit: { basic: 0.6, housing: 0.25, transport: 0.1, other: 0.05 },
    statutoryNote: "No personal income tax. GPSSA pension for UAE nationals: 11% employee + 12.5% employer on basic + housing + transport (AED 3,000–100,000). End-of-service gratuity accrues monthly on basic salary: 21 days per year for the first 5 years, 30 days per year after.",
    salaryFileName: "WPS salary information file (SIF)",
  },
};
