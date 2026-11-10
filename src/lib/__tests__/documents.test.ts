import assert from "node:assert/strict";
import { test } from "node:test";
import { detectMime, sanitizeFilename } from "../documents";

test("detectMime uses magic bytes", () => {
  assert.equal(detectMime(Buffer.from("%PDF-1.7 x")), "application/pdf");
  assert.equal(detectMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
  assert.equal(detectMime(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.match(detectMime(Buffer.from("PK\x03\x04....word/document.xml")) ?? "", /wordprocessingml/);
});

test("detectMime rejects unsupported content", () => {
  assert.equal(detectMime(Buffer.from("<script>alert(1)</script>")), null);
  assert.equal(detectMime(Buffer.from("PK\x03\x04 plain zip")), null);
  assert.equal(detectMime(Buffer.alloc(0)), null);
});

test("sanitizeFilename strips paths and bad characters", () => {
  assert.equal(sanitizeFilename("..\\..\\evil\"\r\n.exe", "application/pdf"), "evil_.pdf");
  assert.equal(sanitizeFilename("", "image/png"), "document.png");
  assert.equal(sanitizeFilename("Passport scan.JPG", "image/jpeg"), "Passport scan.jpg");
});
