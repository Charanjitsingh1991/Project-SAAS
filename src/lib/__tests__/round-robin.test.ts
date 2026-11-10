import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUserIds, pickNext } from "../round-robin";

test("pickNext starts at the lowest id and cycles in order", () => {
  assert.equal(pickNext([5, 2, 9], null), 2);
  assert.equal(pickNext([5, 2, 9], 2), 5);
  assert.equal(pickNext([5, 2, 9], 5), 9);
  assert.equal(pickNext([5, 2, 9], 9), 2);
});

test("pickNext handles a departed last assignee and empty pools", () => {
  assert.equal(pickNext([2, 9], 5), 9);
  assert.equal(pickNext([2, 9], 20), 2);
  assert.equal(pickNext([], 3), null);
  assert.equal(pickNext([7], 7), 7);
  assert.equal(pickNext([4, 4, 6], 4), 6);
});

test("parseUserIds tolerates bad input", () => {
  assert.deepEqual(parseUserIds("[1,2,3]"), [1, 2, 3]);
  assert.deepEqual(parseUserIds('[1,"x",2.5]'), [1]);
  assert.deepEqual(parseUserIds("nope"), []);
  assert.deepEqual(parseUserIds('{"a":1}'), []);
  assert.deepEqual(parseUserIds(null), []);
});
