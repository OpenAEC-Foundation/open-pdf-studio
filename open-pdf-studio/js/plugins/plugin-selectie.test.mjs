// Een selectie van meerdere annotaties volgen vanuit een extensie (#1059):
// getSelectedAnnotations() en onSelectionChange() op de echte createPluginApi,
// met het echte selectieregister.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./plugin-api-stubs.mjs', import.meta.url);

const laad = (pad) => import(new URL(pad, import.meta.url).href);
const { createPluginApi } = await laad('./plugin-api.js');
const { fireSelectionChange } = await laad('./selection-listener-registry.js');

const tik = () => new Promise((r) => queueMicrotask(r));
const a = { id: 'a', type: 'box' };
const b = { id: 'b', type: 'nl.test:kozijn' };
const c = { id: 'c', type: 'nl.test:kozijn' };

test('getSelectedAnnotations geeft een, meerdere of geen annotaties, als kopie', () => {
  const api = createPluginApi('nl.test.selectie.lezen');
  globalThis.__actiefDocument = null;
  assert.deepEqual(api.getSelectedAnnotations(), [], 'zonder document');
  const doc = { selectedAnnotations: [a] };
  globalThis.__actiefDocument = doc;
  assert.deepEqual(api.getSelectedAnnotations(), [a]);
  doc.selectedAnnotations = [b, a, c];
  const gelezen = api.getSelectedAnnotations();
  assert.deepEqual(gelezen, [b, a, c], 'in de volgorde van selecteren');
  gelezen.pop();
  assert.equal(doc.selectedAnnotations.length, 3, 'de extensie krijgt een eigen lijst');
  delete doc.selectedAnnotations;
  assert.deepEqual(api.getSelectedAnnotations(), [], 'een document zonder selectie');
  api._cleanup();
});

test('onSelectionChange meldt elke wissel met de hele selectie, ook bij meerdere', async () => {
  const api = createPluginApi('nl.test.selectie.volgen');
  const doc = { selectedAnnotations: [] };
  globalThis.__actiefDocument = doc;
  const gezien = [];
  api.onSelectionChange((selectie) => gezien.push(selectie.map((x) => x.id)));

  // De app zet eerst de selectie en meldt dan de wissel; bij meerdere
  // annotaties meldt ze null (zoals registerSelectionListener hem krijgt).
  doc.selectedAnnotations = [b];
  fireSelectionChange(b);
  await tik();
  doc.selectedAnnotations = [b, c];
  fireSelectionChange(null);
  await tik();
  doc.selectedAnnotations = [];
  fireSelectionChange(null);
  await tik();
  assert.deepEqual(gezien, [['b'], ['b', 'c'], []]);

  // Ander document actief: de selectie van dat document.
  globalThis.__actiefDocument = { selectedAnnotations: [a] };
  fireSelectionChange(a);
  await tik();
  assert.deepEqual(gezien.at(-1), ['a']);
  api._cleanup();
});

test('de selectie wordt gelezen nadat ze is bijgewerkt, niet tijdens de melding', async () => {
  const api = createPluginApi('nl.test.selectie.moment');
  const doc = { selectedAnnotations: [a] };
  globalThis.__actiefDocument = doc;
  const gezien = [];
  api.onSelectionChange((selectie) => gezien.push(selectie.length));
  fireSelectionChange(null);
  assert.deepEqual(gezien, [], 'niet synchroon');
  doc.selectedAnnotations = [a, b, c]; // de app werkt haar selectie nog bij in dezelfde beurt
  await tik();
  assert.deepEqual(gezien, [3]);
  api._cleanup();
});

test('afmelden stopt de meldingen, en een fout in de ene luisteraar raakt de andere niet', async () => {
  const api = createPluginApi('nl.test.selectie.afmelden');
  globalThis.__actiefDocument = { selectedAnnotations: [a] };
  let eerste = 0;
  let tweede = 0;
  const fouten = [];
  const echteFout = console.error;
  console.error = (...args) => fouten.push(args);
  try {
    const stop = api.onSelectionChange(() => { eerste++; throw new Error('kapot'); });
    api.onSelectionChange(() => { tweede++; });
    fireSelectionChange(a);
    await tik();
    assert.deepEqual([eerste, tweede], [1, 1]);
    assert.equal(fouten.length, 1, 'de fout is gemeld');
    assert.equal(typeof stop, 'function');
    stop();
    stop(); // twee keer afmelden mag
    fireSelectionChange(a);
    await tik();
    assert.deepEqual([eerste, tweede], [1, 2]);
  } finally {
    console.error = echteFout;
  }
  assert.throws(() => api.onSelectionChange('geen functie'), TypeError);
  api._cleanup();
});

test('na het uitzetten van de extensie komt er niets meer en kan ze zich niet opnieuw aanmelden', async () => {
  const api = createPluginApi('nl.test.selectie.uit');
  const andere = createPluginApi('nl.test.selectie.blijft');
  globalThis.__actiefDocument = { selectedAnnotations: [a] };
  let uit = 0;
  let blijft = 0;
  api.onSelectionChange(() => { uit++; });
  andere.onSelectionChange(() => { blijft++; });
  fireSelectionChange(a);
  await tik();
  // Een wissel vlak vóór het uitzetten: de melding die nog onderweg is komt
  // niet meer aan.
  fireSelectionChange(a);
  api._cleanup();
  await tik();
  fireSelectionChange(a);
  await tik();
  assert.equal(uit, 1, 'de uitgezette extensie hoort niets meer');
  assert.equal(blijft, 3, 'de andere extensie wel');
  assert.throws(() => api.onSelectionChange(() => {}), (e) => e.code === 'EXTENSION_INACTIVE');
  assert.deepEqual(api.getSelectedAnnotations(), [a], 'lezen blijft onschuldig');
  andere._cleanup();
});
