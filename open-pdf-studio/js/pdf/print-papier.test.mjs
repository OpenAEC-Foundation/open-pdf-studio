// Welk papier de printdialoog toont en hoe Eigenschappen, Pagina-instelling
// en print_pdf het eens blijven (issue #406: A3 gekozen, A4 afgedrukt).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPapierFormaat, normaliseerPapierInfo, effectiefPapier, papierTekst,
  paginaTekst, eigenschappenVooraf, instellingNaEigenschappen, maakPapierVerzoeken,
} from './print-papier.js';
import {
  startPaginaInstelling, bewaarPaginaInstelling, printArgumenten,
} from './print-pagina-instelling.js';

const MM = 72 / 25.4; // pt per mm
const pt = (mm) => mm * MM;
const STANDAARD = 'Standaard van de printer';

// A4 liggend, zoals het document uit de issue ("297 x 210 mm").
const A4_LIGGEND = { breedtePt: pt(297), hoogtePt: pt(210) };
const A4_STAAND = { breedtePt: pt(210), hoogtePt: pt(297) };

// PapierInfo zoals Rust hem stuurt.
const info = (papier, breedteMm, hoogteMm, orientatie = 'portrait', naam = '') =>
  ({ papier, naam, breedteMm, hoogteMm, orientatie });
const PRINTER_A4 = info('a4', 210, 297, 'portrait', 'A4');
const PRINTER_A3 = info('a3', 297, 420, 'portrait', 'A3');
const PRINTER_LETTER = info('letter', 215.9, 279.4, 'portrait', 'Letter');

/** Wat de kop toont, zonder het vertaalde voorvoegsel. */
function kop({ paginaInstelling = null, docId = 'd1', autoRotate = true, printerPapier, pagina = A4_LIGGEND }) {
  return papierTekst(
    effectiefPapier({ paginaInstelling, docId, autoRotate, printerPapier, pagina }),
    STANDAARD,
  );
}

/** Pagina-instelling openen voor een document en met OK sluiten. */
function paginaInstellingOk({ bewaard, docId, pagina, kies = {} }) {
  const start = startPaginaInstelling({ bewaard, docId, ...pagina });
  const gekozen = { size: kies.size ?? start.size, orientation: kies.orientation ?? start.orientation };
  return bewaarPaginaInstelling({ start, gekozen, docId });
}

/** Antwoord van open_printer_properties bij OK: PapierInfo plus wat de gebruiker veranderde. */
const ok = (papierInfo, { papier = true, orientatie = false } = {}) =>
  ({ ...papierInfo, papierGewijzigd: papier, orientatieGewijzigd: orientatie });

/**
 * Wat de printdialoog rond Eigenschappen doet: vooringevuld met
 * eigenschappenVooraf, daarna de Pagina-instelling bijwerken met het antwoord.
 * `antwoord` mag een functie van de voorinvulling zijn, zodat een proef kan
 * nabootsen wat de driver bij OK zonder wijziging teruggeeft.
 */
function eigenschappen(huidig, antwoord, { docId = 'd1', autoRotate = true, pagina = A4_LIGGEND } = {}) {
  const vooraf = eigenschappenVooraf({ paginaInstelling: huidig, docId, autoRotate, pagina });
  const a = typeof antwoord === 'function' ? antwoord(vooraf) : antwoord;
  const nieuw = instellingNaEigenschappen({ papierInfo: a, docId, huidig, vooraf });
  return { vooraf, instelling: nieuw ? { ...(huidig || {}), ...nieuw } : huidig };
}

/** Wat de driver bij OK zonder wijziging teruggeeft: precies de voorinvulling. */
const ongewijzigd = (standaard) => (vooraf) => ok({
  ...standaard,
  ...(isPapierFormaat(vooraf.papier) ? { papier: vooraf.papier, naam: vooraf.papier.toUpperCase() } : {}),
  ...(vooraf.orientatie === 'auto' ? {} : { orientatie: vooraf.orientatie }),
}, { papier: false, orientatie: false });

