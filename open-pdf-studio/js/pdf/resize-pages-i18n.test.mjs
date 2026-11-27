import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The Resize Pages strings, including the margins (#1291), in every locale.
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "../i18n/locales");
const DIALOG = readFileSync(join(HERE, "../solid/components/dialogs/ResizePagesDialog.jsx"), "utf8");

const resizePages = (locale) =>
  JSON.parse(readFileSync(join(LOCALES, locale, "dialogs.json"), "utf8")).resizePages || {};

const placeholders = (text) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

test("every locale has the same Resize Pages keys as English, none empty", () => {
  const en = resizePages("en");
  for (const key of ["margins", "marginsOdd", "marginsEven", "marginLeft", "marginRight", "marginTop", "marginBottom", "differentEven"]) {
    assert.ok(en[key], `en resizePages.${key}`);
  }
  for (const locale of readdirSync(LOCALES)) {
    const block = resizePages(locale);
    assert.deepEqual(Object.keys(block).sort(), Object.keys(en).sort(), locale);
    for (const [key, text] of Object.entries(block)) {
      assert.ok(typeof text === "string" && text.trim().length > 0, `${locale} resizePages.${key} is empty`);
    }
  }
});

test("every locale keeps the values that are filled in", () => {
  const en = resizePages("en");
  for (const locale of readdirSync(LOCALES)) {
    const block = resizePages(locale);
    for (const [key, text] of Object.entries(en)) {
      assert.deepEqual(placeholders(block[key]), placeholders(text), `${locale} resizePages.${key}`);
    }
  }
});

test("every Resize Pages key used in the dialog exists", () => {
  const used = [...DIALOG.matchAll(/['"`]resizePages\.(\w+)['"`]/g)].map((m) => m[1]);
  assert.ok(used.length >= 20);
  const en = resizePages("en");
  for (const key of used) assert.ok(en[key], `resizePages.${key} is used in the dialog but missing from the locales`);
});

test("the validation messages get the values they name", () => {
  const en = resizePages("en");
  assert.deepEqual(placeholders(en.marginsTooWide), ["min", "size"]);
  assert.deepEqual(placeholders(en.marginsTooHigh), ["min", "size"]);
  assert.deepEqual(placeholders(en.marginsEvenPages), ["message"]);
  assert.match(DIALOG, /t\('resizePages\.marginsTooWide', \{ size: mm\(w\), min: MIN_CONTENT_AREA_MM \}\)/);
  assert.match(DIALOG, /t\('resizePages\.marginsTooHigh', \{ size: mm\(h\), min: MIN_CONTENT_AREA_MM \}\)/);
  assert.match(DIALOG, /t\('resizePages\.marginsEvenPages', \{ message \}\)/);
});

test("the dialog hands the margins to the resize and keeps the dialog open on a margin error", () => {
  // The margins go along as the sixth argument; without any margin that is null.
  assert.match(DIALOG, /resizePages\(applyToVal, rangeVal, w, h, scaleContent\(\), marginsVal\)/);
  assert.match(DIALOG, /hasMargins\(sets\.odd\) \|\| hasMargins\(sets\.even\) \? sets : null/);
  // A margin error returns before the dialog is closed.
  const handler = DIALOG.slice(DIALOG.indexOf("const handleResize"));
  assert.ok(handler.indexOf("if (marginError()) return;") >= 0);
  assert.ok(handler.indexOf("if (marginError()) return;") < handler.indexOf("close();"));
  // The even set only counts while its checkbox is on.
  assert.match(DIALOG, /even: differentEven\(\) \? evenMargins\(\) : null/);
});
