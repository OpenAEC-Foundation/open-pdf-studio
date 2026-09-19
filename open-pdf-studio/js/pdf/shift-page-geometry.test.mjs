import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_SHIFT_MM, MM_TO_POINTS, applyOcrShift, normalizeRotation, resolveTargetPages, shiftAnnotation,
  shiftOcrWords, shiftOffsetPoints, visualToContentOffset,
} from "./shift-page-geometry.js";

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

// ── Annotations move with the page ──
//
// The app's move primitive lives in annotations/transforms.js, which cannot be
// imported under plain node (it pulls in core/state.ts). Its field-walker is
// self-contained, so the test evaluates that block straight from the source:
// this way it fails when a position-bearing field is dropped from the real
// tables, not from a copy of them.
function loadApplyMoveGeneric() {
  const source = readFileSync(new URL("../annotations/transforms.js", import.meta.url), "utf8");
  const start = source.indexOf("const _MOVE_SCALAR_PAIRS");
  const end = source.indexOf("// Apply move to annotation");
  assert.ok(start > 0 && end > start,
    "transforms.js layout changed: update the markers around applyMoveGeneric in this test");
  const block = source.slice(start, end).replace("export function applyMoveGeneric", "function applyMoveGeneric");
  return new Function(`${block}; return applyMoveGeneric;`)();
}