/** Kort: alleen de uitkomst van Eigenschappen. */
function naEigenschappen(huidig, antwoord, opties) {
  return eigenschappen(huidig, antwoord, opties).instelling;
}

// --- PapierInfo uit Rust -----------------------------------------------------

test('PapierInfo: null, true (oud antwoord) en onzin worden null', () => {
  for (const v of [null, undefined, true, false, 0, 'a3', [], {}, { papier: '' }, { papier: 3 }]) {
    assert.equal(normaliseerPapierInfo(v), null, JSON.stringify(v));
  }
});

test('PapierInfo: onbekende sleutel wordt overig, maten staand, oriëntatie veilig', () => {
  assert.deepEqual(
    normaliseerPapierInfo({ papier: 'a1', naam: ' A1 ', breedteMm: 841, hoogteMm: 594, orientatie: 'landscape' }),
    { papier: 'overig', naam: 'A1', breedteMm: 594, hoogteMm: 841, orientatie: 'landscape' },
  );
  assert.deepEqual(
    normaliseerPapierInfo({ papier: 'a3', breedteMm: 0, hoogteMm: NaN, orientatie: 'schuin' }),
    { papier: 'a3', naam: '', breedteMm: null, hoogteMm: null, orientatie: 'portrait' },
  );
});

test('isPapierFormaat: alleen echte formaten, geen printer/overig/prototype', () => {
  assert.equal(isPapierFormaat('a3'), true);
  assert.equal(isPapierFormaat('tabloid'), true);
  assert.equal(isPapierFormaat('printer'), false);
  assert.equal(isPapierFormaat('overig'), false);
  assert.equal(isPapierFormaat('toString'), false);
  assert.equal(isPapierFormaat(undefined), false);
});

// --- Issue #406 ----------------------------------------------------------------

test('issue #406: A3 in de Pagina-instelling → de kop zegt A3 (297 x 420 mm), niet A4', () => {
  const inst = paginaInstellingOk({
    bewaard: null, docId: 'd1', pagina: A4_STAAND, kies: { size: 'a3', orientation: 'portrait' },
  });
  assert.equal(kop({ paginaInstelling: inst, autoRotate: false, printerPapier: PRINTER_A4, pagina: A4_LIGGEND }),
    'A3 (297 x 420 mm)');
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: inst, docId: 'd1' }),
    { orientatie: 'portrait', papier: 'a3' });
});

test('issue #406 letterlijk: liggend A4-document, A3 gekozen, Automatisch draaien aan', () => {
  // De dialoog start op A4 liggend (uit het document); de gebruiker kiest A3.
  const inst = paginaInstellingOk({ bewaard: null, docId: 'd1', pagina: A4_LIGGEND, kies: { size: 'a3' } });
  assert.deepEqual({ size: inst.size, orientation: inst.orientation, handmatig: inst.handmatig },
    { size: 'a3', orientation: 'landscape', handmatig: true });
  // De kop noemt het vel zoals de Pagina-instelling het aanbiedt: A3 (297 x 420 mm).
  assert.equal(kop({ paginaInstelling: inst, printerPapier: PRINTER_A4 }), 'A3 (297 x 420 mm)');
  assert.equal(paginaTekst(A4_LIGGEND.breedtePt, A4_LIGGEND.hoogtePt), '297 x 210 mm');
  // Het vel komt wel liggend uit de printer, net als de pagina.
  const e = effectiefPapier({ paginaInstelling: inst, docId: 'd1', autoRotate: true, printerPapier: PRINTER_A4, pagina: A4_LIGGEND });
  assert.equal(e.orientatie, 'landscape');
  assert.deepEqual(printArgumenten({ autoRotate: true, paginaInstelling: inst, docId: 'd1' }),
    { orientatie: 'auto', papier: 'a3' });
});

