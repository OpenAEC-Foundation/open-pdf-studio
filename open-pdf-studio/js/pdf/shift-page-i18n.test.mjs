import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every locale carries the Shift Page strings, really translated.
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "../i18n/locales");

const readJson = (locale, file) => JSON.parse(readFileSync(join(LOCALES, locale, file), "utf8"));
const shiftPage = (locale) => readJson(locale, "dialogs.json").shiftPage || {};

// Words that really are the same as in English in that language.
const SAME_AS_ENGLISH = {
  ca: ["Vertical (mm):"],
  es: ["Horizontal (mm):", "Vertical (mm):"],
  id: ["Horizontal (mm):"],
  pt: ["Horizontal (mm):", "Vertical (mm):"],
  ro: ["Vertical (mm):"],
};

test("all 39 locales have the same Shift Page keys as English, none empty", () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 39);
  const en = shiftPage("en");
  assert.ok(Object.keys(en).length >= 17);
  for (const locale of locales) {
    const block = shiftPage(locale);
    assert.deepEqual(Object.keys(block).sort(), Object.keys(en).sort(), locale);
    for (const [key, text] of Object.entries(block)) {
      assert.ok(typeof text === "string" && text.trim().length > 0, `${locale} shiftPage.${key} is empty`);
    }
    assert.ok(readJson(locale, "ribbon.json").organize?.shiftPage, `${locale} ribbon organize.shiftPage`);
  }
});

test("no locale copies the English text", () => {
  const en = shiftPage("en");
  const copied = [];
  for (const locale of readdirSync(LOCALES)) {
    if (locale === "en") continue;
    const allowed = new Set(SAME_AS_ENGLISH[locale] || []);
    const block = shiftPage(locale);
    for (const [key, text] of Object.entries(en)) {
      if (block[key] === text && !allowed.has(text)) copied.push(`${locale} shiftPage.${key}: ${text}`);
    }
  }
  assert.deepEqual(copied, []);
});

test("the dialog title is the label of the ribbon button that opens it", () => {
  for (const locale of readdirSync(LOCALES)) {
    assert.equal(shiftPage(locale).title, readJson(locale, "ribbon.json").organize.shiftPage, locale);
  }
});

test("every Shift Page key used in the code exists", () => {
  const sources = [
    join(HERE, "shift-page.js"),
    join(HERE, "../solid/components/dialogs/ShiftPageDialog.jsx"),
  ].map((file) => readFileSync(file, "utf8")).join("\n");
  const used = [...sources.matchAll(/['"`]shiftPage\.(\w+)['"`]/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  const en = shiftPage("en");
  for (const key of used) assert.ok(en[key], `shiftPage.${key} is used in the code but missing from the locales`);
});
