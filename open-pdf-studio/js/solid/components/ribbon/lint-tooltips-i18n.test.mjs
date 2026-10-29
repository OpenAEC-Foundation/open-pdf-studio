// Tooltips in het lint komen uit de vertalingen (#831). "Tellen", "Arc" en
// "Toolpalette" stonden als vaste tekst in de knoppen.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const LOCALES = new URL('../../../i18n/locales/', import.meta.url);

test('tellen, boog en gereedschapspalet gebruiken een vertaalsleutel', () => {
  const tekenen = lees('./DrawingTab.jsx');
  assert.match(tekenen, /id="dr-count" title=\{t\('drawing\.count'\)\}/);
  assert.match(tekenen, /id="dr-arc" title=\{t\('drawing\.arc'\)\}/);
  const beeld = lees('./ViewTab.jsx');
  assert.match(beeld, /id="ribbon-symbol-palette" title=\{t\('view\.toolPalette'\)\}[^\n]*label=\{t\('view\.toolPaletteLabel'\)\}/);
  for (const bestand of ['./DrawingTab.jsx', './ViewTab.jsx']) {
    assert.doesNotMatch(lees(bestand), /title="(Tellen|Arc|Toolpalette)"/, bestand);
  }
});

test('elke taal heeft drawing.count en drawing.arc', () => {
  const talen = fs.readdirSync(LOCALES);
  assert.ok(talen.length >= 40);
  for (const taal of talen) {
    const d = JSON.parse(fs.readFileSync(new URL(`${taal}/ribbon.json`, LOCALES), 'utf8'));
    assert.ok(d.drawing?.count, `${taal}: drawing.count`);
    assert.ok(d.drawing?.arc, `${taal}: drawing.arc`);
  }
  const en = JSON.parse(fs.readFileSync(new URL('en/ribbon.json', LOCALES), 'utf8'));
  const nl = JSON.parse(fs.readFileSync(new URL('nl/ribbon.json', LOCALES), 'utf8'));
  assert.equal(en.drawing.count, 'Count');
  assert.equal(nl.drawing.count, 'Tellen');
});
