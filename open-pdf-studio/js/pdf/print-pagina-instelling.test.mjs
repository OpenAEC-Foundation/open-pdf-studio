// Beslisregels van de Pagina-instelling: afleiden uit het document, een
// handmatige keuze onthouden per document, en wat er naar de printer gaat.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PAPIERFORMATEN, VERLENGING_MM, formaatTekst, paginaOrientatie, paginaFormaat,
  startPaginaInstelling, bewaarPaginaInstelling, printArgumenten,
} from './print-pagina-instelling.js';

const MM = 72 / 25.4; // pt per mm
const pt = (mm) => mm * MM;

test('oriëntatie: breder dan hoog is liggend, vierkant is staand', () => {
  assert.equal(paginaOrientatie(pt(420), pt(297)), 'landscape');
  assert.equal(paginaOrientatie(pt(297), pt(420)), 'portrait');
  assert.equal(paginaOrientatie(500, 500), 'portrait');
});

test('formaat: herkend in beide oriëntaties', () => {
  assert.equal(paginaFormaat(pt(210), pt(297)), 'a4');
  assert.equal(paginaFormaat(pt(297), pt(210)), 'a4');
  assert.equal(paginaFormaat(pt(594), pt(420)), 'a2');
  assert.equal(paginaFormaat(pt(279), pt(432)), 'tabloid');
});

test('formaat: tolerantie van 3 mm, daarbuiten printerstandaard', () => {
  assert.equal(paginaFormaat(pt(212.9), pt(299.9)), 'a4');
  assert.equal(paginaFormaat(pt(213.5), pt(297)), 'printer');
});

test('formaat: A1 en A0 worden herkend, in beide oriëntaties', () => {
  assert.equal(paginaFormaat(pt(594), pt(841)), 'a1');
  assert.equal(paginaFormaat(pt(841), pt(594)), 'a1');
  assert.equal(paginaFormaat(pt(841), pt(1189)), 'a0');
  assert.equal(paginaFormaat(pt(1189), pt(841)), 'a0');
});

test('formaat: verlengde vellen (A3L, A2L, A1L, A0L) worden herkend, in beide oriëntaties', () => {
  assert.equal(paginaFormaat(pt(297), pt(630)), 'a3l');
  assert.equal(paginaFormaat(pt(630), pt(297)), 'a3l');
  assert.equal(paginaFormaat(pt(420), pt(804)), 'a2l');
  assert.equal(paginaFormaat(pt(804), pt(420)), 'a2l');
  assert.equal(paginaFormaat(pt(594), pt(1051)), 'a1l');
  assert.equal(paginaFormaat(pt(1051), pt(594)), 'a1l');
  assert.equal(paginaFormaat(pt(841), pt(1399)), 'a0l');
  assert.equal(paginaFormaat(pt(1399), pt(841)), 'a0l');
});

test('formaat: grote en verlengde vellen met 3 mm tolerantie, daarbuiten printerstandaard', () => {
  assert.equal(paginaFormaat(pt(299.9), pt(632.9)), 'a3l');
  assert.equal(paginaFormaat(pt(294.1), pt(627.1)), 'a3l');
  assert.equal(paginaFormaat(pt(297), pt(634)), 'printer');
  assert.equal(paginaFormaat(pt(1048.5), pt(596.5)), 'a1l');
  assert.equal(paginaFormaat(pt(591.5), pt(838.5)), 'a1');
  // Tussen A1 (841) en A1L (1051) in: geen van beide.
  assert.equal(paginaFormaat(pt(594), pt(946)), 'printer');
  // Een rol van A0-breedte maar langer dan A0L.
  assert.equal(paginaFormaat(pt(841), pt(1500)), 'printer');
});

test('formaat: elk vel uit de lijst komt via zijn eigen maat terug op zichzelf', () => {
  for (const [sleutel, f] of Object.entries(PAPIERFORMATEN)) {
    assert.equal(paginaFormaat(pt(f.breedte), pt(f.hoogte)), sleutel, `${sleutel} staand`);
    assert.equal(paginaFormaat(pt(f.hoogte), pt(f.breedte)), sleutel, `${sleutel} liggend`);
  }
});

