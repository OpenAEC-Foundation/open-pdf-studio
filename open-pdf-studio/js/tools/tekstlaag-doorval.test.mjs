// De doorval van het selectiegereedschap naar de tekstlaag liep bij elke
// muisbeweging over alle tekst-spans. De laag onthoudt nu wat er het laatst
// op gezet is; de lus draait alleen opnieuw als er iets te veranderen valt.

import assert from 'node:assert/strict';
import test from 'node:test';
import { pasTekstlaagDoorvalToe, vergeetTekstlaagDoorval } from './tekstlaag-doorval.js';

function laagMet(aantal) {
  const spans = Array.from({ length: aantal }, () => ({ style: { pointerEvents: '', cursor: '' } }));
  return { style: { pointerEvents: '' }, spans, getElementsByTagName: () => spans };
}
const alle = (laag, pe, cursor) => laag.spans.every((s) => s.style.pointerEvents === pe && s.style.cursor === cursor);

test('de eerste keer worden laag en spans gezet, daarna niet meer zolang er niets verandert', () => {
  const laag = laagMet(5);
  assert.equal(pasTekstlaagDoorvalToe(laag, 'none', 'default'), true);
  assert.equal(laag.style.pointerEvents, 'none');
  assert.ok(alle(laag, 'none', 'default'));
  assert.equal(pasTekstlaagDoorvalToe(laag, 'none', 'default'), false);
  assert.equal(pasTekstlaagDoorvalToe(laag, 'none', 'default'), false);
});

test('een andere waarde loopt de spans weer langs', () => {
  const laag = laagMet(4);
  pasTekstlaagDoorvalToe(laag, 'none', 'default');
  assert.equal(pasTekstlaagDoorvalToe(laag, 'auto', 'text'), true);
  assert.equal(laag.style.pointerEvents, 'auto');
  assert.ok(alle(laag, 'auto', 'text'));
  // Alleen de aanwijzer anders.
  assert.equal(pasTekstlaagDoorvalToe(laag, 'auto', 'default'), true);
  assert.ok(alle(laag, 'auto', 'default'));
});

test('nieuwe spans (tekstlaag opnieuw opgebouwd) krijgen de waarde alsnog', () => {
  const laag = laagMet(3);
  pasTekstlaagDoorvalToe(laag, 'none', 'default');
  laag.spans.splice(1, 0, { style: { pointerEvents: '', cursor: '' } });
  assert.equal(pasTekstlaagDoorvalToe(laag, 'none', 'default'), true);
  assert.ok(alle(laag, 'none', 'default'));
});

test('heeft een ander de spans herschreven, dan wordt dat hersteld', () => {
  const laag = laagMet(6);
  pasTekstlaagDoorvalToe(laag, 'none', 'default');
  // Zoals het selectiegereedschap bij een klik naast een annotatie doet.
  for (const s of laag.spans) { s.style.pointerEvents = 'auto'; s.style.cursor = 'text'; }
  assert.equal(pasTekstlaagDoorvalToe(laag, 'none', 'default'), true);
  assert.ok(alle(laag, 'none', 'default'));
});

test('alleen de laag zelf teruggezet: de laag wordt hersteld zonder de spans langs te lopen', () => {
  const laag = laagMet(3);
  pasTekstlaagDoorvalToe(laag, 'none', 'default');
  laag.style.pointerEvents = 'auto';
  assert.equal(pasTekstlaagDoorvalToe(laag, 'none', 'default'), false);
  assert.equal(laag.style.pointerEvents, 'none');
});

test('na vergeten loopt hij de spans opnieuw langs', () => {
  const laag = laagMet(3);
  pasTekstlaagDoorvalToe(laag, 'none', 'default');
  // Een enkele span in het midden gewijzigd, zoals het tekstbewerkgereedschap doet.
  laag.spans[1].style.pointerEvents = '';
  vergeetTekstlaagDoorval(laag);
  assert.equal(pasTekstlaagDoorvalToe(laag, 'none', 'default'), true);
  assert.ok(alle(laag, 'none', 'default'));
});

test('een lege laag geeft geen fout', () => {
  const laag = laagMet(0);
  assert.equal(pasTekstlaagDoorvalToe(laag, 'none', 'default'), true);
  assert.equal(pasTekstlaagDoorvalToe(laag, 'none', 'default'), false);
});