test('Automatisch draaien: de kop verspringt niet bij bladeren, de oriëntatie volgt de pagina', () => {
  const inst = { docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true };
  const e = (pagina) => effectiefPapier({ paginaInstelling: inst, docId: 'd1', autoRotate: true, printerPapier: PRINTER_A4, pagina });
  // Gemengd document: staand, liggend, liggend, staand.
  for (const pagina of [A4_STAAND, A4_LIGGEND, A4_LIGGEND, A4_STAAND]) {
    assert.equal(papierTekst(e(pagina), STANDAARD), 'A3 (297 x 420 mm)');
    assert.deepEqual([e(pagina).breedteMm, e(pagina).hoogteMm], [297, 420]);
  }
  assert.equal(e(A4_LIGGEND).orientatie, 'landscape');
  assert.equal(e(A4_STAAND).orientatie, 'portrait');
  // Pagina onbekend → de oriëntatie uit de Pagina-instelling.
  assert.equal(e(null).orientatie, 'portrait');
});

test('Automatisch draaien uit: de oriëntatie van de Pagina-instelling, ook op een liggende pagina', () => {
  const inst = { docId: 'd1', size: 'a4', orientation: 'portrait', handmatig: true };
  assert.equal(kop({ paginaInstelling: inst, autoRotate: false, pagina: A4_LIGGEND }), 'A4 (210 x 297 mm)');
  const liggend = { ...inst, orientation: 'landscape' };
  const e = effectiefPapier({ paginaInstelling: liggend, docId: 'd1', autoRotate: false, printerPapier: null, pagina: A4_STAAND });
  assert.equal(papierTekst(e, STANDAARD), 'A4 (210 x 297 mm)');
  assert.equal(e.orientatie, 'landscape');
});

test('papiertekst: maten altijd staand, ook als ze liggend binnenkomen', () => {
  assert.equal(papierTekst({ bron: 'printer', naam: 'A3', breedteMm: 420, hoogteMm: 297 }, STANDAARD), 'A3 (297 x 420 mm)');
});

// --- Eigenschappen ---------------------------------------------------------------

test('voorinvulling: papier en oriëntatie van de volgende afdruk', () => {
  const inst = { docId: 'd1', size: 'a3', orientation: 'landscape', handmatig: true };
  // Automatisch draaien aan: het papier uit de Pagina-instelling, de oriëntatie van de getoonde pagina.
  assert.deepEqual(eigenschappenVooraf({ paginaInstelling: inst, docId: 'd1', autoRotate: true, pagina: A4_STAAND }),
    { papier: 'a3', orientatie: 'portrait' });
  // Uit: de oriëntatie van de Pagina-instelling.
  assert.deepEqual(eigenschappenVooraf({ paginaInstelling: inst, docId: 'd1', autoRotate: false, pagina: A4_STAAND }),
    { papier: 'a3', orientatie: 'landscape' });
  // Geen Pagina-instelling voor dit document: papier van de printer, oriëntatie van de pagina.
  assert.deepEqual(eigenschappenVooraf({ paginaInstelling: inst, docId: 'd2', autoRotate: false, pagina: A4_LIGGEND }),
    { papier: 'printer', orientatie: 'landscape' });
  assert.deepEqual(eigenschappenVooraf({ paginaInstelling: null, docId: 'd1', autoRotate: true, pagina: A4_STAAND }),
    { papier: 'printer', orientatie: 'portrait' });
  // Pagina onbekend en niets gevraagd: de driver houdt zijn oriëntatie.
  assert.deepEqual(eigenschappenVooraf({ paginaInstelling: null, docId: 'd1', autoRotate: true, pagina: null }),
    { papier: 'printer', orientatie: 'auto' });
  // Standaard van de printer in de Pagina-instelling: het papier niet overschrijven.
  assert.deepEqual(
    eigenschappenVooraf({ paginaInstelling: { ...inst, size: 'printer' }, docId: 'd1', autoRotate: false, pagina: null }),
    { papier: 'printer', orientatie: 'landscape' });
});