test('start: een A1L-tekening opent op A1L liggend in plaats van op printerstandaard', () => {
  const s = startPaginaInstelling({ bewaard: null, docId: 'd1', breedtePt: pt(1051), hoogtePt: pt(594) });
  assert.deepEqual(s, { size: 'a1l', orientation: 'landscape', handmatig: false });
  const a0 = startPaginaInstelling({ bewaard: null, docId: 'd1', breedtePt: pt(1189), hoogtePt: pt(841) });
  assert.deepEqual(a0, { size: 'a0', orientation: 'landscape', handmatig: false });
});

test('formaat en oriëntatie: ongeldige maten', () => {
  assert.equal(paginaFormaat(0, 100), 'printer');
  assert.equal(paginaFormaat(NaN, NaN), 'printer');
  assert.equal(paginaOrientatie(NaN, NaN), 'portrait');
});

test('A2 staat in de lijst met de juiste maten', () => {
  assert.deepEqual(
    { breedte: PAPIERFORMATEN.a2.breedte, hoogte: PAPIERFORMATEN.a2.hoogte },
    { breedte: 420, hoogte: 594 },
  );
});

test('lijst: A1, A0 en de verlengde vellen met de juiste maten', () => {
  const maat = (s) => [PAPIERFORMATEN[s].breedte, PAPIERFORMATEN[s].hoogte];
  assert.deepEqual(maat('a1'), [594, 841]);
  assert.deepEqual(maat('a0'), [841, 1189]);
  assert.deepEqual(maat('a3l'), [297, 630]);
  assert.deepEqual(maat('a2l'), [420, 804]);
  assert.deepEqual(maat('a1l'), [594, 1051]);
  assert.deepEqual(maat('a0l'), [841, 1399]);
});

test('lijst: een verlengd vel is het basisvel plus één A4-breedte in de lengte', () => {
  assert.equal(VERLENGING_MM, PAPIERFORMATEN.a4.breedte);
  for (const basis of ['a3', 'a2', 'a1', 'a0']) {
    const lang = PAPIERFORMATEN[`${basis}l`];
    assert.equal(lang.breedte, PAPIERFORMATEN[basis].breedte, basis);
    assert.equal(lang.hoogte, PAPIERFORMATEN[basis].hoogte + VERLENGING_MM, basis);
    assert.equal(lang.label, `${PAPIERFORMATEN[basis].label}L`);
  }
});

test('lijst: elk vel staat staand en de keuzelijst toont naam en maten', () => {
  for (const [sleutel, f] of Object.entries(PAPIERFORMATEN)) {
    assert.ok(f.breedte < f.hoogte, `${sleutel} staat niet staand`);
  }
  assert.equal(formaatTekst('a3l'), 'A3L (297 x 630 mm)');
  assert.equal(formaatTekst('a1'), 'A1 (594 x 841 mm)');
  // Ongewijzigd voor de vellen die er al stonden.
  assert.equal(formaatTekst('a4'), 'A4 (210 x 297 mm)');
  assert.equal(formaatTekst('letter'), 'Letter (216 x 279 mm)');
  assert.equal(formaatTekst('tabloid'), 'Tabloid (279 x 432 mm)');
  assert.equal(formaatTekst('printer'), null);
});

test('lijst: dezelfde maten als de formulierentabel van de printer (Rust)', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const bron = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src-tauri/src/print_formulieren.rs'), 'utf8',
  );
  const regels = [...bron.matchAll(
    /Formulier \{ sleutel: "(\w+)", naam: "(\w+)", breedte_mm: (\d+), hoogte_mm: (\d+),/g,
  )];
  assert.equal(regels.length, 6, 'de formulierentabel heeft zes regels');
  for (const [, sleutel, naam, breedte, hoogte] of regels) {
    const f = PAPIERFORMATEN[sleutel];
    assert.ok(f, `${sleutel} ontbreekt in PAPIERFORMATEN`);
    assert.deepEqual([f.label, f.breedte, f.hoogte], [naam, Number(breedte), Number(hoogte)], sleutel);
  }
});

