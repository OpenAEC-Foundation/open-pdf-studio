// Welk papier de printdialoog toont en hoe Eigenschappen, Pagina-instelling
// en print_pdf het eens blijven (issue #406: A3 gekozen, A4 afgedrukt).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPapierFormaat, normaliseerPapierInfo, effectiefPapier, papierTekst,
  paginaTekst, eigenschappenVooraf, instellingNaEigenschappen, maakPapierVerzoeken,
  papierVerzoekSleutel, bekendVel,
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
    normaliseerPapierInfo({ papier: 'b1', naam: ' B1 ', breedteMm: 1000, hoogteMm: 707, orientatie: 'landscape' }),
    { papier: 'overig', naam: 'B1', breedteMm: 707, hoogteMm: 1000, orientatie: 'landscape' },
  );
  // A1 staat sinds de grote en verlengde vellen wel in de lijst.
  assert.deepEqual(
    normaliseerPapierInfo({ papier: 'a1', naam: ' ISOA1 ', breedteMm: 841, hoogteMm: 594, orientatie: 'landscape' }),
    { papier: 'a1', naam: 'ISOA1', breedteMm: 594, hoogteMm: 841, orientatie: 'landscape' },
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
  const b1 = info('overig', 707, 1000, 'portrait', 'B1');
  const inst = naEigenschappen({ docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true }, ok(b1));
  assert.equal(inst.size, 'printer');
  assert.deepEqual(printArgumenten({ autoRotate: true, paginaInstelling: inst, docId: 'd1' }),
    { orientatie: 'auto', papier: 'printer' });
  assert.equal(kop({ paginaInstelling: inst, printerPapier: b1, pagina: A4_STAAND }), 'B1 (707 x 1000 mm)');
  assert.equal(kop({ paginaInstelling: inst, printerPapier: b1, pagina: A4_LIGGEND }), 'B1 (707 x 1000 mm)');
});