test('issue #406: A3 in de Pagina-instelling, Eigenschappen OK zonder wijziging → blijft A3', () => {
  // De stappen uit de issue: A3 gekozen, daarna Eigenschappen om te kijken.
  const ps = paginaInstellingOk({ bewaard: null, docId: 'd1', pagina: A4_LIGGEND, kies: { size: 'a3' } });
  for (const autoRotate of [true, false]) {
    const { vooraf, instelling } = eigenschappen(ps, ongewijzigd(PRINTER_A4), { autoRotate });
    // Het venster opent op A3, niet op de A4 van de driver.
    assert.equal(vooraf.papier, 'a3');
    assert.equal(vooraf.orientatie, 'landscape');
    assert.equal(instelling, ps, 'Pagina-instelling onveranderd');
    assert.equal(printArgumenten({ autoRotate, paginaInstelling: instelling, docId: 'd1' }).papier, 'a3');
    assert.equal(kop({ paginaInstelling: instelling, autoRotate, printerPapier: PRINTER_A3 }), 'A3 (297 x 420 mm)');
  }
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: ps, docId: 'd1' }),
    { orientatie: 'landscape', papier: 'a3' });
});

test('Eigenschappen: alleen iets anders veranderd (dubbelzijdig, lade) → Pagina-instelling blijft', () => {
  const ps = { docId: 'd1', size: 'a3', orientation: 'landscape', handmatig: true };
  // Rust meldt papier en oriëntatie ongewijzigd, ook al noemt de driver A4 (bijv. geen A3 in de lade).
  const inst = naEigenschappen(ps, ok(PRINTER_A4, { papier: false, orientatie: false }), { autoRotate: false });
  assert.equal(inst, ps);
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: inst, docId: 'd1' }),
    { orientatie: 'landscape', papier: 'a3' });
});

test('Automatisch draaien uit, nooit een Pagina-instelling: OK zonder wijziging laat per pagina draaien', () => {
  const { vooraf, instelling } = eigenschappen(null, ongewijzigd(PRINTER_A4), { autoRotate: false });
  assert.deepEqual(vooraf, { papier: 'printer', orientatie: 'landscape' });
  assert.equal(instelling, null);
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: instelling, docId: 'd1' }),
    { orientatie: 'auto', papier: 'printer' });
  // Ook als er een Pagina-instelling van een ander document staat.
  const ander = { docId: 'd0', size: 'a5', orientation: 'portrait', handmatig: true };
  assert.equal(naEigenschappen(ander, ongewijzigd(PRINTER_A4), { autoRotate: false }), ander);
});

test('Eigenschappen A3 → Pagina-instelling A3, kop A3, print_pdf krijgt a3', () => {
  const inst = naEigenschappen(null, ok(PRINTER_A3), { pagina: A4_STAAND });
  assert.deepEqual(inst, { docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true });
  assert.equal(kop({ paginaInstelling: inst, autoRotate: false, printerPapier: PRINTER_A3 }), 'A3 (297 x 420 mm)');
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: inst, docId: 'd1' }),
    { orientatie: 'portrait', papier: 'a3' });
  assert.deepEqual(printArgumenten({ autoRotate: true, paginaInstelling: inst, docId: 'd1' }),
    { orientatie: 'auto', papier: 'a3' });
});

test('Eigenschappen: alleen papier veranderd, geen Pagina-instelling → oriëntatie zoals vooringevuld', () => {
  // Liggende pagina: het venster opende liggend; alleen A3 gekozen.
  const inst = naEigenschappen(null, ok(info('a3', 297, 420, 'landscape', 'A3')), { autoRotate: false });
  assert.deepEqual(inst, { docId: 'd1', size: 'a3', orientation: 'landscape', handmatig: true });
});

