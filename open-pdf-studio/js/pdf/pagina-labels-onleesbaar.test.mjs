import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  isOnleesbareTekst, isOnleesbareTekstlaag, beoordeelVakTekst, ONLEESBAAR_AANDEEL,
  tekstInGebied, verbeterOcrTekst, ocrLezing, draaiingenVoorVak, moetGedraaidLezen,
  OCR_DRAAIINGEN, OCR_GOED_GENOEG, LIGGEND_VAK,
} from './pagina-labels.js';

// #1010: lettertypen die zonder /ToUnicode zijn ingebed. De tekstlaag geeft
// dan glyph-codes in plaats van letters. Zo'n vak is niet leeg, maar moet
// toch met OCR gelezen worden.

// Een veelvoorkomende codering zonder /ToUnicode: elke glyph-code ligt 29
// onder de letter. "BR2" wordt zo "%5" plus U+0015, "S-101" wordt "6" plus
// vier stuurtekens.
const zonderToUnicode = (tekst) => String.fromCharCode(...[...tekst].map((c) => c.charCodeAt(0) - 29));

test('de nagebootste codering geeft wat zo\'n tekstlaag oplevert', () => {
  assert.equal(zonderToUnicode('BR2'), '%5\u0015');
  assert.equal(zonderToUnicode('S-101'), '6\u0010\u0014\u0013\u0014');
});

test('isOnleesbareTekst: stuurtekens, privégebieden en U+FFFD', () => {
  for (const t of [
    zonderToUnicode('BR2'),
    zonderToUnicode('S-101'),
    zonderToUnicode('A-201'),
    '\u0014\u0013\u0014',
    'S�01',
    '',
    'A\u{F0041}',
    '\u0085',
    '\u007F',
  ]) {
    assert.equal(isOnleesbareTekst(t), true, JSON.stringify(t));
  }
});

test('isOnleesbareTekst: gewone bladnamen blijven leesbaar', () => {
  for (const t of [
    'S-101', 'A-201 Rev B', 'Blad 3\nvan 12', 'Plan\tbegane grond', 'Ø200 x 45°', 'ﬁnal',
    'Überbau', 'Fachada norte', '平面図', '%%', '', null, undefined,
  ]) {
    assert.equal(isOnleesbareTekst(t), false, JSON.stringify(t));
  }
});

test('isOnleesbareTekstlaag: aandeel over de hele pagina', () => {
  const items = (...teksten) => teksten.map((str) => ({ str }));
  const regels = ['GENERAL NOTES', 'S-101', 'Scale 1:100', 'DWG No.', 'BR2'];
  assert.equal(isOnleesbareTekstlaag(items(...regels.map(zonderToUnicode))), true);
  assert.equal(isOnleesbareTekstlaag(items(...regels)), false);
  // Eén los stuurteken op een verder gewone pagina wantrouwt de pagina niet.
  assert.equal(isOnleesbareTekstlaag(items('GENERAL NOTES AND SPECIFICATION', '\u0003')), false);
  // Precies op de grens telt als onleesbaar.
  const goed = 'A'.repeat(Math.round((1 - ONLEESBAAR_AANDEEL) * 100));
  const fout = '\u0001'.repeat(Math.round(ONLEESBAAR_AANDEEL * 100));
  assert.equal(isOnleesbareTekstlaag(items(goed, fout)), true);
  assert.equal(isOnleesbareTekstlaag(items(goed + 'A', fout.slice(1))), false);
  // Leeg, alleen witruimte of geen tekstitems: niets te wantrouwen.
  assert.equal(isOnleesbareTekstlaag([]), false);
  assert.equal(isOnleesbareTekstlaag(null), false);
  assert.equal(isOnleesbareTekstlaag(items('   ', '\n')), false);
  assert.equal(isOnleesbareTekstlaag([{ type: 'beginMarkedContent' }, { str: 'S-101' }]), false);
  assert.ok(ONLEESBAAR_AANDEEL > 0 && ONLEESBAAR_AANDEEL < 1);
});

test('beoordeelVakTekst: wat direct telt, wat terugval is en wat naar OCR gaat', () => {
  // Gewone pagina, gewone tekst: direct.
  assert.deepEqual(beoordeelVakTekst('S-101', false), { direct: 'S-101', terugval: '' });
  // Glyph-codes: nooit gebruiken, altijd OCR.
  assert.deepEqual(beoordeelVakTekst(zonderToUnicode('S-101'), false), { direct: '', terugval: '' });
  assert.deepEqual(beoordeelVakTekst(zonderToUnicode('S-101'), true), { direct: '', terugval: '' });
  // Letters zonder /ToUnicode worden vaak gewone leestekens en cijfers
  // ("GROUND" wordt "*5258'"): op een onleesbare pagina eerst OCR, met deze
  // tekst als terugval.
  const schoon = zonderToUnicode('GROUND');
  assert.equal(isOnleesbareTekst(schoon), false);
  assert.deepEqual(beoordeelVakTekst(schoon, true), { direct: '', terugval: schoon });
  // Leeg vak: OCR zoals voorheen.
  assert.deepEqual(beoordeelVakTekst('', false), { direct: '', terugval: '' });
  assert.deepEqual(beoordeelVakTekst('  ', true), { direct: '', terugval: '' });
});

