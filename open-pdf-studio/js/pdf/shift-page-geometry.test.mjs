import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRotation, resolveTargetPages, visualToContentOffset } from "./shift-page-geometry.js";

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

// ── Visual offset → content-space offset ──
//
// Reference model: a point (x, y) in unrotated content space (y up) on a
// W x H page is displayed, for a clockwise /Rotate R, at the visual position
// below (x right, y down). Shifting the content by (cx, cy) must move every
// displayed point by exactly the requested visual offset.
function displayed(x, y, W, H, R) {
  switch (R) {
    case 90: return { x: y, y: x };
    case 180: return { x: W - x, y: y };
    case 270: return { x: H - y, y: W - x };
    default: return { x, y: H - y };
  }
}

test("a visual offset lands where the preview showed it, at every rotation", () => {
  const W = 595, H = 842;
  const vx = 28.35, vyDown = 14.17; // 10 mm right, 5 mm down on screen
  for (const R of [0, 90, 180, 270]) {
    const { cx, cy } = visualToContentOffset(vx, vyDown, R);
    const before = displayed(100, 200, W, H, R);
    const after = displayed(100 + cx, 200 + cy, W, H, R);
    assert.ok(Math.abs(after.x - before.x - vx) < 1e-9, `R=${R}: horizontal`);
    assert.ok(Math.abs(after.y - before.y - vyDown) < 1e-9, `R=${R}: vertical`);
  }
});

test("an unrotated page keeps the plain (dx, -dy) mapping", () => {
  assert.deepEqual(visualToContentOffset(10, 5, 0), { cx: 10, cy: -5 });
});

test("native and in-app rotation add up, in any notation", () => {
  assert.deepEqual(visualToContentOffset(10, 5, 90 + 90), visualToContentOffset(10, 5, 180));
  assert.deepEqual(visualToContentOffset(10, 5, 270 + 180), visualToContentOffset(10, 5, 90));
  assert.deepEqual(visualToContentOffset(10, 5, -90), visualToContentOffset(10, 5, 270));
  assert.equal(normalizeRotation(360), 0);
  assert.equal(normalizeRotation(undefined), 0);
  assert.equal(normalizeRotation(450), 90);
});