test('Eigenschappen: alleen oriëntatie veranderd → het papier blijft wat het was', () => {
  // Met een Pagina-instelling voor dit document: haar papier blijft.
  const ps = { docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true };
  const inst = naEigenschappen(ps, ok(info('a3', 297, 420, 'landscape', 'A3'), { papier: false, orientatie: true }),
    { autoRotate: false });
  assert.deepEqual(inst, { docId: 'd1', size: 'a3', orientation: 'landscape', handmatig: true });
  assert.equal(kop({ paginaInstelling: inst, autoRotate: false, pagina: A4_STAAND, printerPapier: PRINTER_A4 }),
    'A3 (297 x 420 mm)');
  // Zonder: het papier blijft aan de printer (de bewaarde DEVMODE), geen verzonnen formaat.
  const zonder = naEigenschappen(null, ok(PRINTER_A4, { papier: false, orientatie: true }), { autoRotate: false });
  assert.deepEqual(zonder, { docId: 'd1', size: 'printer', orientation: 'portrait', handmatig: true });
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: zonder, docId: 'd1' }),
    { orientatie: 'portrait', papier: 'printer' });
});

test('Eigenschappen liggend → oriëntatie liggend in de Pagina-instelling, de kop noemt het vel staand', () => {
  const inst = naEigenschappen(null, ok(info('a3', 297, 420, 'landscape', 'A3'), { papier: true, orientatie: true }),
    { pagina: A4_STAAND });
  assert.equal(inst.orientation, 'landscape');
  const e = effectiefPapier({ paginaInstelling: inst, docId: 'd1', autoRotate: false, printerPapier: null, pagina: A4_STAAND });
  assert.equal(papierTekst(e, STANDAARD), 'A3 (297 x 420 mm)');
  assert.equal(e.orientatie, 'landscape');
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: inst, docId: 'd1' }),
    { orientatie: 'landscape', papier: 'a3' });
});

test('Eigenschappen, daarna de Pagina-instelling openen: toont de keuze uit Eigenschappen', () => {
  const inst = naEigenschappen(null, ok(PRINTER_A3), { pagina: A4_STAAND });
  assert.deepEqual(startPaginaInstelling({ bewaard: inst, docId: 'd1', ...A4_LIGGEND }),
    { size: 'a3', orientation: 'portrait', handmatig: true });
  // OK zonder wijziging: blijft A3.
  const na = paginaInstellingOk({ bewaard: inst, docId: 'd1', pagina: A4_LIGGEND });
  assert.deepEqual(printArgumenten({ autoRotate: true, paginaInstelling: na, docId: 'd1' }),
    { orientatie: 'auto', papier: 'a3' });
});

test('volgorde: Pagina-instelling A4, daarna Eigenschappen A3 → A3 wint', () => {
  const ps = paginaInstellingOk({ bewaard: null, docId: 'd1', pagina: A4_LIGGEND, kies: { size: 'a4' } });
  const { vooraf, instelling } = eigenschappen(ps, ok(PRINTER_A3));
  assert.equal(vooraf.papier, 'a4');
  assert.equal(kop({ paginaInstelling: instelling, printerPapier: PRINTER_A3 }), 'A3 (297 x 420 mm)');
  assert.equal(printArgumenten({ autoRotate: true, paginaInstelling: instelling, docId: 'd1' }).papier, 'a3');
  // De oriëntatie van de Pagina-instelling blijft.
  assert.equal(instelling.orientation, 'landscape');
});

test('volgorde: Eigenschappen A3, daarna Pagina-instelling A4 → A4 wint', () => {
  const na = naEigenschappen(null, ok(PRINTER_A3));
  const inst = paginaInstellingOk({ bewaard: na, docId: 'd1', pagina: A4_LIGGEND, kies: { size: 'a4' } });
  // De printer houdt de DEVMODE uit Eigenschappen (A3), maar de laatste keuze telt.
  assert.equal(kop({ paginaInstelling: inst, printerPapier: PRINTER_A3, autoRotate: false }), 'A4 (210 x 297 mm)');
  assert.equal(printArgumenten({ autoRotate: false, paginaInstelling: inst, docId: 'd1' }).papier, 'a4');
});

