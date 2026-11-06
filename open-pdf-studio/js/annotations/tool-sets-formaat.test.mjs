// Het uitwisselbestand van de werkkist (#629, #311) is een open formaat:
// docs/werkkist-bestandsformaat.md beschrijft het. Deze test houdt die
// beschrijving gelijk met de code: dezelfde soorten, dezelfde eigenschappen,
// en het voorbeeld leest foutloos in en komt ongewijzigd weer uit.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  TOOL_FOR_TYPE, TOOL_SET_FORMAT, TOOL_SET_VERSION, TOOL_SET_EXTENSION, SAVED_PROPERTY_KEYS,
  parseToolSetFile, serializeToolSet,
} from './tool-sets.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DOC = fs.readFileSync(path.join(repo, 'docs', 'werkkist-bestandsformaat.md'), 'utf8').replace(/\r\n/g, '\n');

/** De tekst van een hoofdstuk (## kop) tot het volgende. */
function hoofdstuk(kop) {
  const begin = DOC.indexOf(`\n## ${kop}\n`);
  assert.ok(begin >= 0, `hoofdstuk ${kop}`);
  const eind = DOC.indexOf('\n## ', begin + 4);
  return DOC.slice(begin, eind < 0 ? undefined : eind);
}

/** Alle `code`-woorden in de cellen `kolom` van de tabelregels van een tekst. */
function tabelCodes(tekst, kolom) {
  const uit = [];
  for (const r of tekst.split('\n')) {
    if (!r.startsWith('|') || /^\|\s*-/.test(r)) continue;
    const cel = r.slice(1, -1).split('|')[kolom] || '';
    for (const m of cel.matchAll(/`([^`]+)`/g)) uit.push(m[1]);
  }
  return uit;
}

test('de beschreven soorten zijn precies de soorten van de app', () => {
  assert.deepEqual(tabelCodes(hoofdstuk('Soorten'), 0).sort(), Object.keys(TOOL_FOR_TYPE).sort());
});

test('de beschreven eigenschappen zijn precies wat een item bewaart', () => {
  const beschreven = tabelCodes(hoofdstuk('Eigenschappen (`props`)'), 1);
  assert.equal(new Set(beschreven).size, beschreven.length, 'geen sleutel dubbel');
  assert.deepEqual(beschreven.sort(), [...SAVED_PROPERTY_KEYS].sort());
});

test('formaat, versie en extensie staan zo in de beschrijving', () => {
  assert.ok(DOC.includes(`\`"${TOOL_SET_FORMAT}"\``));
  assert.ok(DOC.includes(`nu \`${TOOL_SET_VERSION}\``));
  assert.ok(DOC.includes(`\`.${TOOL_SET_EXTENSION}\``));
});

test('het voorbeeld leest foutloos in en komt met dezelfde inhoud weer uit', () => {
  const m = /```json\n([\s\S]*?)\n```/.exec(hoofdstuk('Voorbeeld'));
  assert.ok(m, 'een json-blok');
  const voorbeeld = JSON.parse(m[1]);
  const r = parseToolSetFile(m[1]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.skipped, 0);
  assert.equal(r.set.name, voorbeeld.toolSet.name);
  assert.equal(r.set.items.length, voorbeeld.toolSet.items.length);
  r.set.items.forEach((item, i) => {
    const bron = voorbeeld.toolSet.items[i];
    assert.equal(item.type, bron.type);
    assert.equal(item.name, bron.name);
    assert.deepEqual(item.props, bron.props, `${bron.name}: geen eigenschap weggelaten`);
    assert.deepEqual(item.layer, bron.layer);
  });
  // En weer exporteren geeft hetzelfde bestand, op het moment en de id's na.
  const weer = JSON.parse(serializeToolSet(r.set, { now: voorbeeld.exportedAt }));
  const zonderIds = (d) => ({ ...d, toolSet: { ...d.toolSet, items: d.toolSet.items.map(({ id, ...rest }) => rest) } });
  assert.deepEqual(zonderIds(weer), zonderIds(voorbeeld));
});