test('start: niets bewaard → afgeleid uit de pagina', () => {
  const s = startPaginaInstelling({ bewaard: null, docId: 'd1', breedtePt: pt(420), hoogtePt: pt(297) });
  assert.deepEqual(s, { size: 'a3', orientation: 'landscape', handmatig: false });
});

test('start: handmatige keuze in hetzelfde document blijft staan', () => {
  const bewaard = { docId: 'd1', size: 'a4', orientation: 'portrait', handmatig: true };
  const s = startPaginaInstelling({ bewaard, docId: 'd1', breedtePt: pt(420), hoogtePt: pt(297) });
  assert.deepEqual(s, { size: 'a4', orientation: 'portrait', handmatig: true });
});

test('start: handmatige keuze in een ánder document telt niet', () => {
  const bewaard = { docId: 'd1', size: 'a4', orientation: 'portrait', handmatig: true };
  const s = startPaginaInstelling({ bewaard, docId: 'd2', breedtePt: pt(420), hoogtePt: pt(297) });
  assert.deepEqual(s, { size: 'a3', orientation: 'landscape', handmatig: false });
});

test('start: niets handmatig gewijzigd → volgt de huidige pagina (gemengde oriëntaties)', () => {
  const bewaard = { docId: 'd1', size: 'a3', orientation: 'landscape', handmatig: false };
  const s = startPaginaInstelling({ bewaard, docId: 'd1', breedtePt: pt(297), hoogtePt: pt(420) });
  assert.deepEqual(s, { size: 'a3', orientation: 'portrait', handmatig: false });
});

test('start: maten onbekend → bewaarde waarden, anders A4 staand', () => {
  const bewaard = { docId: 'd9', size: 'a3', orientation: 'landscape', handmatig: false };
  assert.deepEqual(
    startPaginaInstelling({ bewaard, docId: 'd1', breedtePt: NaN, hoogtePt: NaN }),
    { size: 'a3', orientation: 'landscape', handmatig: false },
  );
  assert.deepEqual(
    startPaginaInstelling({ bewaard: null, docId: 'd1', breedtePt: NaN, hoogtePt: NaN }),
    { size: 'a4', orientation: 'portrait', handmatig: false },
  );
});

test('bewaren: handmatig zodra de gebruiker iets anders kiest dan de start', () => {
  const start = { size: 'a3', orientation: 'landscape', handmatig: false };
  assert.equal(bewaarPaginaInstelling({ start, gekozen: { size: 'a3', orientation: 'landscape' }, docId: 'd1' }).handmatig, false);
  assert.equal(bewaarPaginaInstelling({ start, gekozen: { size: 'a3', orientation: 'portrait' }, docId: 'd1' }).handmatig, true);
  assert.equal(bewaarPaginaInstelling({ start, gekozen: { size: 'a4', orientation: 'landscape' }, docId: 'd1' }).handmatig, true);
});

test('bewaren: een eerdere handmatige keuze blijft handmatig bij OK zonder wijziging', () => {
  const start = { size: 'a4', orientation: 'portrait', handmatig: true };
  const b = bewaarPaginaInstelling({ start, gekozen: { size: 'a4', orientation: 'portrait' }, docId: 'd1' });
  assert.deepEqual(b, { docId: 'd1', size: 'a4', orientation: 'portrait', handmatig: true });
});

test('printer: Automatisch draaien aan → oriëntatie auto', () => {
  const p = { docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true };
  assert.deepEqual(printArgumenten({ autoRotate: true, paginaInstelling: p, docId: 'd1' }),
    { orientatie: 'auto', papier: 'a3' });
});

test('printer: Automatisch draaien uit → oriëntatie uit de Pagina-instelling', () => {
  const p = { docId: 'd1', size: 'a4', orientation: 'landscape', handmatig: true };
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: p, docId: 'd1' }),
    { orientatie: 'landscape', papier: 'a4' });
});

test('printer: Pagina-instelling niet voor dit document geopend → nooit een verzonnen standaard', () => {
  const vreemd = { docId: 'ander', size: 'a4', orientation: 'portrait', handmatig: true };
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: vreemd, docId: 'd1' }),
    { orientatie: 'auto', papier: 'printer' });
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: null, docId: 'd1' }),
    { orientatie: 'auto', papier: 'printer' });
});
