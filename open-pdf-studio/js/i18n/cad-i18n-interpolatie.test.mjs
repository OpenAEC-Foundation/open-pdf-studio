import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// De CAD-teksten (#400) in alle 39 talen: elke taal heeft precies de sleutels
// van het Engels, en elke tekst gebruikt precies de {{variabelen}} van de
// Engelse tekst. Een variabele die in een vertaling ontbreekt of anders
// heet, geeft in de app een lege of kapotte regel ("{{n}} objecten" zonder n),
// en dat valt alleen op in die ene taal.

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "locales");
const BLOKKEN = ["cadImport", "cadExport"];

const lees = (taal) => JSON.parse(readFileSync(join(LOCALES, taal, "dialogs.json"), "utf8"));
const variabelen = (tekst) => [...new Set(String(tekst).match(/\{\{\s*\w+\s*\}\}/g) || [])].map((v) => v.replace(/\s/g, "")).sort();

const talen = readdirSync(LOCALES).sort();
const en = lees("en");

test("there are 39 languages and English carries both CAD blocks", () => {
  assert.equal(talen.length, 39);
  for (const blok of BLOKKEN) assert.ok(Object.keys(en[blok] || {}).length > 50, blok);
});

for (const blok of BLOKKEN) {
  test(`${blok}: every language has exactly the English keys`, () => {
    const verwacht = Object.keys(en[blok]).sort();
    const afwijkend = [];
    for (const taal of talen) {
      const sleutels = Object.keys(lees(taal)[blok] || {}).sort();
      const ontbreekt = verwacht.filter((k) => !sleutels.includes(k));
      const teveel = sleutels.filter((k) => !verwacht.includes(k));
      if (ontbreekt.length || teveel.length) afwijkend.push(`${taal}: ontbreekt ${ontbreekt.join(",") || "-"}; te veel ${teveel.join(",") || "-"}`);
    }
    assert.deepEqual(afwijkend, []);
  });

  test(`${blok}: every text uses exactly the {{variables}} of the English text`, () => {
    const fouten = [];
    for (const taal of talen) {
      const teksten = lees(taal)[blok] || {};
      for (const [sleutel, engels] of Object.entries(en[blok])) {
        const tekst = teksten[sleutel];
        if (typeof tekst !== "string" || !tekst.trim()) {
          fouten.push(`${taal} ${blok}.${sleutel}: leeg`);
          continue;
        }
        const a = variabelen(engels);
        const b = variabelen(tekst);
        if (a.join(" ") !== b.join(" ")) fouten.push(`${taal} ${blok}.${sleutel}: ${b.join(" ") || "-"} (en: ${a.join(" ") || "-"})`);
        // Een half geschreven variabele ("{{n}" of "{n}}") komt letterlijk in beeld.
        if (/\{\{[^}]*$|^[^{]*\}\}|\{[^{]\w*\}\}|\{\{\w*[^}]\}/.test(tekst.replace(/\{\{\w+\}\}/g, ""))) fouten.push(`${taal} ${blok}.${sleutel}: kapotte accolades in "${tekst}"`);
      }
    }
    assert.deepEqual(fouten, []);
  });
}
