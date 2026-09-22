import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every locale carries the DWG/DXF import strings, really translated (#400).
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "../i18n/locales");

const readJson = (locale, file) => JSON.parse(readFileSync(join(LOCALES, locale, file), "utf8"));
const block = (locale) => readJson(locale, "dialogs.json").cadImport || {};
const placeholders = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort();

// Words that really are the same as in English in that language.
const SAME_AS_ENGLISH = {
  ca: ["Text"],
  cs: ["Minimum:", "Text"],
  da: ["Rotation:", "Minimum:", "Stop"],
  de: ["Minimum:", "Text"],
  fr: ["portrait"],
  hr: ["Minimum:"],
  hu: ["Minimum:"],
  id: ["Area:", "Margin:", "Area: {{width}} × {{height}} mm", "Minimum:"],
  it: ["Area:", "Area: {{width}} × {{height}} mm"],
  ms: ["Minimum:", "Import", "unit {{unit}} ({{source}})"],
  nb: ["Minimum:"],
  nl: ["{{n}} viewports", "Minimum:"],
  pl: ["Minimum:"],
  ro: ["Text", "Include"],
  sk: ["Minimum:", "Text"],
  sv: ["Rotation:", "Minimum:", "Text"],
  tr: ["Minimum:"],
};

// Teksten die al in alle talen staan voor een deel van het importvenster dat
// in een latere stap gebouwd wordt (#400). De test hieronder eist dat een
// sleutel van deze lijst af gaat zodra de code hem gebruikt; nu is zij leeg.
// De bestanden waaruit het importvenster bestaat.
const VENSTER = [
  "../solid/components/dialogs/CadImportDialog.jsx",
  "../solid/components/dialogs/CadImportWeergave.jsx",
  "../solid/components/dialogs/CadImportPreview.jsx",
];

const NOG_NIET_IN_HET_VENSTER = [];

test("all 39 locales have the same DWG/DXF import keys as English, none empty", () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 39);
  const en = block("en");
  assert.ok(Object.keys(en).length >= 180);
  for (const locale of locales) {
    const b = block(locale);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(en).sort(), locale);
    for (const [key, text] of Object.entries(b)) {
      assert.ok(typeof text === "string" && text.trim().length > 0, `${locale} cadImport.${key} is empty`);
      assert.deepEqual(placeholders(text), placeholders(en[key]), `${locale} cadImport.${key} placeholders`);
    }
    const menu = readJson(locale, "appMenu.json").importPanel || {};
    assert.ok(menu.importCad && menu.importCadDesc, `${locale} appMenu importPanel.importCad`);
  }
  // De Engelse brontekst is wat elke volgende vertaler leest: "to scale", niet "on scale".
  assert.doesNotMatch(readJson("en", "appMenu.json").importPanel.importCadDesc, /\bon scale\b/);
  assert.doesNotMatch(Object.values(en).join("\n"), /\bon scale\b/);
});

test("no locale copies the English import text", () => {
  const en = block("en");
  const enMenu = readJson("en", "appMenu.json").importPanel;
  const copied = [];
  for (const locale of readdirSync(LOCALES)) {
    if (locale === "en") continue;
    const allowed = new Set(SAME_AS_ENGLISH[locale] || []);
    const b = block(locale);
    for (const [key, text] of Object.entries(en)) {
      if (b[key] === text && !allowed.has(text)) copied.push(`${locale} cadImport.${key}: ${text}`);
    }
    const menu = readJson(locale, "appMenu.json").importPanel;
    for (const key of ["importCad", "importCadDesc"]) {
      if (menu[key] === enMenu[key]) copied.push(`${locale} importPanel.${key}: ${menu[key]}`);
    }
  }
  assert.deepEqual(copied, []);
});

