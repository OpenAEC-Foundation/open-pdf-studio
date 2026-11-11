// Paalpuntniveau: het kader volgt de tekstbreedte, zodat het opschrift er
// volledig in past.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paalpuntniveauTemplate as tpl, formatPaalpuntniveau, estimateTextWidth } from './paalpuntniveau.js';
import { assertBinnenBbox } from './binnen-bbox.testhulp.mjs';

const kader = (cmds) => cmds.find((c) => c.role === 'kader');
const tekst = (cmds) => cmds.find((c) => c.kind === 'text');
const vak = (width, height, x = 10, y = 20) => ({ x, y, width, height });

function pastInKader(cmds, naam) {
  const k = kader(cmds);
  const t = tekst(cmds);
  const links = Math.min(...k.points.map((q) => q.x));
  const rechts = Math.max(...k.points.map((q) => q.x));
  const boven = Math.min(...k.points.map((q) => q.y));
  const onder = Math.max(...k.points.map((q) => q.y));
  const half = estimateTextWidth(t.text, t.size, true) / 2;
  assert.ok(t.size > 0, `${naam}: lettergrootte`);
  assert.ok(t.x - half > links, `${naam}: tekst steekt links uit het kader`);
  assert.ok(t.x + half < rechts, `${naam}: tekst steekt rechts uit het kader`);
  assert.ok(t.y - t.size / 2 > boven && t.y + t.size / 2 < onder, `${naam}: tekst steekt boven of onder uit`);
}

test('opschrift blijft ongewijzigd', () => {
  assert.equal(formatPaalpuntniveau(14, 1, 'N.A.P.'), 'PUNTNIVEAU: 14.0 m+ N.A.P.');
  assert.equal(formatPaalpuntniveau(-2.5, 2, 'N.A.P.'), 'PUNTNIVEAU: 2.50 m- N.A.P.');
  assert.deepEqual(tpl.params.map((p) => p.key), ['niveau', 'decimalen', 'referentie']);
});

test('breedteschatting ligt niet onder de werkelijke letterbreedte', () => {
  // Arial vet: 'PUNTNIVEAU: 14.0 m+ N.A.P.' is 14,03 em breed.
  assert.ok(estimateTextWidth('PUNTNIVEAU: 14.0 m+ N.A.P.', 100, true) >= 1403);
});

test('standaardmaat is breder dan voorheen en de tekst past erin', () => {
  assert.ok(tpl.defaultSize.width > 360, `breedte ${tpl.defaultSize.width}`);
  assert.equal(tpl.defaultSize.height, 62);
  const bbox = vak(tpl.defaultSize.width, tpl.defaultSize.height);
  const cmds = tpl.render({ niveau: 14, decimalen: 1, referentie: 'N.A.P.' }, bbox);
  pastInKader(cmds, 'standaard');
  assertBinnenBbox(cmds, bbox, 'paalpuntniveau');
  // Op de standaardmaat hoeft de letter niet te krimpen.
  assert.ok(Math.abs(tekst(cmds).size - bbox.height * 0.40) < 1e-9);
  assert.equal(tekst(cmds).bold, true);
  assert.ok(Math.abs(tpl.breedteBijHoogte({}, 62) - tpl.defaultSize.width) <= 1);
});

test('de kaderbreedte volgt de tekstbreedte', () => {
  const kort = tpl.breedteBijHoogte({ niveau: 14, decimalen: 0, referentie: 'NAP' }, 62);
  const basis = tpl.breedteBijHoogte({ niveau: 14, decimalen: 1, referentie: 'N.A.P.' }, 62);
  const lang = tpl.breedteBijHoogte({ niveau: -114.125, decimalen: 3, referentie: 'bovenkant vloer' }, 62);
  assert.ok(kort < basis && basis < lang, `${kort} < ${basis} < ${lang}`);
  // Evenredig met de hoogte: het symbool schaalt als geheel.
  assert.ok(Math.abs(tpl.breedteBijHoogte({}, 124) - 2 * basis) < 1e-6);
  for (const params of [
    { niveau: 14, decimalen: 0, referentie: 'NAP' },
    { niveau: -114.125, decimalen: 3, referentie: 'bovenkant vloer' },
  ]) {
    for (const hoogte of [12, 62, 150]) {
      const bbox = vak(tpl.breedteBijHoogte(params, hoogte), hoogte);
      const cmds = tpl.render(params, bbox);
      pastInKader(cmds, JSON.stringify(params));
      assert.ok(Math.abs(tekst(cmds).size - hoogte * 0.40) < 1e-9, 'letter niet verkleind');
    }
  }
});

test('in een te smal kader krimpt de tekst tot hij past', () => {
  const params = { niveau: 14, decimalen: 1, referentie: 'N.A.P.' };
  for (const bbox of [vak(360, 62), vak(120, 62), vak(60, 20), vak(500, 90, 0, 0)]) {
    const cmds = tpl.render(params, bbox);
    pastInKader(cmds, `${bbox.width} x ${bbox.height}`);
    assertBinnenBbox(cmds, bbox, 'paalpuntniveau');
  }
  assert.ok(tekst(tpl.render(params, vak(120, 62))).size < tekst(tpl.render(params, vak(360, 62))).size);
});

test('ontbrekende of ongeldige params renderen met de standaardwaarden', () => {
  const bbox = vak(tpl.defaultSize.width, tpl.defaultSize.height);
  assert.equal(tekst(tpl.render({}, bbox)).text, 'PUNTNIVEAU: 14.0 m+ N.A.P.');
  assert.equal(tekst(tpl.render({ niveau: 'x', referentie: '' }, bbox)).text, 'PUNTNIVEAU: 14.0 m+ N.A.P.');
  assert.ok(tpl.breedteBijHoogte({}, 0) === 0 || !(tpl.breedteBijHoogte({}, 0) > 0));
});
