export const MAX_DOC_BYTES = 4 * 1024 * 1024;

export const DOC_TYPE_LABELS = {
  passport: "Passport",
  visa: "Visa / residence permit",
  national_id: "National ID (Emirates ID, Aadhaar, …)",
  tax_id: "Tax ID (PAN, …)",
  contract: "Contract",
  certificate: "Certificate",
  other: "Other",
} as const;

export type DocType = keyof typeof DOC_TYPE_LABELS;

export const DOC_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.docx";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  [DOCX]: "docx",
};

/** Detect the real MIME type from file content; null when unsupported. */
export function detectMime(b: Uint8Array): string | null {
  const at = (i: number, s: string) => i + s.length <= b.length && [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (at(0, "%PDF-")) return "application/pdf";
  if (b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 && Buffer.from(b).includes("word/")) return DOCX;
  return null;
}

/** Safe download filename: no path/control/quote characters; extension matches the detected type. */
export function sanitizeFilename(name: string, mime: string): string {
  const base = name
    .replace(/^.*[\\/]/, "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^\w .()-]+/g, "_")
    .trim()
    .slice(0, 80);
  return `${base || "document"}.${EXT[mime] ?? "bin"}`;
}