test("every import key used in the code exists", () => {
  const read = (file) => readFileSync(join(HERE, file), "utf8");
  const dialog = VENSTER.map(read).join("\n");
  const logic = read("cad-import-logica.js");
  const used = new Set([...dialog.matchAll(/['"`]cadImport\.(\w+)['"`]/g)].map((m) => m[1]));
  // Sleutels die via een opgebouwde naam gebruikt worden.
  for (const m of dialog.matchAll(/const TABS = \[([^\]]+)\]/g)) {
    for (const tab of m[1].match(/'(\w+)'/g)) used.add(`tab_${tab.slice(1, -1)}`);
  }
  for (const m of dialog.matchAll(/\b(phase\w+)'/g)) used.add(m[1]);
  for (const m of dialog.matchAll(/label: '(\w+)'/g)) used.add(m[1]);
  // Foutsleutels uit leesImportFout.
  for (const m of logic.matchAll(/sleutel: '(\w+)'/g)) used.add(m[1]);
  // Waarschuwingscodes van de crate (verkenning en omzetting).
  const crate = ["mod.rs", "scan.rs"]
    .map((f) => readFileSync(join(HERE, "../../../open-pdf-cad/src/import", f), "utf8"))
    .join("\n");
  const codes = new Set([
    ...[...crate.matchAll(/format!\("(\w+):\{/g)].map((m) => m[1]),
    ...[...crate.matchAll(/warnings\.push\("(\w+)"/g)].map((m) => m[1]),
  ]);
  assert.ok(codes.size >= 10, `found only ${[...codes]}`);
  for (const code of codes) {
    if (code.startsWith("IMPORT_")) continue;
    used.add(`warn_${code}`);
  }
  const en = block("en");
  for (const key of used) assert.ok(en[key], `cadImport.${key} is used in the code but missing from the locales`);
  // Omgekeerd: geen dode sleutels in de talen. Teksten voor een deel van het
  // venster dat nog gebouwd wordt staan in NOG_NIET_IN_HET_VENSTER; zodra de
  // code ze gebruikt, moeten ze van die lijst af.
  for (const key of NOG_NIET_IN_HET_VENSTER) {
    assert.ok(en[key], `cadImport.${key} is reserved but missing from the locales`);
    assert.ok(!used.has(key), `cadImport.${key} is used now: take it off the reserved list`);
  }
  const reserved = new Set(NOG_NIET_IN_HET_VENSTER);
  for (const key of Object.keys(en)) {
    assert.ok(used.has(key) || reserved.has(key), `cadImport.${key} is in the locales but never used`);
  }
});

// zh is Simplified Chinese; a Traditional character in the CAD blocks means a
// translation slipped in from the wrong script (#400).
const TRADITIONEEL = [..."圖匯檔視儲選顯邊線紙預頁標註點層開關進導寬單個數參樣縮轉換繪塊對齊體顏為應圍來東讀寫產項條處適裡兩隱聯錯訊執內輸檢複製復點"];

test("the Chinese CAD texts are written in simplified characters", () => {
  const blokken = {
    "dialogs.json cadImport": readJson("zh", "dialogs.json").cadImport,
    "dialogs.json cadExport": readJson("zh", "dialogs.json").cadExport,
    "appMenu.json importPanel": Object.fromEntries(
      Object.entries(readJson("zh", "appMenu.json").importPanel).filter(([k]) => k.toLowerCase().includes("cad")),
    ),
    "appMenu.json exportPanel": Object.fromEntries(
      Object.entries(readJson("zh", "appMenu.json").exportPanel || {}).filter(([k]) => k.toLowerCase().includes("cad")),
    ),
    "ribbon.json home": Object.fromEntries(
      Object.entries(readJson("zh", "ribbon.json").home || {}).filter(([k]) => k.toLowerCase().includes("cad")),
    ),
  };
  const gevonden = [];
  for (const [waar, blok] of Object.entries(blokken)) {
    for (const [key, text] of Object.entries(blok || {})) {
      const fout = TRADITIONEEL.filter((c) => String(text).includes(c));
      if (fout.length) gevonden.push(`${waar} ${key}: ${fout.join("")} in "${text}"`);
    }
  }
  assert.deepEqual(gevonden, []);
});

// zh and ja write their own punctuation full-width (，、；：（）) next to Han
// and kana; an ASCII comma or bracket glued to a Han character is a slip.
test("the Chinese and Japanese CAD texts use full-width punctuation next to Han and kana", () => {
  const cjk = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
  const naast = new RegExp(`[${cjk}][,;:()]|[,;:()][${cjk}]`, "gu");
  const gevonden = [];
  for (const locale of ["zh", "ja"]) {
    const d = readJson(locale, "dialogs.json");
    for (const [blok, teksten] of Object.entries({ cadImport: d.cadImport, cadExport: d.cadExport })) {
      for (const [key, text] of Object.entries(teksten || {})) {
        const fout = String(text).match(naast);
        if (fout) gevonden.push(`${locale} ${blok}.${key}: ${fout.join(" ")} in "${text}"`);
      }
    }
  }
  assert.deepEqual(gevonden, []);
});

test("house rules in the import dialog: no cursor, no rounded corners, no animations", () => {
  for (const file of VENSTER) {
    const source = readFileSync(join(HERE, file), "utf8");
    assert.doesNotMatch(source, /cursor\s*:/, file);
    assert.doesNotMatch(source, /border-radius|transition|animation/, file);
  }
});

test("the layer list is a table for screen readers: header row with column headers that carry the sort state, cells per layer", () => {
  const source = readFileSync(join(HERE, "../solid/components/dialogs/CadImportDialog.jsx"), "utf8");
  const lijst = source.slice(source.indexOf('class="cad-layer-list"'), source.indexOf("cadImport.layersSelected"));
  assert.match(lijst, /class="cad-layer-list" role="table"/);
  assert.doesNotMatch(lijst, /role="list(item)?"/);
  assert.match(lijst, /class="cad-layer-head" role="row"/);
  assert.match(lijst, /class="cad-layer-row" role="row"/);
  // aria-sort alleen op een kolomkop, en elke kolomkop heeft een naam.
  for (const m of lijst.matchAll(/<(\w+)([^>]*aria-sort=[^>]*)>/g)) {
    assert.match(m[2], /role="columnheader"/, m[0]);
  }
  const koppen = [...lijst.matchAll(/role="columnheader"[^>]*/g)].map((m) => m[0]);
  assert.ok(koppen.length >= 2);
  for (const kop of koppen) assert.match(kop, /aria-label=/, kop);
  assert.ok((lijst.match(/role="cell"/g) || []).length >= 5);
});

test("the CAD dialogs never grow past the app window: close and footer buttons stay reachable", () => {
  const css = readFileSync(join(HERE, "../../styles/dialogs.css"), "utf8");
  const dialog = css.match(/\.cad-dialog \{[^}]*max-width: calc\(100vw - \d+px\)[^}]*max-height: calc\(100vh - \d+px\)[^}]*\}/);
  assert.ok(dialog, ".cad-dialog needs a max-width and max-height in viewport units");
  assert.match(css, /\.cad-body \{[^}]*overflow-y: auto[^}]*\}/, "the body scrolls when the dialog is clamped");
  assert.match(css, /\.cad-voorbeeld \{[^}]*flex: 0 1 \d+px[^}]*\}/, "the preview column shrinks");
});

test("the CAD block uses logical directions, so Arabic, Hebrew, Persian and Urdu mirror without a rule per class", () => {
  const css = readFileSync(join(HERE, "../../styles/dialogs.css"), "utf8");
  const cadCss = css.slice(css.indexOf("/* CAD-uitwisseling"));
  // Regel voor regel, zodat de melding de regel noemt. Het afgekapte pad
  // (.cad-path) draait bewust de richting om en krijgt zijn spiegel in rtl.css.
  const fysiek = cadCss.split("\n").filter((r) => /(margin|padding)-(left|right)\s*:|text-align:\s*(left|right)\b/.test(r) && !r.includes(".cad-path"));
  assert.deepEqual(fysiek, []);
  const rtl = readFileSync(join(HERE, "../../styles/rtl.css"), "utf8");
  assert.match(rtl, /\[dir="rtl"\] \.cad-path/);
});
