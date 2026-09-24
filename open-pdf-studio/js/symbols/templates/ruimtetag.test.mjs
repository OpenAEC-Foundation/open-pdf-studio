import assert from 'node:assert/strict';
import test from 'node:test';

import { ruimteTagTemplate, ruimteTagRegels, ruimteTagVak, RUIMTETAG_ID } from './ruimtetag.js';
import { getTemplate, defaultParams } from '../registry.js';

test('de ruimtetag staat in de symboolbibliotheek', () => {
  assert.equal(RUIMTETAG_ID, 'room-tag');
  assert.equal(getTemplate('room-tag'), ruimteTagTemplate);
  const zichtbaar = ruimteTagTemplate.params.map((p) => p.key);
  assert.deepEqual(zichtbaar, ['naam', 'nummer', 'oppervlakteM2', 'decimalen', 'toonOppervlakte']);
  for (const p of ruimteTagTemplate.params) assert.ok(p.label && p.labelEn, `${p.key} heeft een NL- en EN-label`);
  // Het zaadpunt is geen instelling voor de gebruiker: het staat niet in het paneel.
  assert.ok(!zichtbaar.includes('zaadX'));
  assert.equal(defaultParams(ruimteTagTemplate).toonOppervlakte, true);
});

test('naam en netto oppervlakte in een tag, nummer erboven als het er is', () => {
  assert.deepEqual(ruimteTagRegels({ naam: 'Woonkamer', oppervlakteM2: 74.69 }), [
    { tekst: 'Woonkamer', vet: true },
    { tekst: '74.7 m²', vet: false },
  ]);
  assert.deepEqual(ruimteTagRegels({ naam: 'Keuken', nummer: '0.02', oppervlakteM2: 12.345, decimalen: 2 }), [
    { tekst: '0.02', vet: false },
    { tekst: 'Keuken', vet: true },
    { tekst: '12.35 m²', vet: false },
  ]);
  assert.deepEqual(ruimteTagRegels({ naam: 'Berging', oppervlakteM2: 3, toonOppervlakte: false }), [
    { tekst: 'Berging', vet: true },
  ]);
  // Zonder naam: alleen de oppervlakte.
  assert.deepEqual(ruimteTagRegels({ naam: '', oppervlakteM2: 8 }), [{ tekst: '8.0 m²', vet: false }]);
});

test('de tag tekent gecentreerde tekstregels in zijn vak', () => {
  const vak = { x: 100, y: 200, width: 80, height: 30 };
  const cmds = ruimteTagTemplate.render({ naam: 'Hal', oppervlakteM2: 4.2 }, vak);
  const teksten = cmds.filter((c) => c.kind === 'text');
  assert.deepEqual(teksten.map((c) => c.text), ['Hal', '4.2 m²']);
  for (const c of teksten) assert.equal(c.x, 140, 'horizontaal in het midden');
  assert.ok(teksten[0].y < teksten[1].y, 'naam boven de oppervlakte');
  assert.ok(Math.abs((teksten[0].y + teksten[1].y) / 2 - 215) < 1e-9, 'verticaal in het midden');
  assert.equal(teksten[0].bold, true);
  assert.ok(teksten[0].size > 0 && teksten[0].size * 2 <= vak.height, 'de regels passen in het vak');
});

test('het vak van een nieuwe tag past om de tekst, met het midden op het labelpunt', () => {
  const vak = ruimteTagVak({ x: 500, y: 300 }, { naam: 'Slaapkamer 1', oppervlakteM2: 12.3 }, 9);
  assert.equal(vak.x + vak.width / 2, 500);
  assert.equal(vak.y + vak.height / 2, 300);
  assert.ok(vak.width >= 'Slaapkamer 1'.length * 9 * 0.55, `breed genoeg: ${vak.width}`);
  assert.ok(Math.abs(vak.height - 2 * 9 * 1.3) < 1e-9, 'twee regels van 9 pt');
  // Terug door de tekenfunctie: dezelfde tekstgrootte als gevraagd.
  const cmds = ruimteTagTemplate.render({ naam: 'Slaapkamer 1', oppervlakteM2: 12.3 }, vak);
  assert.ok(Math.abs(cmds[0].size - 9) < 1e-9);
});
