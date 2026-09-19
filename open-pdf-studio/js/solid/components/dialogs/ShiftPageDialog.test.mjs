import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The dialog is a Solid component and does not run under plain node; these are
// guard rails on its source for behaviour that broke before and that no other
// test can see. The logic itself lives in pdf/shift-page-geometry.js.
const source = readFileSync(new URL("./ShiftPageDialog.jsx", import.meta.url), "utf8");

test("the number fields are not bound to their signals", () => {
  // value={dxMm()} rewrites the field on every keystroke and eats a typed "-".
  assert.doesNotMatch(source, /value=\{\s*d[xy]Mm\(\)\s*\}/);
  assert.doesNotMatch(source, /value=\{\s*fromPage\(\)\s*\}/);
  assert.match(source, /parseShiftInput\(e\.target\.value\)/);
  assert.match(source, /parseFromPageInput\(e\.target\.value, totalPages\)/);
});

test("'All pages' starts at page 1 unless the user says otherwise", () => {
  assert.match(source, /\[fromPage, setFromPage\] = createSignal\(1\)/);
});

test("a failing shift is reported, not swallowed", () => {
  const apply = source.slice(source.indexOf("const handleApply"), source.indexOf("const footer"));
  assert.match(apply, /try \{[\s\S]*shiftPages\([\s\S]*\} catch \(/);
  assert.match(apply, /shiftPage\.failed/);
  assert.match(apply, /shiftPage\.encrypted/);
  assert.match(apply, /shiftPage\.noPages/);
});

test("house rules: default cursor, left button only, theme colours", () => {
  assert.doesNotMatch(source, /cursor\s*:/, "no cursor override outside the PDF view");
  assert.match(source, /if \(e\.button !== 0\) return;/);
  assert.doesNotMatch(source, /border-radius|transition|animation/);
  assert.match(source, /var\(--theme-border/);
  assert.match(source, /var\(--theme-bg/);
});

test("the preview is rendered at the size it is shown, not at a fixed scale", () => {
  assert.doesNotMatch(source, /renderPageOffscreen\(currentPage, 1\.5\)/);
  assert.match(source, /renderPageOffscreen\(currentPage, layout\.scale\)/);
});
