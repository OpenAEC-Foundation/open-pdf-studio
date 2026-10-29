// Dubbelklik op een greep (draaien/schalen) start geen sleep meer.
// tool-dispatcher geeft een dubbelklik door als los object met detail 2, ná
// de pointerup van de tweede klik; een sleep die dan begon kreeg nooit een
// pointerup en de greep bleef aan de muis hangen.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

// Regeleinden gelijktrekken: een Windows-checkout heeft CRLF.
const bron = fs.readFileSync(new URL('./select-tool.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('alleen het nagebootste object telt als dubbelklik, niet een echte pointerdown', async () => {
  const blok = bron.slice(bron.indexOf('export function isNagebootsteDubbelklik('));
  const fn = new Function(`${blok.slice(0, blok.indexOf('\n}\n') + 2).replace('export ', '')}; return isNagebootsteDubbelklik;`)();
  assert.equal(fn({ detail: 2, button: 0 }), true, 'het object van handleDblClick');
  assert.equal(fn({ detail: 0 }), false);
  assert.equal(fn({ detail: 1 }), false);
  assert.equal(fn(null), false);
  // Een echt event met detail 2 (Firefox/WebKit) mag gewoon slepen.
  if (typeof Event !== 'undefined') {
    const echt = new Event('pointerdown');
    Object.defineProperty(echt, 'detail', { value: 2 });
    assert.equal(fn(echt), false);
  }
});

test('de greeptak start geen sleep bij de nagebootste dubbelklik', () => {
  const i = bron.indexOf('if (isNagebootsteDubbelklik(e)) return;');
  const j = bron.indexOf('state.isResizing = true;', i);
  assert.ok(i > 0 && j > i && j - i < 200, 'de controle staat vlak vóór het starten van de sleep');
});