test('volgorde: Eigenschappen A3, Pagina-instelling A4, Eigenschappen OK zonder wijziging → blijft A4', () => {
  const na = naEigenschappen(null, ok(PRINTER_A3));
  const ps = paginaInstellingOk({ bewaard: na, docId: 'd1', pagina: A4_LIGGEND, kies: { size: 'a4' } });
  // Rust vult het venster met A4 in, bovenop de bewaarde A3-DEVMODE.
  const { vooraf, instelling } = eigenschappen(ps, ongewijzigd(PRINTER_A3));
  assert.equal(vooraf.papier, 'a4');
  assert.equal(instelling, ps);
  assert.equal(printArgumenten({ autoRotate: true, paginaInstelling: instelling, docId: 'd1' }).papier, 'a4');
});

test('Eigenschappen met een formaat buiten de lijst → papier van de printer, niet verzonnen', () => {
  const a1 = info('overig', 594, 841, 'portrait', 'A1');
  const inst = naEigenschappen({ docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true }, ok(a1));
  assert.equal(inst.size, 'printer');
  assert.deepEqual(printArgumenten({ autoRotate: true, paginaInstelling: inst, docId: 'd1' }),
    { orientatie: 'auto', papier: 'printer' });
  assert.equal(kop({ paginaInstelling: inst, printerPapier: a1, pagina: A4_STAAND }), 'A1 (594 x 841 mm)');
  assert.equal(kop({ paginaInstelling: inst, printerPapier: a1, pagina: A4_LIGGEND }), 'A1 (594 x 841 mm)');
});

test('Eigenschappen: vel dat de driver niet kan beschrijven → papier van de printer', () => {
  // Rust geeft bij OK altijd een PapierInfo; zonder maten wordt het 'overig'.
  const onbekend = ok({ papier: 'overig', naam: '', breedteMm: 0, hoogteMm: 0, orientatie: 'portrait' });
  const inst = naEigenschappen({ docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true }, onbekend);
  assert.equal(inst.size, 'printer');
  assert.equal(kop({ paginaInstelling: inst, printerPapier: normaliseerPapierInfo(onbekend) }), STANDAARD);
});

test('Eigenschappen zonder vlaggen (ouder antwoord): vergelijken met de voorinvulling', () => {
  const ps = { docId: 'd1', size: 'a3', orientation: 'landscape', handmatig: true };
  // Zelfde papier en oriëntatie als vooringevuld → niets veranderd.
  assert.equal(naEigenschappen(ps, info('a3', 297, 420, 'landscape', 'A3'), { autoRotate: false }), ps);
  // Ander papier → overgenomen.
  assert.equal(naEigenschappen(ps, info('a4', 210, 297, 'landscape', 'A4'), { autoRotate: false }).size, 'a4');
});

test('Eigenschappen geannuleerd, of Linux/macOS (null) → er verandert niets', () => {
  const huidig = { docId: 'd1', size: 'a4', orientation: 'landscape', handmatig: true, marginLeft: 10 };
  assert.equal(instellingNaEigenschappen({ papierInfo: null, docId: 'd1', huidig }), null);
  assert.equal(instellingNaEigenschappen({ papierInfo: true, docId: 'd1', huidig }), null);
  assert.equal(naEigenschappen(huidig, null), huidig);
});

// --- Ander document, andere printer -----------------------------------------------

