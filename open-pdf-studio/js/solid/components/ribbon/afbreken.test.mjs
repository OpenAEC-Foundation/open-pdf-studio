// Long ribbon labels wrap at the joint of a compound instead of shrinking.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { metAfbreekpunten } from './afbreken.js';

const Z = '­';

test('a Dutch compound gets a soft hyphen at its joint and keeps its case', () => {
  assert.equal(metAfbreekpunten('Schermafbeelding', 'nl'), `Scherm${Z}afbeelding`);
  assert.equal(metAfbreekpunten('SCHERMAFBEELDING', 'nl'), `SCHERM${Z}AFBEELDING`);
  assert.equal(metAfbreekpunten('Eigenschappenpaneel', 'nl-NL'), `Eigenschappen${Z}paneel`);
});

test('other words, punctuation and spacing stay as they are', () => {
  assert.equal(metAfbreekpunten('Linksom draaien', 'nl'), 'Linksom draaien');
  assert.equal(metAfbreekpunten('Pagina passend (Handtekening)', 'nl'), `Pagina passend (Hand${Z}tekening)`);
  assert.equal(metAfbreekpunten('Schermafbeelding', 'en'), 'Schermafbeelding');
  assert.equal(metAfbreekpunten('', 'nl'), '');
  assert.equal(metAfbreekpunten(undefined, 'nl'), undefined);
});

test('removing the soft hyphens gives the translation back', () => {
  const nl = JSON.parse(fs.readFileSync(new URL('../../../i18n/locales/nl/ribbon.json', import.meta.url), 'utf8'));
  const alle = [];
  (function loop(o) {
    for (const v of Object.values(o)) {
      if (typeof v === 'string') alle.push(v);
      else if (v) loop(v);
    }
  })(nl);
  let gebroken = 0;
  for (const tekst of alle) {
    const uit = metAfbreekpunten(tekst, 'nl');
    assert.equal(uit.replaceAll(Z, ''), tekst);
    if (uit !== tekst) gebroken++;
  }
  assert.ok(gebroken > 10, `${gebroken} labels with a break point`);
});

test('every ribbon label goes through the break points', () => {
  for (const f of ['RibbonButton.jsx', 'SplitButton.jsx', 'ColorPickerButton.jsx']) {
    const bron = fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    assert.match(bron, /metAfbreekpunten\(/, f);
  }
});
