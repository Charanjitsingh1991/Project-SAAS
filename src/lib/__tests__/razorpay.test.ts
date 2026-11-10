import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { appPaymentMethod, parsePaymentLinkPaid, paymentLinkReference, razorpayMode, verifyWebhookSignature, whatsappNumber, whatsappUrl } from "../razorpay";

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("hex");

describe("verifyWebhookSignature", () => {
  const body = '{"event":"payment_link.paid"}';
  it("accepts a valid signature", () => assert.equal(verifyWebhookSignature(body, sign(body, "s3cret"), "s3cret"), true));
  it("rejects wrong secret, tampered body, missing or malformed signatures", () => {
    assert.equal(verifyWebhookSignature(body, sign(body, "other"), "s3cret"), false);
    assert.equal(verifyWebhookSignature(body + " ", sign(body, "s3cret"), "s3cret"), false);
    assert.equal(verifyWebhookSignature(body, null, "s3cret"), false);
    assert.equal(verifyWebhookSignature(body, "zz", "s3cret"), false);
    assert.equal(verifyWebhookSignature(body, "", "s3cret"), false);
  });
});

describe("parsePaymentLinkPaid", () => {
  const ok = { event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_1" } }, payment: { entity: { id: "pay_1", amount: 150000, currency: "INR", method: "upi" } } } };
  it("extracts ids and amount", () => assert.deepEqual(parsePaymentLinkPaid(ok), { linkId: "plink_1", paymentId: "pay_1", amount: 150000, currency: "INR", method: "upi" }));
  it("ignores other events and malformed payloads", () => {
    assert.equal(parsePaymentLinkPaid({ ...ok, event: "payment_link.expired" }), null);
    assert.equal(parsePaymentLinkPaid(null), null);
    assert.equal(parsePaymentLinkPaid({ event: "payment_link.paid", payload: {} }), null);
    assert.equal(parsePaymentLinkPaid({ ...ok, payload: { ...ok.payload, payment: { entity: { id: "p", amount: 0 } } } }), null);
    assert.equal(parsePaymentLinkPaid({ ...ok, payload: { ...ok.payload, payment: { entity: { id: "p", amount: "100" } } } }), null);
  });
});

describe("helpers", () => {
  it("maps methods", () => {
    assert.equal(appPaymentMethod("upi"), "upi");
    assert.equal(appPaymentMethod("card"), "card");
    assert.equal(appPaymentMethod("netbanking"), "bank_transfer");
    assert.equal(appPaymentMethod(null), "bank_transfer");
  });
  it("detects mode", () => {
    assert.equal(razorpayMode("rzp_test_abc"), "test");
    assert.equal(razorpayMode("rzp_live_abc"), "live");
    assert.equal(razorpayMode("x"), null);
  });
  it("builds references within 40 chars", () => {
    const r = paymentLinkReference("INV/2026/" + "9".repeat(60), "ab12cd34");
    assert.equal(r.length, 40);
    assert.match(r, /^[A-Za-z0-9_.-]+-ab12cd34$/);
  });
  it("normalises whatsapp numbers", () => {
    assert.equal(whatsappNumber("+971 50 123 4567"), "971501234567");
    assert.equal(whatsappNumber("098765 43210", "91"), "919876543210");
    assert.equal(whatsappNumber("9876543210", "91"), "919876543210");
    assert.equal(whatsappNumber("12"), null);
    assert.equal(whatsappNumber(null), null);
  });
  it("builds wa.me urls", () => {
    assert.equal(whatsappUrl("a b&c", "919876543210"), "https://wa.me/919876543210?text=a%20b%26c");
    assert.equal(whatsappUrl("hi"), "https://wa.me/?text=hi");
  });
});
