import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTargetPages } from "./shift-page-geometry.js";

test("'current' ignores fromPage and returns only the current page", () => {
  assert.deepEqual(resolveTargetPages("current", 5, 3, 10), [3]);
});

test("'all' from page 1 returns every page", () => {
  assert.deepEqual(resolveTargetPages("all", 1, 1, 5), [1, 2, 3, 4, 5]);
});

test("'all' from a later page returns only pages from there on", () => {
  assert.deepEqual(resolveTargetPages("all", 3, 1, 5), [3, 4, 5]);
});

test("'even' selects only even page numbers from the start page", () => {
  assert.deepEqual(resolveTargetPages("even", 1, 1, 8), [2, 4, 6, 8]);
});

test("'odd' selects only odd page numbers from the start page", () => {
  assert.deepEqual(resolveTargetPages("odd", 1, 1, 8), [1, 3, 5, 7]);
});

test("'even' from an even start page includes that page", () => {
  assert.deepEqual(resolveTargetPages("even", 4, 1, 8), [4, 6, 8]);
});

test("fromPage is clamped into [1, totalPages]", () => {
  assert.deepEqual(resolveTargetPages("all", 0, 1, 3), [1, 2, 3]);
  assert.deepEqual(resolveTargetPages("all", 99, 1, 3), [3]);
});
