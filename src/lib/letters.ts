/** Pure HR letter templates (no server-only imports). Callers pass pre-formatted dates and money. */

export const LETTER_KIND_LABEL = {
  offer: "Offer letter",
  appointment: "Appointment letter",
  experience: "Experience certificate",
  relieving: "Relieving letter",
  salary_certificate: "Salary certificate",
  noc: "No-objection certificate",
} as const;

export type LetterKindKey = keyof typeof LETTER_KIND_LABEL;

export function isLetterKind(v: string | null | undefined): v is LetterKindKey {
  return !!v && Object.hasOwn(LETTER_KIND_LABEL, v);
}

export type SalaryLine = { label: string; monthly: string; annual: string };

export type LetterInput = {
  companyName: string;
  employee: {
    name: string;
    code: string;
    designation: string;
    department?: string | null;
    employmentType?: string | null;
    workLocation?: string | null;
    /** Formatted dates. */
    joinDate: string;
    exitDate?: string | null;
    probationEndDate?: string | null;
  };
  issuedOn: string;
  /** Formatted annual package (CTC / gross), when known. */
  annualPackage?: string | null;
  salaryLines?: SalaryLine[];
};

const dept = (i: LetterInput) => (i.employee.department ? ` in the ${i.employee.department} department` : "");

function salaryTable(i: LetterInput) {
  const lines = i.salaryLines ?? [];
  if (!lines.length) return i.annualPackage ? `Annual package: ${i.annualPackage}` : "";
  const rows = lines.map((l) => `- ${l.label}: ${l.monthly} per month (${l.annual} per year)`);
  return ["Salary structure:", ...rows].join("\n");
}

function sign(i: LetterInput) {
  return `Yours sincerely,\nFor ${i.companyName}`;
}

/** Subject + plain-text body (paragraphs separated by blank lines) for a letter kind. */
export function buildLetter(kind: LetterKindKey, i: LetterInput): { subject: string; body: string } {
  const e = i.employee;
  const co = i.companyName;
  switch (kind) {
    case "offer": {
      const parts = [
        `Dear ${e.name},`,
        `We are pleased to offer you the position of ${e.designation}${dept(i)} at ${co}, with a proposed date of joining of ${e.joinDate}${e.workLocation ? `. Your place of work will be ${e.workLocation}` : ""}.`,
        i.annualPackage || i.salaryLines?.length ? `Your compensation will be as follows.\n${salaryTable(i)}` : "",
        "This offer is subject to satisfactory verification of your documents and references, and to the company's policies as updated from time to time. Please sign and return a copy of this letter to confirm your acceptance.",
        `We look forward to welcoming you to ${co}.`,
        sign(i),
      ];
      return { subject: `Offer of employment — ${e.designation}`, body: parts.filter(Boolean).join("\n\n") };
    }
    case "appointment": {
      const parts = [
        `Dear ${e.name},`,
        `With reference to your acceptance of our offer, we are pleased to confirm your appointment as ${e.designation}${dept(i)} at ${co} (employee ID ${e.code}) with effect from ${e.joinDate}.`,
        e.probationEndDate ? `You will be on probation until ${e.probationEndDate}, after which your continuation will be reviewed.` : "",
        i.annualPackage || i.salaryLines?.length ? salaryTable(i) : "",
        "Your employment is governed by the terms of your employment contract and the company's policies, as applicable under the laws of the country in which you are employed.",
        sign(i),
      ];
      return { subject: `Appointment letter — ${e.designation}`, body: parts.filter(Boolean).join("\n\n") };
    }
    case "experience": {
      const end = e.exitDate ? `until ${e.exitDate}` : "to date";
      return {
        subject: "Experience certificate",
        body: [
          "To whom it may concern,",
          `This is to certify that ${e.name} (employee ID ${e.code}) has been employed with ${co} as ${e.designation}${dept(i)} from ${e.joinDate} ${end}.`,
          `During this period we found ${e.name} to be diligent and sincere in the discharge of their duties.`,
          `We wish ${e.name} every success in future endeavours.`,
          sign(i),
        ].join("\n\n"),
      };
    }
    case "relieving": {
      return {
        subject: "Relieving letter",
        body: [
          `Dear ${e.name},`,
          `This is to confirm that your resignation has been accepted and that you stand relieved from your duties as ${e.designation}${dept(i)} at ${co} (employee ID ${e.code}) at the close of working hours on ${e.exitDate ?? i.issuedOn}.`,
          "You joined the company on " + e.joinDate + ". We confirm that, as of the date of this letter, no obligations remain outstanding from your side other than those stated in your employment terms.",
          `We thank you for your contribution and wish you the very best.`,
          sign(i),
        ].join("\n\n"),
      };
    }
    case "salary_certificate": {
      return {
        subject: "Salary certificate",
        body: [
          "To whom it may concern,",
          `This is to certify that ${e.name} (employee ID ${e.code}) is employed with ${co} as ${e.designation}${dept(i)} since ${e.joinDate}, and is currently drawing the following remuneration.`,
          salaryTable(i) || "Compensation details are available on request.",
          "This certificate is issued at the request of the employee for whatever purpose it may serve, without any liability on the part of the company.",
          sign(i),
        ].join("\n\n"),
      };
    }
    case "noc": {
      return {
        subject: "No-objection certificate",
        body: [
          "To whom it may concern,",
          `This is to certify that ${e.name} (employee ID ${e.code}) is employed with ${co} as ${e.designation}${dept(i)} since ${e.joinDate}.`,
          `${co} has no objection to ${e.name} proceeding with the purpose for which this certificate is requested. This letter does not alter the terms of employment.`,
          sign(i),
        ].join("\n\n"),
      };
    }
  }
}

/** Split frozen letter text into paragraphs on blank lines. */
export function letterParagraphs(body: string) {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
