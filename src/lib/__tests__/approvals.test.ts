import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canDecideRequest, parseRegularizationTimes, pickRecipients, regularizationDateError } from "../approvals";

const base = { hrm: false, actorEmployeeId: 5, subjectEmployeeId: 9, subjectManagerId: 5, requestStatus: "pending" };

describe("canDecideRequest", () => {
  it("lets a reporting manager decide a direct report's pending request", () => {
    assert.deepEqual(canDecideRequest(base), { ok: true, via: "manager" });
  });
  it("rejects a manager on non-pending requests and on non-reports", () => {
    assert.equal(canDecideRequest({ ...base, requestStatus: "approved" }).ok, false);
    assert.equal(canDecideRequest({ ...base, subjectManagerId: 7 }).ok, false);
    assert.equal(canDecideRequest({ ...base, actorEmployeeId: null }).ok, false);
  });
  it("lets HR decide others but never their own", () => {
    assert.deepEqual(canDecideRequest({ ...base, hrm: true, subjectManagerId: null }), { ok: true, via: "hrm" });
    assert.equal(canDecideRequest({ ...base, hrm: true, subjectEmployeeId: 5 }).ok, false);
  });
  it("blocks a manager approving their own request", () => {
    assert.equal(canDecideRequest({ ...base, subjectEmployeeId: 5, subjectManagerId: 5 }).ok, false);
  });
});

describe("regularizationDateError", () => {
  const today = "2026-11-10";
  it("accepts today and recent past dates", () => {
    assert.equal(regularizationDateError("2026-11-10", today), null);
    assert.equal(regularizationDateError("2026-10-11", today), null);
  });
  it("rejects future, too-old and invalid dates", () => {
    assert.ok(regularizationDateError("2026-11-11", today));
    assert.ok(regularizationDateError("2026-10-10", today));
    assert.ok(regularizationDateError("2026-13-01", today));
  });
});

describe("parseRegularizationTimes", () => {
  it("normalises blanks and validates order", () => {
    assert.deepEqual(parseRegularizationTimes("", ""), { checkIn: null, checkOut: null });
    assert.deepEqual(parseRegularizationTimes("09:30", "18:00"), { checkIn: "09:30", checkOut: "18:00" });
    assert.ok(parseRegularizationTimes("18:00", "09:00").error);
    assert.ok(parseRegularizationTimes("9am", "").error);
  });
});

describe("pickRecipients", () => {
  it("dedupes, excludes the requester and caps", () => {
    assert.deepEqual(pickRecipients(["A@x.com", "a@x.com", null, "b@x.com", "me@x.com", "bad"], ["ME@x.com"]), ["A@x.com", "b@x.com"]);
    assert.equal(pickRecipients(["1@x", "2@x", "3@x"], [], 2).length, 2);
  });
});
