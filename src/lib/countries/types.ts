/** Client-safe country pack contract. Every country-specific rule in the app comes from a CountryPack. */

export type CountryCode = "IN" | "AE";

export type TaxRateOption = {
  /** Stable code stored on lines (drives return boxes). */
  code: string;
  rate: number; // percent
  label: string;
  /** Category for returns: standard (taxable), zero (0% but taxable supply), exempt (outside tax). */
  kind: "standard" | "zero" | "exempt";
};

export type TaxSplitLine = { label: string; rate: number; amount: number };

export type EmployeeFieldDef = {
  /** Column on `employees`. */
  key:
    | "pan" | "uan" | "bankAccount" | "ifsc" | "nationality" | "passportNumber" | "passportExpiry" | "visaNumber" | "visaExpiry"
    | "emiratesId" | "emiratesIdExpiry" | "labourCardNumber" | "wpsPersonId" | "iban" | "bankName" | "bankRoutingCode";
  label: string;
  type: "text" | "date" | "country";
  placeholder?: string;
  /** Regex source (validated server-side when a value is given). */
  pattern?: string;
  patternHint?: string;
  uppercase?: boolean;
  /** Shown masked in lists/headers. */
  sensitive?: boolean;
  section: "identity" | "bank" | "work_permit";
};

export type OrgStatutoryField = { key: string; label: string; placeholder?: string; pattern?: string; patternHint?: string };

export type LeaveTypeDefault = {
  name: string;
  code: string;
  annualQuota: number;
  payPercent: number; // 100 full, 50 half, 0 unpaid
  appliesTo: "all" | "female" | "male";
  color: string;
};

export type HolidayDefault = { date: string; name: string; optional?: boolean };

export type SalaryComponentDef = { code: string; label: string };

export type CountryPack = {
  code: CountryCode;
  name: string;
  flag: string;
  currency: "INR" | "AED";
  currencyName: { major: string; minor: string };
  locale: string;
  timezone: string;
  phone: { code: string; pattern: string; example: string };
  regionLabel: string;
  regions: readonly string[];
  fiscalYearStartMonth: number;
  weekendDays: number[];
  tax: {
    name: "GST" | "VAT";
    idLabel: string;
    idPattern: string;
    idExample: string;
    rates: TaxRateOption[];
    defaultCode: string;
    /** Same-region invoices split the tax (India CGST+SGST); otherwise a single line. */
    split(taxAmount: number, rate: number, placeOfSupply: string | null | undefined, orgRegion: string | null | undefined): TaxSplitLine[];
    invoiceTitle: string;
    inputAccountName: string;
    outputAccountName: string;
    returnName: string;
  };
  corporateTax?: { rate: number; threshold: number; note: string };
  company: { registrationLabel: string };
  statutoryOrgFields: OrgStatutoryField[];
  hr: {
    employeeFields: EmployeeFieldDef[];
    leaveTypes: LeaveTypeDefault[];
    holidays(year: number): HolidayDefault[];
    probationMonths: number;
    noticeDays: number;
    hoursPerWeek: number;
  };
  payroll: {
    engine: CountryCode;
    components: SalaryComponentDef[];
    /** Default share of monthly package per component (sums to 1). */
    defaultSplit: Record<string, number>;
    statutoryNote: string;
    salaryFileName: string;
  };
};