test('Eigenschappen: A1 of een verlengd vel gekozen → dat formaat in de Pagina-instelling', () => {
  // De pdf-driver van Windows noemt A1 "ISOA1"; Rust herkent de maat.
  const a1 = info('a1', 594, 841, 'portrait', 'ISOA1');
  const inst = naEigenschappen({ docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true }, ok(a1));
  assert.equal(inst.size, 'a1');
  assert.deepEqual(printArgumenten({ autoRotate: true, paginaInstelling: inst, docId: 'd1' }),
    { orientatie: 'auto', papier: 'a1' });
  assert.equal(kop({ paginaInstelling: inst, printerPapier: a1, pagina: A4_STAAND }), 'A1 (594 x 841 mm)');
  // Een formulier van de printserver met de maat van A3L.
  const a3l = info('a3l', 297, 630, 'landscape', 'A3L');
  const lang = naEigenschappen(null, ok(a3l));
  assert.equal(lang.size, 'a3l');
  assert.equal(lang.orientation, 'landscape');
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

// --- Grote en verlengde vellen, en een driver die het formaat niet aankan ------------

const PS = (size, orientation = 'portrait') => ({ docId: 'd1', size, orientation, handmatig: true });

test('kop: A1, A0 en de verlengde vellen uit de Pagina-instelling', () => {
  assert.equal(kop({ paginaInstelling: PS('a1'), printerPapier: PRINTER_A4 }), 'A1 (594 x 841 mm)');
  assert.equal(kop({ paginaInstelling: PS('a0'), printerPapier: PRINTER_A4 }), 'A0 (841 x 1189 mm)');
  assert.equal(kop({ paginaInstelling: PS('a3l'), printerPapier: PRINTER_A4 }), 'A3L (297 x 630 mm)');
  assert.equal(kop({ paginaInstelling: PS('a2l'), printerPapier: PRINTER_A4 }), 'A2L (420 x 804 mm)');
  assert.equal(kop({ paginaInstelling: PS('a1l', 'landscape'), printerPapier: PRINTER_A4 }), 'A1L (594 x 1051 mm)');
  assert.equal(kop({ paginaInstelling: PS('a0l'), printerPapier: PRINTER_A4 }), 'A0L (841 x 1399 mm)');
  assert.ok(isPapierFormaat('a3l') && isPapierFormaat('a0') && !isPapierFormaat('a4l'));
});

test('kop: papier van de printer is een groot of verlengd vel', () => {
  assert.equal(kop({ printerPapier: info('a1', 594, 841, 'portrait', 'ISOA1'), pagina: A4_STAAND }), 'A1 (594 x 841 mm)');
  assert.equal(kop({ printerPapier: info('a1l', 594, 1051, 'landscape', ''), pagina: A4_STAAND }), 'A1L (594 x 1051 mm)');
});

test('driver neemt het formaat over: de kop toont het formaat, niets geweigerd', () => {
  const e = effectiefPapier({
    paginaInstelling: PS('a3l'), docId: 'd1', autoRotate: true, printerPapier: undefined,
    opdrachtPapier: info('a3l', 297, 630, 'portrait', ''), pagina: A4_STAAND,
  });
  assert.equal(e.bron, 'paginaInstelling');
  assert.equal(e.geweigerd, null);
  assert.equal(papierTekst(e, STANDAARD), 'A3L (297 x 630 mm)');
});

test('driver kan het formaat niet aan (A0L op de pdf-printer): de kop toont het papier van de printer', () => {
  const e = effectiefPapier({
    paginaInstelling: PS('a0l'), docId: 'd1', autoRotate: true, printerPapier: undefined,
    opdrachtPapier: PRINTER_A4, pagina: A4_LIGGEND,
  });
  assert.equal(e.bron, 'printer');
  assert.equal(e.papier, 'a4');
  assert.equal(e.geweigerd, 'A0L');
  assert.deepEqual([e.breedteMm, e.hoogteMm], [210, 297]);
  assert.equal(papierTekst(e, STANDAARD), 'A4 (210 x 297 mm)');
  // Automatisch draaien: de oriëntatie volgt nog steeds de getoonde pagina.
  assert.equal(e.orientatie, 'landscape');
});

test('driver kan het formaat niet aan en meldt een vel buiten de lijst: naam en maten van de printer', () => {
  const e = effectiefPapier({
    paginaInstelling: PS('a0l', 'landscape'), docId: 'd1', autoRotate: false, printerPapier: undefined,
    opdrachtPapier: info('overig', 914, 1219, 'portrait', 'Architecture ESheet'), pagina: A4_STAAND,
  });
  assert.equal(e.geweigerd, 'A0L');
  assert.equal(papierTekst(e, STANDAARD), 'Architecture ESheet (914 x 1219 mm)');
  assert.equal(e.orientatie, 'landscape');
});

test('zelfde vel onder een andere sleutel of nog geen antwoord: het formaat blijft staan', () => {
  const vraag = (opdrachtPapier) => effectiefPapier({
    paginaInstelling: PS('a3l'), docId: 'd1', autoRotate: true, printerPapier: undefined, opdrachtPapier, pagina: A4_STAAND,
  });
  // Driver-eigen vel van dezelfde maat (op 3 mm) dat Rust niet herkende.
  assert.equal(vraag(info('overig', 296, 632, 'portrait', 'Lang A3')).geweigerd, null);
  // 4 mm langer: een ander vel.
  assert.equal(vraag(info('overig', 297, 634, 'portrait', 'Lang A3')).geweigerd, 'A3L');
  // Nog aan het ophalen, of onbekend (Linux/macOS, driver geeft niets): niets beweren.
  for (const geenAntwoord of [undefined, null, true, {}]) {
    const e = vraag(geenAntwoord);
    assert.equal(e.geweigerd, null);
    assert.equal(e.bron, 'paginaInstelling');
    assert.equal(papierTekst(e, STANDAARD), 'A3L (297 x 630 mm)');
  }
  // Zonder maten: alleen een ander bekend formaat is zeker een ander vel.
  assert.equal(vraag(info('overig', 0, 0, 'portrait', 'Iets')).geweigerd, null);
  assert.equal(vraag(info('a4', 0, 0, 'portrait', 'A4')).geweigerd, 'A3L');
});

// --- Het vel voor de schaal van het voorbeeld en de afdruk ---------------------

test('bekend vel: de maten uit de kop, staand; zonder papier of maten null', () => {
  const vel = (opties) => bekendVel(effectiefPapier({ docId: 'd1', autoRotate: true, pagina: A4_LIGGEND, ...opties }));
  // Pagina-instelling met een formaat: dat vel, ook als de printer nog niets meldde.
  assert.deepEqual(vel({ paginaInstelling: PS('a1'), printerPapier: undefined }), { breedteMm: 594, hoogteMm: 841 });
  // Het papier van de printer.
  assert.deepEqual(vel({ printerPapier: PRINTER_A3 }), { breedteMm: 297, hoogteMm: 420 });
  assert.deepEqual(vel({ printerPapier: info('overig', 700, 500, 'landscape', 'Poster') }), { breedteMm: 500, hoogteMm: 700 });
  // De driver kan het formaat niet aan: het vel waarop echt geprint wordt.
  assert.deepEqual(
    vel({ paginaInstelling: PS('a0l'), printerPapier: undefined, opdrachtPapier: PRINTER_A4 }),
    { breedteMm: 210, hoogteMm: 297 },
  );
  // Nog aan het ophalen, onbekend, of een formulier zonder maten: geen vel.
  assert.equal(vel({ printerPapier: undefined }), null);
  assert.equal(vel({ printerPapier: null }), null);
  assert.equal(vel({ printerPapier: info('overig', 0, 0, 'portrait', 'Envelop C5') }), null);
  assert.equal(bekendVel(null), null);
});

test('papier aan de printer gelaten: een antwoord voor een opdracht speelt geen rol', () => {
  const e = effectiefPapier({
    paginaInstelling: PS('printer'), docId: 'd1', autoRotate: true,
    printerPapier: PRINTER_A3, opdrachtPapier: PRINTER_A4, pagina: A4_STAAND,
  });
  assert.equal(e.bron, 'printer');
  assert.equal(e.geweigerd, null);
  assert.equal(papierTekst(e, STANDAARD), 'A3 (297 x 420 mm)');
});

test('antwoorden van printer_papier per printer en per gevraagd papier', () => {
  assert.equal(papierVerzoekSleutel('Plotter', 'a1l'), 'Plotter\na1l');
  assert.equal(papierVerzoekSleutel('Plotter', 'printer'), 'Plotter\nprinter');
  // Alles wat geen formaat is vraagt om het papier van de printer.
  assert.equal(papierVerzoekSleutel('Plotter', undefined), 'Plotter\nprinter');
  assert.equal(papierVerzoekSleutel('Plotter', 'onzin'), 'Plotter\nprinter');
  assert.notEqual(papierVerzoekSleutel('Plotter', 'a1'), papierVerzoekSleutel('Plotter', 'a1l'));
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
    for (const sleutel of ['paperLabel', 'pageSizeLabel', 'paperFallback']) {
      const tekst = d.print?.[sleutel];
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} print.${sleutel} ontbreekt`);
      assert.deepEqual(plaatshouders(tekst), plaatshouders(en.print[sleutel]), `${taal} print.${sleutel}`);
    }
    // Onbekend papier toont de bestaande tekst uit de Pagina-instelling.
    assert.ok(d.pageSetup?.printerDefault?.trim(), `${taal} pageSetup.printerDefault ontbreekt`);
    // De terugvalkop is per taal vertaald, niet de Engelse tekst overgenomen.
    if (taal !== 'en') assert.notEqual(d.print.paperFallback, en.print.paperFallback, `${taal} print.paperFallback`);
  }
});

test('alle locales noemen de virtuele printer bij zijn naam', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const map = join(dirname(fileURLToPath(import.meta.url)), '../i18n/locales');
  for (const taal of readdirSync(map)) {
    const tekst = JSON.parse(readFileSync(join(map, taal, 'preferences.json'), 'utf8')).virtualPrinter.description;
    assert.ok(tekst.includes('Open PDF Printer'), `${taal}: naam van de printer ontbreekt`);
    assert.ok(!tekst.includes('Open PDF Studio'), `${taal}: oude printernaam staat er nog`);
  }
});
