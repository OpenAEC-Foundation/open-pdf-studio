// Beslisregels van de Pagina-instelling: afleiden uit het document, een
// handmatige keuze onthouden per document, en wat er naar de printer gaat.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PAPIERFORMATEN, paginaOrientatie, paginaFormaat,
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

test('formaat: A1 en A0 bestaan niet in Windows en worden printerstandaard', () => {
  assert.equal(paginaFormaat(pt(841), pt(594)), 'printer');
  assert.equal(paginaFormaat(pt(1189), pt(841)), 'printer');
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
