import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WIT, LEGENDA_GROEN, LEGENDA_TEKST, LETTERVAK, BASISLIJN, streepPatroon, pijlpunt, helveticaBreedte,
  stiftTekenopdrachten, opdrachtenOmhullende, stiftOmhullende,
} from './tekenopdrachten.js';
import { maakDefinitie, mmNaarPt } from './definities.js';

const bijna = (a, b, melding) => assert.ok(Math.abs(a - b) < 1e-6, `${melding}: ${a} ≠ ${b}`);
const meet = (tekst, grootte) => String(tekst).length * grootte * 0.5;

test('streep 2 × en gat 1 × de dikte', () => {
  assert.deepEqual(streepPatroon(4), [8, 4]);
});

test('Helvetica-breedte is die van pdf-lib, ook voor é en €', () => {
  assert.ok(Math.abs(helveticaBreedte('HSB-wand 38x184, hoh 610, C24', 12) - 178.584) < 0.01);
  assert.ok(helveticaBreedte('A', 12, true) > helveticaBreedte('A', 12, false) - 1e-9);
  assert.ok(helveticaBreedte('café €', 12) > 0);
});

test('gestreepte lijn: eerst een witte onderlaag, dan de strepen', () => {
  const def = maakDefinitie('nieuweWand', { id: 'w' });
  const stift = { type: 'stift', vorm: 'lijn', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }] };
  const [onder, boven] = stiftTekenopdrachten(stift, def, { meet });
  const d = mmNaarPt(1.4);
  assert.deepEqual(onder, { soort: 'lijn', punten: [[10, 20], [110, 20]], kleur: WIT, dikte: d, streep: null });
  assert.deepEqual(boven, { soort: 'lijn', punten: [[10, 20], [110, 20]], kleur: '#FF0000', dikte: d, streep: [2 * d, d] });
});

test('doorgetrokken lijn: één opdracht', () => {
  const def = maakDefinitie('liggerStaal', { id: 'l' });
  const uit = stiftTekenopdrachten({ vorm: 'lijn', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }, def, { meet });
  assert.equal(uit.length, 1);
  assert.equal(uit[0].streep, null);
  assert.equal(uit[0].kleur, '#7D9EBF');
});

test('pijlpunt: top op het uiteinde, basis één pijlpuntlengte terug', () => {
  const [top, links, rechts] = pijlpunt([100, 0], [0, 0], 10);
  assert.deepEqual(top, [100, 0]);
  bijna(links[0], 90, 'basis x'); bijna(rechts[0], 90, 'basis x');
  bijna(Math.abs(links[1] - rechts[1]), 6, 'basisbreedte');
});

test('vloerpijl: lijn tussen de pijlpunten, twee punten, een groen lettervak met de letter', () => {
  const def = { ...maakDefinitie('vloer', { id: 'v' }), letter: 'B' };
  const stift = { vorm: 'pijl', startX: 0, startY: 50, endX: 200, endY: 50 };
  const uit = stiftTekenopdrachten(stift, def, { meet });
  assert.deepEqual(uit.map((o) => o.soort), ['lijn', 'vlak', 'vlak', 'rechthoek', 'tekst']);
  const k = mmNaarPt(3);
  bijna(uit[0].punten[0][0], k, 'lijn begint na de pijlpunt');
  bijna(uit[0].punten[1][0], 200 - k, 'lijn stopt voor de pijlpunt');
  assert.deepEqual(uit[3], { soort: 'rechthoek', x: 95, y: 42.5, b: 10, h: 15, vulling: LEGENDA_GROEN });
  assert.deepEqual(uit[4], { soort: 'tekst', x: 100, y: 50 + 12 * BASISLIJN, tekst: 'B', grootte: LETTERVAK.grootte,
    vet: true, kleur: LEGENDA_TEKST, uitlijning: 'midden', breedte: 6 });
});

test('punten: vierkant, cirkel en I-profiel (ook een kwartslag gedraaid)', () => {
  const kolom = maakDefinitie('kolom', { id: 'k' });
  const h = mmNaarPt(4) / 2;
  const [vierkant] = stiftTekenopdrachten({ vorm: 'punt', x: 10, y: 10 }, kolom, { meet });
  assert.deepEqual(vierkant.punten, [[10 - h, 10 - h], [10 + h, 10 - h], [10 + h, 10 + h], [10 - h, 10 + h]]);
  const [cirkel] = stiftTekenopdrachten({ vorm: 'punt', x: 5, y: 6 }, maakDefinitie('paal', { id: 'p' }), { meet });
  assert.deepEqual(cirkel, { soort: 'cirkel', x: 5, y: 6, r: h, kleur: '#000000' });
  const iprof = { ...kolom, puntvorm: 'i-profiel' };
  const recht = stiftTekenopdrachten({ vorm: 'punt', x: 0, y: 0 }, iprof, { meet });
  const kwart = stiftTekenopdrachten({ vorm: 'punt', x: 0, y: 0, rotation: 90 }, iprof, { meet });
  assert.equal(recht.length, 3);
  // Bovenflens: recht is hij horizontaal (hoogte = maat/5), gedraaid verticaal.
  const bboxVan = (vlak) => opdrachtenOmhullende([vlak]);
  bijna(bboxVan(recht[0]).height, mmNaarPt(4) / 5, 'flens recht');
  bijna(bboxVan(kwart[0]).width, mmNaarPt(4) / 5, 'flens gedraaid');
});

test('sparing: de twee diagonalen van de rechthoek, geen rand', () => {
  const def = maakDefinitie('sparing', { id: 's' });
  const uit = stiftTekenopdrachten({ vorm: 'kruis', x: 10, y: 20, width: 30, height: 40 }, def, { meet });
  assert.deepEqual(uit.map((o) => o.punten), [[[10, 20], [40, 60]], [[40, 20], [10, 60]]]);
});

test('zonder definitie: grijs gestreept met een vraagteken', () => {
  const uit = stiftTekenopdrachten({ vorm: 'lijn', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, null, { meet });
  assert.equal(uit[1].kleur, '#999999');
  assert.ok(uit[1].streep);
  assert.equal(uit.at(-1).tekst, '?');
});

test('omhullende: lijn met halve dikte, pijl met lettervak', () => {
  const def = maakDefinitie('liggerHout', { id: 'h' });
  const d = mmNaarPt(1.4);
  const o = stiftOmhullende({ vorm: 'lijn', points: [{ x: 10, y: 10 }, { x: 110, y: 10 }] }, def, { meet });
  bijna(o.x, 10 - d / 2, 'x'); bijna(o.width, 100 + d, 'breedte'); bijna(o.height, d, 'hoogte');
  const vloer = maakDefinitie('vloer', { id: 'v' });
  const p = stiftOmhullende({ vorm: 'pijl', startX: 0, startY: 0, endX: 0, endY: 100 }, vloer, { meet });
  assert.ok(p.width >= LETTERVAK.breedte, 'het lettervak telt mee');
});
