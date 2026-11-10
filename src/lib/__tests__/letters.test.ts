import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LETTER_KIND_LABEL, buildLetter, isLetterKind, letterParagraphs, type LetterInput } from "../letters";

const input: LetterInput = {
  companyName: "Acme LLC",
  employee: { name: "Asha Rao", code: "EMP-0007", designation: "Analyst", department: "Finance", joinDate: "1 Jan 2024", exitDate: "30 Jun 2026" },
  issuedOn: "1 Jul 2026",
  annualPackage: "AED 120,000",
  salaryLines: [
    { label: "Basic", monthly: "AED 6,000", annual: "AED 72,000" },
    { label: "Housing", monthly: "AED 4,000", annual: "AED 48,000" },
  ],
};

describe("buildLetter", () => {
  it("produces a subject and body for every kind using employee data", () => {
    for (const kind of Object.keys(LETTER_KIND_LABEL) as (keyof typeof LETTER_KIND_LABEL)[]) {
      const l = buildLetter(kind, input);
      assert.ok(l.subject.length > 0);
      assert.ok(l.body.includes("Asha Rao") || kind === "relieving", kind);
      assert.ok(l.body.includes("Acme LLC"));
    }
  });
  it("includes salary lines in salary certificate and offer", () => {
    assert.match(buildLetter("salary_certificate", input).body, /Housing: AED 4,000 per month/);
    assert.match(buildLetter("offer", input).body, /Basic: AED 6,000/);
  });
  it("uses exit date for experience and relieving letters", () => {
    assert.match(buildLetter("experience", input).body, /until 30 Jun 2026/);
    assert.match(buildLetter("relieving", input).body, /30 Jun 2026/);
    assert.match(buildLetter("experience", { ...input, employee: { ...input.employee, exitDate: null } }).body, /to date/);
  });
  it("hard-codes no currency symbols or country-specific legal wording", () => {
    for (const kind of Object.keys(LETTER_KIND_LABEL) as (keyof typeof LETTER_KIND_LABEL)[]) {
      const l = buildLetter(kind, { ...input, annualPackage: null, salaryLines: [] });
      assert.doesNotMatch(l.body, /₹|\bINR\b|\bRs\.|\bPF\b|gratuity|Shops/i);
    }
  });
});

describe("helpers", () => {
  it("validates kinds", () => {
    assert.equal(isLetterKind("noc"), true);
    assert.equal(isLetterKind("toString"), false);
    assert.equal(isLetterKind(null), false);
  });
  it("splits paragraphs", () => {
    assert.deepEqual(letterParagraphs("a\nb\n\n\n c \n\n"), ["a\nb", "c"]);
  });
});
