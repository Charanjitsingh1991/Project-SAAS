import assert from "node:assert/strict";
import { test } from "node:test";
import { canAssign, canSetStatus, warrantyState } from "../assets";

test("canAssign only allows available assets", () => {
  assert.equal(canAssign("available"), null);
  for (const s of ["assigned", "in_repair", "retired"] as const) assert.ok(canAssign(s));
});

test("canSetStatus blocks assigned transitions", () => {
  assert.equal(canSetStatus("available", "in_repair"), null);
  assert.ok(canSetStatus("available", "assigned"));
  assert.ok(canSetStatus("assigned", "retired"));
});

test("warrantyState", () => {
  assert.equal(warrantyState(null, "2026-01-01"), "none");
  assert.equal(warrantyState("2025-12-31", "2026-01-01"), "expired");
  assert.equal(warrantyState("2026-01-31", "2026-01-01"), "expiring");
  assert.equal(warrantyState("2026-02-01", "2026-01-01"), "ok");
});