// Echte PDF.js-tekstitems van een gegenereerd blad; daarna krijgen ze de
// tekst die een tekstlaag zonder /ToUnicode zou geven.
async function bladItems() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const blad = doc.addPage([600, 400]);
  blad.drawText('GENERAL NOTES AND SPECIFICATION', { x: 40, y: 360, size: 10, font });
  blad.drawText('DWG No.', { x: 440, y: 100, size: 7, font });
  blad.drawText('S-101', { x: 440, y: 86, size: 10, font });
  blad.drawText('GROUND', { x: 440, y: 60, size: 9, font });
  // Tekeningen hebben veel maten en datums: cijfers worden zonder /ToUnicode
  // stuurtekens.
  blad.drawText('Scale 1:100', { x: 40, y: 40, size: 8, font });
  blad.drawText('Date 2026-11-10', { x: 40, y: 28, size: 8, font });
  const pdf = await getDocument({ data: await doc.save(), useSystemFonts: true }).promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    return { items, viewport };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

const NUMMERVAK = { x: 435, y: 300, width: 60, height: 18 };
const TITELVAK = { x: 435, y: 328, width: 80, height: 16 };

test('tekstlaag zonder /ToUnicode: het nummervak gaat naar OCR, het titelvak wordt terugval', async () => {
  const { items, viewport } = await bladItems();
  const leesbaar = isOnleesbareTekstlaag(items);
  assert.equal(leesbaar, false);
  assert.deepEqual(beoordeelVakTekst(tekstInGebied(items, viewport, NUMMERVAK), leesbaar), { direct: 'S-101', terugval: '' });
  assert.deepEqual(beoordeelVakTekst(tekstInGebied(items, viewport, TITELVAK), leesbaar), { direct: 'GROUND', terugval: '' });

  const kapot = items.map((it) => (typeof it.str === 'string' ? { ...it, str: zonderToUnicode(it.str) } : it));
  const onleesbaar = isOnleesbareTekstlaag(kapot);
  assert.equal(onleesbaar, true);
  const nummer = tekstInGebied(kapot, viewport, NUMMERVAK);
  assert.ok(nummer, 'het vak is niet leeg');
  assert.equal(isOnleesbareTekst(nummer), true);
  assert.deepEqual(beoordeelVakTekst(nummer, onleesbaar), { direct: '', terugval: '' });
  const titel = tekstInGebied(kapot, viewport, TITELVAK);
  assert.deepEqual(beoordeelVakTekst(titel, onleesbaar), { direct: '', terugval: zonderToUnicode('GROUND') });
});

test('verbeterOcrTekst: een $ in een code wordt S, een losse $ blijft', () => {
  assert.equal(verbeterOcrTekst('$101'), 'S101');
  assert.equal(verbeterOcrTekst('$-101 GENERAL NOTE$'), 'S-101 GENERAL NOTES');
  assert.equal(verbeterOcrTekst('$.01'), 'S.01');
  assert.equal(verbeterOcrTekst('E$01'), 'ES01');
  assert.equal(verbeterOcrTekst('Cost $ 100'), 'Cost $ 100');
  assert.equal(verbeterOcrTekst('$'), '$');
  assert.equal(verbeterOcrTekst('- $ -'), '- $ -');
  assert.equal(verbeterOcrTekst(''), '');
  assert.equal(verbeterOcrTekst(null), '');
  // ocrLezing past het toe.
  const w = { text: '$-201', left: 0, top: 0, width: 10, height: 5, confidence: 90 };
  assert.equal(ocrLezing([w], { x: 0, y: 0, width: 20, height: 10 }).tekst, 'S-201');
});

test('draaiingenVoorVak: gedraaid lezen alleen waar het nodig is', () => {
  const staand = { width: 20, height: 80 };
  const liggend = { width: 20 * LIGGEND_VAK, height: 20 };
  const zeker = { tekst: 'S-101', score: OCR_GOED_GENOEG };
  const leeg = { tekst: '', score: null };
  const onzeker = { tekst: 'l1l', score: OCR_GOED_GENOEG - 1 };
  assert.equal(moetGedraaidLezen(onzeker), true);

  // Goed genoeg bij 0°: niets extra.
  assert.deepEqual(draaiingenVoorVak(zeker, staand), []);
  assert.deepEqual(draaiingenVoorVak(zeker, staand, { graden: 90 }), []);
  // Leeg: altijd beide kwartslagen, de vorige winnaar eerst.
  assert.deepEqual(draaiingenVoorVak(leeg, liggend), OCR_DRAAIINGEN);
  assert.deepEqual(draaiingenVoorVak(leeg, staand, { graden: 0 }), OCR_DRAAIINGEN);
  assert.deepEqual(draaiingenVoorVak(leeg, staand, { graden: 270 }), [270, 90]);
  // Onzeker maar wel tekst in een liggend vak: niet draaien.
  assert.deepEqual(draaiingenVoorVak(onzeker, liggend), []);
  // Onzeker in een staand vak: draaien zoals bij #954, tenzij 0° eerder won.
  assert.deepEqual(draaiingenVoorVak(onzeker, staand), OCR_DRAAIINGEN);
  assert.deepEqual(draaiingenVoorVak(onzeker, staand, { graden: null }), OCR_DRAAIINGEN);
  assert.deepEqual(draaiingenVoorVak(onzeker, staand, { graden: 0 }), []);
  assert.deepEqual(draaiingenVoorVak(onzeker, staand, { graden: 90 }), [90, 270]);
  // Een nieuwe lijst: de standaardvolgorde blijft onaangetast.
  draaiingenVoorVak(leeg, staand).reverse();
  assert.deepEqual(OCR_DRAAIINGEN, [90, 270]);
});