test('ander document: de keuze van d1 geldt niet, de kop toont het papier van de printer', () => {
  const inst = naEigenschappen(null, ok(PRINTER_A3), { pagina: A4_STAAND });
  assert.equal(kop({ paginaInstelling: inst, docId: 'd2', printerPapier: PRINTER_A4, pagina: A4_STAAND }),
    'A4 (210 x 297 mm)');
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: inst, docId: 'd2' }),
    { orientatie: 'auto', papier: 'printer' });
  // Rust houdt de DEVMODE uit Eigenschappen per printer: printer_papier meldt A3.
  assert.equal(kop({ paginaInstelling: inst, docId: 'd2', printerPapier: PRINTER_A3, pagina: A4_STAAND }),
    'A3 (297 x 420 mm)');
});

test('andere printer zonder Pagina-instelling: de kop volgt het papier van die printer', () => {
  const papierPerPrinter = new Map([['A3-printer', PRINTER_A3], ['US-printer', PRINTER_LETTER]]);
  const voor = (printer) => kop({ printerPapier: papierPerPrinter.get(printer), pagina: A4_STAAND });
  assert.equal(voor('A3-printer'), 'A3 (297 x 420 mm)');
  assert.equal(voor('US-printer'), 'Letter (216 x 279 mm)');
  assert.equal(voor('nog-niet-opgehaald'), null);
});

test('andere printer mét Pagina-instelling: het gekozen papier gaat mee naar de nieuwe printer', () => {
  const inst = naEigenschappen(null, ok(PRINTER_A3), { pagina: A4_STAAND });
  assert.equal(kop({ paginaInstelling: inst, printerPapier: PRINTER_LETTER, pagina: A4_STAAND }), 'A3 (297 x 420 mm)');
  assert.equal(printArgumenten({ autoRotate: true, paginaInstelling: inst, docId: 'd1' }).papier, 'a3');
});

// --- Onbekend, laden, printerstandaard ----------------------------------------------

test('papier onbekend (Linux/macOS): printerstandaard, tenzij de Pagina-instelling een formaat heeft', () => {
  assert.equal(kop({ printerPapier: null }), STANDAARD);
  const inst = { docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true };
  assert.equal(kop({ paginaInstelling: inst, printerPapier: null, pagina: A4_STAAND }), 'A3 (297 x 420 mm)');
});

test('printer_papier loopt nog: niets tonen, behalve als de Pagina-instelling al beslist', () => {
  const e = effectiefPapier({ paginaInstelling: null, docId: 'd1', autoRotate: true, printerPapier: undefined, pagina: A4_STAAND });
  assert.equal(e.bron, 'laden');
  assert.equal(papierTekst(e, STANDAARD), null);
  const inst = { docId: 'd1', size: 'a5', orientation: 'portrait', handmatig: true };
  assert.equal(kop({ paginaInstelling: inst, printerPapier: undefined, pagina: A4_STAAND }), 'A5 (148 x 210 mm)');
});

test('Pagina-instelling met Standaard van de printer: papier van de printer, oriëntatie uit de instelling', () => {
  const inst = { docId: 'd1', size: 'printer', orientation: 'landscape', handmatig: true };
  const e = effectiefPapier({ paginaInstelling: inst, docId: 'd1', autoRotate: false, printerPapier: PRINTER_A4, pagina: A4_STAAND });
  assert.equal(e.bron, 'printer');
  assert.equal(papierTekst(e, STANDAARD), 'A4 (210 x 297 mm)');
  assert.equal(e.orientatie, 'landscape');
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: inst, docId: 'd1' }),
    { orientatie: 'landscape', papier: 'printer' });
});

test('bron: welke regel won', () => {
  const inst = { docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true };
  const bron = (p) => effectiefPapier({ autoRotate: true, docId: 'd1', pagina: A4_STAAND, ...p }).bron;
  assert.equal(bron({ paginaInstelling: inst, printerPapier: PRINTER_A4 }), 'paginaInstelling');
  assert.equal(bron({ paginaInstelling: null, printerPapier: PRINTER_A4 }), 'printer');
  assert.equal(bron({ paginaInstelling: null, printerPapier: null }), 'onbekend');
  assert.equal(bron({ paginaInstelling: null, printerPapier: undefined }), 'laden');
});