test("every position-bearing field of an annotation moves with the page", () => {
  const applyMoveGeneric = loadApplyMoveGeneric();
  const dx = 28.35, dy = 14.17;
  const samples = {
    box: { type: "box", x: 100, y: 100, width: 50, height: 20 },
    measureAngle: { type: "measureAngle", point1: { x: 10, y: 10 }, vertex: { x: 20, y: 20 }, point2: { x: 30, y: 10 } },
    spline: { type: "spline", controlPoints: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    measureDistance: {
      type: "measureDistance", startX: 100, startY: 100, endX: 300, endY: 100,
      leaderStartX: 100, leaderStartY: 80, leaderEndX: 300, leaderEndY: 80, labelX: 200, labelY: 70,
    },
    measureArea: {
      type: "measureArea", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
      holes: [[{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }]],
    },
    textbox: {
      type: "textbox", x: 50, y: 50, width: 80, height: 30,
      leaders: [{ tipX: 10, tipY: 10, kneeX: 30, kneeY: 30 }],
    },
    highlight: {
      type: "highlight", rects: [{ x: 5, y: 5, width: 40, height: 10 }],
      quadPoints: [[5, 5, 45, 5, 5, 15, 45, 15]],
    },
    ink: { type: "draw", path: [{ x: 1, y: 1 }, { x: 2, y: 3 }] },
    circle: { type: "circle", cx: 40, cy: 60, radius: 10 },
  };

  // Every number that is a coordinate, as [path, axis] — collected before the move.
  const coordinates = (value, path = []) => {
    if (typeof value === "number") return [[path, value]];
    if (value && typeof value === "object") {
      return Object.entries(value).flatMap(([k, v]) => coordinates(v, [...path, k]));
    }
    return [];
  };
  const isSize = (key) => ["width", "height", "radius"].includes(key);
  const axisOf = (path) => {
    const key = String(path[path.length - 1]);
    if (/^\d+$/.test(key)) return Number(key) % 2 === 0 ? "x" : "y"; // flat quadPoints
    return /x$/i.test(key) ? "x" : "y";
  };

  for (const [label, original] of Object.entries(samples)) {
    const moved = structuredClone(original);
    shiftAnnotation(moved, dx, dy, applyMoveGeneric);
    const before = coordinates(original);
    const after = new Map(coordinates(moved).map(([p, v]) => [p.join("."), v]));
    for (const [path, value] of before) {
      const expected = isSize(path[path.length - 1]) ? value : value + (axisOf(path) === "x" ? dx : dy);
      assert.ok(Math.abs(after.get(path.join(".")) - expected) < 1e-9, `${label}: ${path.join(".")} did not move with the page`);
    }
  }
});

test("a callout's arrow tip and knee move too, unlike an interactive move", () => {
  const calls = [];
  const callout = { type: "callout", x: 100, y: 100, width: 80, height: 30, arrowX: 20, arrowY: 200, kneeX: 60, kneeY: 150 };
  shiftAnnotation(callout, 10, -5, (ann, dx, dy) => { calls.push([dx, dy]); ann.x += dx; ann.y += dy; });
  assert.deepEqual(calls, [[10, -5]], "the generic primitive is used exactly once");
  assert.deepEqual(
    [callout.x, callout.y, callout.arrowX, callout.arrowY, callout.kneeX, callout.kneeY],
    [110, 95, 30, 195, 70, 145],
  );
});

test("a zero shift leaves the annotation untouched", () => {
  const ann = { x: 1, y: 2 };
  shiftAnnotation(ann, 0, 0, () => { throw new Error("must not be called"); });
  assert.deepEqual(ann, { x: 1, y: 2 });
});

// ── Pending OCR results follow the page ──

test("OCR word boxes move by the visual offset and keep their other fields", () => {
  const words = [{ text: "MARKER", left: 100, top: 200, width: 60, height: 12, confidence: 91 }];
  const moved = shiftOcrWords(words, 28.35, 14.17);
  assert.deepEqual(moved, [{ text: "MARKER", left: 128.35, top: 214.17, width: 60, height: 12, confidence: 91 }]);
  assert.equal(words[0].left, 100, "the input is not mutated");
});

test("only the OCR results of shifted pages move, and undo puts them back", () => {
  const ocrResults = {
    1: [{ text: "a", left: 10, top: 10, width: 5, height: 5 }],
    2: [{ text: "b", left: 20, top: 20, width: 5, height: 5 }],
  };
  const ocrShift = { pages: [2, 3], dx: 28.35, dy: -14.17 }; // page 3 has no OCR result
  applyOcrShift(ocrResults, ocrShift, 1);
  assert.deepEqual(ocrResults[1], [{ text: "a", left: 10, top: 10, width: 5, height: 5 }]);
  assert.ok(Math.abs(ocrResults[2][0].left - 48.35) < 1e-9 && Math.abs(ocrResults[2][0].top - 5.83) < 1e-9);
  assert.equal(ocrResults[3], undefined);

  // An OCR run made after the shift must survive the undo (offset, not snapshot).
  ocrResults[1] = [{ text: "new", left: 1, top: 1, width: 5, height: 5 }];
  applyOcrShift(ocrResults, ocrShift, -1);
  assert.ok(Math.abs(ocrResults[2][0].left - 20) < 1e-9 && Math.abs(ocrResults[2][0].top - 20) < 1e-9);
  assert.equal(ocrResults[1][0].text, "new");
});

test("a command without an OCR shift (insert, delete, reorder) changes nothing", () => {
  const ocrResults = { 1: [{ text: "a", left: 10, top: 10, width: 5, height: 5 }] };
  applyOcrShift(ocrResults, undefined, -1);
  applyOcrShift(undefined, { pages: [1], dx: 1, dy: 1 }, 1);
  assert.deepEqual(ocrResults[1][0], { text: "a", left: 10, top: 10, width: 5, height: 5 });
});

// ── The requested offset ──

test("millimetres become a visual offset in points, y down", () => {
  const offset = shiftOffsetPoints(10, 5); // 10 mm right, 5 mm UP on screen
  assert.ok(Math.abs(offset.dx - 28.3464567) < 1e-6);
  assert.ok(Math.abs(offset.dy + 14.1732283) < 1e-6);
  assert.deepEqual(shiftOffsetPoints(0, -5), { dx: 0, dy: 5 * MM_TO_POINTS });
});

test("no offset, or no number at all, means there is nothing to do", () => {
  for (const [dx, dy] of [[0, 0], [undefined, null], [0.0001, 0], [NaN, NaN], ["abc", ""]]) {
    assert.equal(shiftOffsetPoints(dx, dy), null, `${dx}, ${dy}`);
  }
  assert.equal(shiftOffsetPoints(Infinity, 0), null);
  assert.equal(shiftOffsetPoints(0, -Infinity), null);
});

test("an absurd offset is bounded and never reaches the file as an exponent", () => {
  const offset = shiftOffsetPoints(1e308, -1e308);
  assert.equal(offset.dx, MAX_SHIFT_MM * MM_TO_POINTS);
  assert.equal(offset.dy, MAX_SHIFT_MM * MM_TO_POINTS);
  assert.ok(Number.isFinite(offset.dx) && !String(offset.dx).includes("e"));
});
