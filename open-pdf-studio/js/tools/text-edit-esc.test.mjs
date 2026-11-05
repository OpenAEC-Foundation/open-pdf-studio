// Esc in de editor van een tekstvlak (#951): getypte tekst blijft, alleen een
// nieuw vak zonder tekst verdwijnt.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { besluitBijEsc, ESC_BEWAREN, ESC_VERWIJDEREN } from './text-edit-esc.js';

test('een nieuw vak met getypte tekst: Esc bewaart de tekst', () => {
  assert.equal(besluitBijEsc({ nieuw: true, tekst: 'Hallo' }), ESC_BEWAREN);
  assert.equal(besluitBijEsc({ nieuw: true, tekst: 'regel 1\nregel 2' }), ESC_BEWAREN);
});

test('een nieuw vak waar niets in staat: Esc haalt het weg', () => {
  assert.equal(besluitBijEsc({ nieuw: true, tekst: '' }), ESC_VERWIJDEREN);
  assert.equal(besluitBijEsc({ nieuw: true, tekst: '  \n ' }), ESC_VERWIJDEREN);
  assert.equal(besluitBijEsc({ nieuw: true, tekst: undefined }), ESC_VERWIJDEREN);
});

test('een bestaand vak blijft altijd, ook als de tekst leeg werd', () => {
  assert.equal(besluitBijEsc({ nieuw: false, tekst: 'gewijzigd' }), ESC_BEWAREN);
  assert.equal(besluitBijEsc({ nieuw: false, tekst: '' }), ESC_BEWAREN);
  assert.equal(besluitBijEsc({}), ESC_BEWAREN);
});

// De bedrading: de editor leest de tekst uit de DOM vóór Esc, en de
// gereedschappen die een vak neerzetten geven door dat het nieuw is.
test('bedrading: Esc gebruikt het besluit, nieuwe vakken worden zo gemarkeerd', () => {
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const overlay = lees('../solid/components/TextEditOverlay.jsx');
  const esc = overlay.slice(overlay.indexOf("e.key === 'Escape'"), overlay.indexOf("e.key === 'Escape'") + 600);
  assert.match(esc, /syncFromDom\(\)/, 'de DOM-tekst gaat eerst de store in');
  const bewerken = lees('./text-editing.js');
  assert.match(bewerken, /besluitBijEsc\(/);
  assert.match(bewerken, /deleteAnnotationsWithUndo\(/);
  assert.match(lees('./tools/shape-tool.js'), /startTextEditing\(ann, \{ nieuw: true \}\)/);
  assert.match(lees('./tool-dispatcher.js'), /startTextEditing\(ann, \{ nieuw: true \}\)/);
});