// --- Tekst ------------------------------------------------------------------------

test('tekst: bekende formaten met de maten uit de Pagina-instelling, ook als de driver afrondt', () => {
  assert.equal(kop({ printerPapier: PRINTER_LETTER, pagina: A4_STAAND }), 'Letter (216 x 279 mm)');
  // Een driver die het formaat anders noemt verandert de naam niet.
  assert.equal(kop({ printerPapier: info('a3', 297, 420, 'portrait', 'A3 (297 x 420 mm)'), pagina: A4_STAAND }),
    'A3 (297 x 420 mm)');
});

test('tekst: overige formaten met en zonder naam of maten', () => {
  const k = (p) => kop({ printerPapier: p, pagina: A4_STAAND });
  assert.equal(k(info('overig', 500.4, 700.6, 'portrait', 'Poster')), 'Poster (500 x 701 mm)');
  assert.equal(k(info('overig', 500, 700, 'portrait', 'Custom 500 x 700 mm')), 'Custom 500 x 700 mm');
  assert.equal(k(info('overig', 500, 700, 'portrait', '')), '500 x 700 mm');
  assert.equal(k(info('overig', 0, 0, 'portrait', 'Envelop C5')), 'Envelop C5');
  assert.equal(k(info('overig', 0, 0, 'portrait', '')), STANDAARD);
});

test('paginatekst: hele millimeters, onbekend → null', () => {
  assert.equal(paginaTekst(pt(420), pt(297)), '420 x 297 mm');
  assert.equal(paginaTekst(612, 792), '216 x 279 mm');
  assert.equal(paginaTekst(NaN, 100), null);
  assert.equal(paginaTekst(0, 0), null);
});

// --- Verouderde antwoorden van printer_papier ------------------------------------------

test('verzoeken: alleen het laatste antwoord voor de nog gekozen printer telt', () => {
  const v = maakPapierVerzoeken();
  const a = v.begin();
  const b = v.begin();
  assert.equal(v.actueel(a, 'P1', 'P1'), false, 'ingehaald door een nieuwer verzoek');
  assert.equal(v.actueel(b, 'P2', 'P2'), true);
  assert.equal(v.actueel(b, 'P2', 'P1'), false, 'printer intussen gewisseld');
});

test('verzoeken: een keuze uit Eigenschappen laat lopende verzoeken vervallen', () => {
  const v = maakPapierVerzoeken();
  const nr = v.begin();
  v.vervallen();
  assert.equal(v.actueel(nr, 'P1', 'P1'), false);
  assert.equal(v.actueel(v.begin(), 'P1', 'P1'), true);
});

// --- Vertalingen van de kop ---------------------------------------------------------

test('alle locales hebben de papierkop met dezelfde plaatshouders als Engels', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const map = join(dirname(fileURLToPath(import.meta.url)), '../i18n/locales');
  const plaatshouders = (s) => (String(s).match(/\{\{\w+\}\}/g) || []).sort();
  const lees = (taal) => JSON.parse(readFileSync(join(map, taal, 'dialogs.json'), 'utf8'));
  const en = lees('en');
  const talen = readdirSync(map);
  assert.equal(talen.length, 39);
  for (const taal of talen) {
    const d = lees(taal);
    for (const sleutel of ['paperLabel', 'pageSizeLabel']) {
      const tekst = d.print?.[sleutel];
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} print.${sleutel} ontbreekt`);
      assert.deepEqual(plaatshouders(tekst), plaatshouders(en.print[sleutel]), `${taal} print.${sleutel}`);
    }
    // Onbekend papier toont de bestaande tekst uit de Pagina-instelling.
    assert.ok(d.pageSetup?.printerDefault?.trim(), `${taal} pageSetup.printerDefault ontbreekt`);
  }
});
