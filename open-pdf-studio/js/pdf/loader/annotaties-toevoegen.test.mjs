import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { voegAnnotatiesToe } from './annotaties-toevoegen.js';

// Een lijst die bijhoudt of elke schrijfactie binnen de bundel valt.
function gevolgdeLijst() {
  const schrijven = [];
  let binnen = false;
  const lijst = new Proxy([], {
    set(doel, sleutel, waarde) { schrijven.push({ sleutel, binnen }); doel[sleutel] = waarde; return true; },
  });
  const bundel = (fn) => { binnen = true; try { return fn(); } finally { binnen = false; } };
  return { doc: { annotations: lijst }, schrijven, bundel, aantalBundels: () => schrijven.length };
}

test('alle annotaties komen in één gebundelde stap in de lijst', () => {
  const t = gevolgdeLijst();
  let bundels = 0;
  const bundel = (fn) => { bundels += 1; return t.bundel(fn); };
  voegAnnotatiesToe(t.doc, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], bundel);
  assert.equal(bundels, 1);
  assert.deepEqual(t.doc.annotations.map((a) => a.id), ['a', 'b', 'c']);
  assert.ok(t.schrijven.length > 0 && t.schrijven.every((s) => s.binnen), 'een schrijfactie buiten de bundel');
});

test('bestaande annotaties blijven staan, de nieuwe komen erachter', () => {
  const t = gevolgdeLijst();
  t.doc.annotations.push({ id: 'oud' });
  voegAnnotatiesToe(t.doc, [{ id: 'nieuw' }], t.bundel);
  assert.deepEqual(t.doc.annotations.map((a) => a.id), ['oud', 'nieuw']);
});

test('niets toe te voegen: geen bundel en geen schrijfactie', () => {
  const t = gevolgdeLijst();
  let bundels = 0;
  voegAnnotatiesToe(t.doc, [], (fn) => { bundels += 1; return fn(); });
  assert.equal(bundels, 0);
  assert.equal(t.schrijven.length, 0);
});

test('ook een heel grote reeks gaat in één keer (geen spread-limiet)', () => {
  const lijst = [];
  const doc = { annotations: lijst };
  const veel = Array.from({ length: 200_000 }, (_, i) => ({ id: i }));
  voegAnnotatiesToe(doc, veel, (fn) => fn());
  assert.equal(lijst.length, 200_000);
  assert.equal(lijst[199_999].id, 199_999);
});

test('de loader zet een pagina om en voegt haar annotaties daarna in één keer toe', () => {
  const loader = readFileSync(new URL('../loader.js', import.meta.url), 'utf8');
  const functie = loader.slice(loader.indexOf('async function _convertAndPushAnnotations'), loader.indexOf('// Cache for original PDF bytes'));
  assert.match(functie, /voegAnnotatiesToe\(doc, nieuw\)/);
  assert.doesNotMatch(functie, /doc\.annotations\.push\(/);
});
