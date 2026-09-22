import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every locale carries the DXF/DWG export strings, really translated (#400).
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "../i18n/locales");

const readJson = (locale, file) => JSON.parse(readFileSync(join(LOCALES, locale, file), "utf8"));
const block = (locale) => readJson(locale, "dialogs.json").cadExport || {};
const placeholders = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort();

// Texts that are the same in every language: axis names and an SI unit.
const SAME_EVERYWHERE = new Set(["X / Y (mm)"]);

// Words that really are the same as in English in that language.
const SAME_AS_ENGLISH = {
  ca: ["General", "Format:", "DXF (text)"],
  da: ["Format:", "Version:", "Stop"],
  de: ["Format:", "Version:"],
  es: ["General"],
  fr: ["Annotation"],
  hr: ["Format:"],
  id: ["Area", "Area:", "Format:", "Viewport {{name}} ({{scale}})"],
  it: ["Area", "Area:", "File:"],
  ms: ["Format:"],
  nb: ["Format:"],
  nl: ["Viewport {{name}} ({{scale}})"],
  pl: ["Format:"],
  ro: ["General", "Format:", "DXF (text)"],
  sv: ["Format:", "Version:", "DXF (text)"],
};

test("all 39 locales have the same DXF/DWG export keys as English, none empty", () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 39);
  const en = block("en");
  assert.ok(Object.keys(en).length >= 80);
  for (const locale of locales) {
    const b = block(locale);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(en).sort(), locale);
    for (const [key, text] of Object.entries(b)) {
      assert.ok(typeof text === "string" && text.trim().length > 0, `${locale} cadExport.${key} is empty`);
      assert.deepEqual(placeholders(text), placeholders(en[key]), `${locale} cadExport.${key} placeholders`);
    }
    const menu = readJson(locale, "appMenu.json").exportPanel || {};
    assert.ok(menu.exportCad && menu.exportCadDesc, `${locale} appMenu exportPanel.exportCad`);
    const ribbon = readJson(locale, "ribbon.json").home || {};
    assert.ok(ribbon.cadExport && ribbon.cadExportTitle, `${locale} ribbon home.cadExport`);
  }
});

test("no locale copies the English export text", () => {
  const en = block("en");
  const copied = [];
  for (const locale of readdirSync(LOCALES)) {
    if (locale === "en") continue;
    const allowed = new Set([...(SAME_AS_ENGLISH[locale] || []), ...SAME_EVERYWHERE]);
    const b = block(locale);
    for (const [key, text] of Object.entries(en)) {
      if (b[key] === text && !allowed.has(text)) copied.push(`${locale} cadExport.${key}: ${text}`);
    }
  }
  assert.deepEqual(copied, []);
});

test("numbers in the export dialog follow the app language, not the system language", () => {
  const source = readFileSync(join(HERE, "../solid/components/dialogs/CadExportDialog.jsx"), "utf8");
  const code = source.split("\n").filter((r) => !r.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /\.toLocaleString\(\)/, "toLocaleString() without a language takes navigator.language");
  assert.match(source, /getalTekst\(n, language\(\)\)/);
  // Geen hardgecodeerde labels naast vertaalde: het venster-label komt uit de talen.
  assert.doesNotMatch(source, />X \/ Y \(mm\)</);
});

test("every export key used in the code exists", () => {
  const sources = [
    join(HERE, "cad-export.js"),
    join(HERE, "../solid/components/dialogs/CadExportDialog.jsx"),
  ].map((file) => readFileSync(file, "utf8")).join("\n");
  const used = new Set([...sources.matchAll(/['"`]cadExport\.(\w+)['"`]/g)].map((m) => m[1]));
  // Sleutels die via een opgebouwde naam gebruikt worden.
  for (const tab of ["general", "layers", "area", "geometry"]) used.add(`tab_${tab}`);
  for (const k of ["phaseLoad", "phaseExtract", "phaseBuild", "phaseWrite", "areaRegion", "areaViewport", "areaPdf"]) used.add(k);
  const en = block("en");
  for (const key of used) assert.ok(en[key], `cadExport.${key} is used in the code but missing from the locales`);
});

test("house rules in the export dialog: no cursor, no rounded corners, no animations", () => {
  const source = readFileSync(join(HERE, "../solid/components/dialogs/CadExportDialog.jsx"), "utf8");
  assert.doesNotMatch(source, /cursor\s*:/);
  assert.doesNotMatch(source, /border-radius|transition|animation/);
  const css = readFileSync(join(HERE, "../../styles/dialogs.css"), "utf8");
  const cadCss = css.slice(css.indexOf("/* CAD-uitwisseling"));
  assert.ok(cadCss.length > 100);
  assert.doesNotMatch(cadCss, /cursor\s*:/);
  assert.doesNotMatch(cadCss, /border-radius\s*:\s*[1-9]/);
  assert.doesNotMatch(cadCss, /transition|animation/);
});
