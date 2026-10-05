// Rotatie en doosmaat van een tekstvak bij het inlezen, over de pagina-
// rotaties en appearance-conventies heen.
//
// Elke test schrijft echte PDF-bytes (pagina-/Rotate, FreeText-dict en
// appearance zoals de betreffende schrijver hem maakt), leest ze terug met
// extractAnnotationColors en leidt rotatie en maat af zoals
// annotation-converter.js dat doet.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { extractAnnotationColors } from './color-extraction.js';
import { tekstvakRotatie, tekstvakMaat } from './tekstvak-rotatie.js';

const B = 595;
const H = 842;
const W_VAK = 140;
const H_VAK = 34;
const TOL = 0.01;

// Weergaveruimte zoals PDF.js' PageViewport op schaal 1.
function naarWeergave(r, x, y) {
  if (r === 90) return [y, x];
  if (r === 180) return [B - x, y];
  if (r === 270) return [H - y, B - x];
  return [x, H - y];
}
function weergaveRect(rect, r) {
  const [ax, ay] = naarWeergave(r, rect[0], rect[1]);
  const [bx, by] = naarWeergave(r, rect[2], rect[3]);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

const TEKST = 'BT\n0 0 0 rg 0 Tc 0 Tw 100 Tz 0 Tr\n/Helvetica 14 Tf\n1 19.6 Td\n(vak) Tj\n-1 -19.6 Td\nET\n';

/**
 * Appearance zoals de huidige saver hem schrijft (saver.js, FreeText-tak):
 * één rotatie-cm rond het midden met hoek (rotatie − paginarotatie), het vak
 * op zijn ongedraaide maat. Geeft content en /Rect (omhullende in PDF-ruimte).
 */
function saverAppearance({ rotatie, paginaRotatie, cx = 300, cy = 400, w = W_VAK, h = H_VAK }) {
  const apRotation = (((rotatie - paginaRotatie) % 360) + 360) % 360;
  const rad = -apRotation * Math.PI / 180;
  const cosR = Math.round(Math.cos(rad) * 1e6) / 1e6;
  const sinR = Math.round(Math.sin(rad) * 1e6) / 1e6;
  const c = Math.abs(cosR), s = Math.abs(sinR);
  const hw = (w * c + h * s) / 2, hh = (w * s + h * c) / 2;
  const content = `q\n1 0 0 1 ${cx} ${cy} cm\n${cosR} ${sinR} ${-sinR} ${cosR} 0 0 cm\n`
    + `1 0 0 1 ${-w / 2} ${-h / 2} cm\n1 w\n0 0 0 RG\n0 0 ${w} ${h} re S\n${TEKST}Q\n`;
  return { content, rect: [cx - hw, cy - hh, cx + hw, cy + hh] };
}

/** Ongedraaide appearance in absolute PDF-coördinaten (vak + tekstclip). */
function platteAppearance({ x = 230, y = 383, w = W_VAK, h = H_VAK, signatuur = true }) {
  const tekst = signatuur ? TEKST : TEKST.replace('0 Tc 0 Tw 100 Tz 0 Tr', '');
  const content = `1 w\n0 0 0 RG\n${x} ${y} ${w} ${h} re S\n${x} ${y} ${w} ${h} re W n\n${tekst}`;
  return { content, rect: [x, y, x + w, y + h] };
}

/** Eén FreeText op een pagina met `paginaRotatie`; geeft PDF-bytes. */
async function schrijf({ paginaRotatie = 0, ap, sleutels = {}, matrix }) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([B, H]);
  if (paginaRotatie) pagina.node.set(PDFName.of('Rotate'), doc.context.obj(paginaRotatie));
  const context = doc.context;
  const [x1, y1] = ap.rect;
  const n = context.stream(ap.content, {
    Type: 'XObject', Subtype: 'Form',
    BBox: ap.bbox || ap.rect,
    Matrix: matrix || [1, 0, 0, 1, -x1, -y1],
  });
  const annot = context.obj({
    Type: 'Annot', Subtype: 'FreeText', Rect: ap.rect, Contents: 'vak',
    DA: '0 0 0 rg /Helvetica 14 Tf', ...sleutels,
    AP: context.obj({ N: context.register(n) }),
  });
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(annot)]));
  return doc.save();
}

/** Terug inlezen zoals loader + annotation-converter. */
async function laad(bytes, { paginaRotatie = 0, annotRotatie = 0, noRotate = false } = {}) {
  const doc = await PDFDocument.load(bytes);
  const kaart = await extractAnnotationColors(1, doc);
  assert.equal(kaart.size, 1);
  const [sleutel, extra] = [...kaart.entries()][0];
  const rect = sleutel.split(',').map(Number);
  const rotatie = tekstvakRotatie({ extra, annotRotatie, paginaRotatie, noRotate });
  const maat = tekstvakMaat({ rotatie, extra, rect, rectVp: weergaveRect(rect, paginaRotatie) });
  return { rotatie, ...maat, extra };
}

function verwacht(uit, rotatie, w, h, label) {
  assert.equal(uit.rotatie, rotatie, `${label}: rotatie`);
  assert.ok(Math.abs(uit.width - w) <= TOL, `${label}: breedte ${uit.width} ≠ ${w}`);
  assert.ok(Math.abs(uit.height - h) <= TOL, `${label}: hoogte ${uit.height} ≠ ${h}`);
}

// ── Gevallen die al goed gingen en zo moeten blijven ────────────────────────

test('ongedraaide pagina: verouderde rotatiesleutel naast ongedraaide appearance geeft 0', async () => {
  // Restant van een oudere saver-generatie: /Rotation 270 + /OPS_Rotation -90,
  // terwijl de appearance een horizontaal vak met horizontale tekst tekent.
  const ap = platteAppearance({});
  const bytes = await schrijf({ ap, sleutels: { OPS_Rotation: -90, Rotation: 270 } });
  verwacht(await laad(bytes), 0, W_VAK, H_VAK, 'verouderde sleutel');
});

test('ongedraaide pagina: sleutel 0 en ongedraaide appearance geeft 0', async () => {
  const bytes = await schrijf({ ap: platteAppearance({}), sleutels: { OPS_Rotation: 0 } });
  verwacht(await laad(bytes), 0, W_VAK, H_VAK, 'sleutel 0');
});

test('ongedraaide pagina: gedraaide appearance van de saver houdt zijn hoek', async () => {
  for (const rotatie of [90, -90, 45, -55]) {
    const bytes = await schrijf({ ap: saverAppearance({ rotatie, paginaRotatie: 0 }), sleutels: { OPS_Rotation: rotatie } });
    verwacht(await laad(bytes), rotatie, W_VAK, H_VAK, `rotatie ${rotatie}`);
  }
});

test('oude-saver-uitvoer op een 90°-blad (apLegacyUnrotated) herstelt naar 0', async () => {
  // Geen /OPS_Rotation, alleen-translatie-/Matrix, eigen tekststaat-signatuur,
  // vak ongedraaid in PDF-ruimte (34 breed, 140 hoog = 140×34 in de weergave).
  const ap = platteAppearance({ w: H_VAK, h: W_VAK });
  const bytes = await schrijf({ paginaRotatie: 90, ap });
  const uit = await laad(bytes, { paginaRotatie: 90 });
  assert.equal(uit.extra.apLegacyUnrotated, true);
  verwacht(uit, 0, W_VAK, H_VAK, 'oude saver');
});

test('rotatie in de /Matrix: de guard vuurt niet', async () => {
  // Externe editor: rotatie volledig in de AP-/Matrix, content zonder
  // rotatie-cm, /Rotation als metadata, /Rect = omhullende.
  const ap = {
    content: '1 1 1 rg 1 0 0 RG 1 w\n256.325 613.185 119 17 re B\n256.325 613.185 119 17 re W n\n'
      + 'BT\n0 0 0 rg 0 Tc 0 Tw 100 Tz 0 Tr/F0 12 Tf 257.8246 617.8251 Td\n(vak)Tj\nET\n',
    rect: [278.030396, 565.223633, 353.618896, 678.146667],
    bbox: [255.824615, 612.68512, 375.824615, 630.68512],
  };
  const bytes = await schrijf({
    ap, sleutels: { Rotation: -60 },
    matrix: [0.5, 0.866025, -0.866025, 0.5, -255.824615, -612.68512],
  });
  const uit = await laad(bytes);
  assert.equal(uit.extra.apHasRotationOp, false);
  verwacht(uit, -60, 119, 17, 'matrix-rotatie');
});

test('90°-blad: appearance met rotatie-cm volgt de sleutel', async () => {
  // Op een /Rotate 90-blad schrijft de saver een rotatie-cm van
  // (rotatie − 90) graden; zolang die niet 0 is, doet de guard niets.
  for (const rotatie of [0, 135, 180, 35]) {
    const bytes = await schrijf({ paginaRotatie: 90, ap: saverAppearance({ rotatie, paginaRotatie: 90 }), sleutels: { OPS_Rotation: rotatie } });
    verwacht(await laad(bytes, { paginaRotatie: 90 }), rotatie, W_VAK, H_VAK, `rotatie ${rotatie}`);
  }
});

test('NoRotate op een 90°-blad: ongedraaide appearance blijft rechtop (0)', async () => {
  // NoRotate: de appearance draait niet mee met de pagina, dus een
  // ongedraaide appearance staat op het scherm rechtop.
  const ap = platteAppearance({ signatuur: false });
  const bytes = await schrijf({ paginaRotatie: 90, ap, sleutels: { F: 4 | 16 } });
  const uit = await laad(bytes, { paginaRotatie: 90, noRotate: true });
  assert.equal(uit.rotatie, 0);
});

// ── #429: geen rotatie-operator op een gedraaide pagina ─────────────────────
//
// Een vak waarvan de weergaverotatie gelijk is aan de paginarotatie krijgt
// van de saver netto géén rotatie-cm (compensatie −R plus eigen draai +R).
// Zo'n appearance staat op het scherm juist in de paginarotatie, niet op 0.

test('#429: vak met de paginarotatie op een 90°-blad houdt rotatie 90 en 140×34', async () => {
  const bytes = await schrijf({ paginaRotatie: 90, ap: saverAppearance({ rotatie: 90, paginaRotatie: 90 }), sleutels: { OPS_Rotation: 90 } });
  const uit = await laad(bytes, { paginaRotatie: 90 });
  assert.equal(uit.extra.apHasRotationOp, false);
  verwacht(uit, 90, W_VAK, H_VAK, 'blad 90');
});

test('#429: hetzelfde op een 180°-blad (rotatie 180) en een 270°-blad (rotatie −90 of 270)', async () => {
  const gevallen = [[180, 180], [270, -90], [270, 270]];
  for (const [paginaRotatie, rotatie] of gevallen) {
    const bytes = await schrijf({ paginaRotatie, ap: saverAppearance({ rotatie, paginaRotatie }), sleutels: { OPS_Rotation: rotatie } });
    verwacht(await laad(bytes, { paginaRotatie }), rotatie, W_VAK, H_VAK, `blad ${paginaRotatie} rotatie ${rotatie}`);
  }
});

test('#429: afwijkende sleutel naast een ongedraaide appearance op een 90°-blad wordt 90', async () => {
  // De appearance beslist: zonder rotatie-operator is de weergaverotatie de
  // paginarotatie, wat de sleutel ook zegt.
  const bytes = await schrijf({ paginaRotatie: 90, ap: saverAppearance({ rotatie: 90, paginaRotatie: 90 }), sleutels: { OPS_Rotation: -90 } });
  verwacht(await laad(bytes, { paginaRotatie: 90 }), 90, W_VAK, H_VAK, 'afwijkende sleutel');
});

test('#429: extern vak zonder sleutel op een 90°-blad volgt de paginarotatie', async () => {
  // Geen /OPS_Rotation en geen eigen tekststaat-signatuur (dus geen
  // oude-saver-uitvoer): elke lezer toont het vak meegedraaid met de pagina.
  const ap = platteAppearance({ signatuur: false });
  const bytes = await schrijf({ paginaRotatie: 90, ap });
  const uit = await laad(bytes, { paginaRotatie: 90 });
  assert.equal(uit.extra.apLegacyUnrotated, undefined);
  verwacht(uit, 90, W_VAK, H_VAK, 'extern zonder sleutel');
});

// ── Een halve slag telt als rotatie ─────────────────────────────────────────
//
// Staat een vak 180 graden gedraaid ten opzichte van de pagina, dan schrijft
// de saver `-1 0 0 -1 0 0 cm`: b en c zijn 0, maar het is wel een rotatie.

test('180° ten opzichte van de pagina: de sleutel blijft staan', async () => {
  const gevallen = [[0, 180], [90, -90], [270, 90], [180, 0]];
  for (const [paginaRotatie, rotatie] of gevallen) {
    const bytes = await schrijf({ paginaRotatie, ap: saverAppearance({ rotatie, paginaRotatie }), sleutels: { OPS_Rotation: rotatie } });
    const uit = await laad(bytes, { paginaRotatie });
    assert.equal(uit.extra.apHasRotationOp, true, `blad ${paginaRotatie} rotatie ${rotatie}: rotatie-operator`);
    verwacht(uit, rotatie, W_VAK, H_VAK, `blad ${paginaRotatie} rotatie ${rotatie}`);
  }
});

test('spiegeling (één negatieve as) telt niet als rotatie', async () => {
  const ap = platteAppearance({});
  ap.content = `1 0 0 -1 0 ${2 * 400} cm\n${ap.content}`;
  const bytes = await schrijf({ ap, sleutels: { OPS_Rotation: -90 } });
  const uit = await laad(bytes);
  assert.equal(uit.extra.apHasRotationOp, false);
  assert.equal(uit.rotatie, 0);
});

test('rondgang in de saver-conventie: elke hoek op elke paginarotatie komt terug', async () => {
  for (const paginaRotatie of [0, 90, 180, 270]) {
    for (const rotatie of [0, 90, -90, 180, 270, 45, -55, 135, 35, -135]) {
      const ap = (paginaRotatie === 0 && rotatie === 0)
        ? platteAppearance({})
        : saverAppearance({ rotatie, paginaRotatie });
      const bytes = await schrijf({ paginaRotatie, ap, sleutels: { OPS_Rotation: rotatie } });
      verwacht(await laad(bytes, { paginaRotatie }), rotatie, W_VAK, H_VAK, `blad ${paginaRotatie} rotatie ${rotatie}`);
    }
  }
});

// ── Rotatie in /Matrix plus tekst-cm op een 90°-blad (extern vak) ───────────
//
// Een ander programma draait het vak met de /Matrix en tekent de doos-`re`
// in formulierruimte, met daarna een tekst-cm en een iets kleinere
// tekstclip-`re`. Twee verschillende `re` geven geen apInnerRect, dus de maat
// komt uit de omhullende. De hoek is een weergavehoek; de omhullende moet dan
// ook die in de weergave zijn. De PDF-/Rect heeft op een 90°-blad breedte en
// hoogte verwisseld: het vak kwam als 19×55 in plaats van 55×19 terug.

/** Appearance zoals dat programma hem schrijft (doos, tekst-cm, tekstclip). */
function matrixAppearance({ doos, clip, tekst }) {
  return `.824 .824 1 rg 0 0 1 RG 1 w\n${doos} re B\n0 -1 1 0 0 0 cm${clip ? ` ${clip} re W n` : ''}\n`
    + `BT 0 g 0 Tc 0 Tw 100 Tz 0 Tr/Helvetica 12 Tf ${tekst} Tj ET\n`;
}

const HEA160 = {
  rect: [132.5051, 146.60863, 187.69895, 165.41576],
  bbox: [105.70868, 126.165439, 124.51581, 181.35929],
  matrix: [0, -1, 1, 0, -105.70868, -126.165439],
  doos: '106.709 127.165 16.807 53.194',
  clip: '-179.859 107.209 52.194 15.807',
  tekst: '-178.3593 110.6558 Td (HEA160)',
};
const TREKSTAG = {
  rect: [201.4051, 377.52574, 266.72395, 399.48057],
  bbox: [192.72234, 357.71858, 214.67717, 423.0374],
  matrix: [0, -1, 1, 0, -192.72234, -357.71858],
  doos: '193.722 358.719 19.955 63.319',
  clip: '-421.537 194.222 62.319 18.955',
  tekst: '-420.0374 200.8172 Td (Trekstag)',
};

async function matrixVak(vak, { metClip = true } = {}) {
  const ap = {
    content: matrixAppearance({ doos: vak.doos, clip: metClip ? vak.clip : null, tekst: vak.tekst }),
    rect: vak.rect, bbox: vak.bbox,
  };
  const bytes = await schrijf({ paginaRotatie: 90, ap, sleutels: { Rotate: 270, Rotation: -270 }, matrix: vak.matrix });
  return laad(bytes, { paginaRotatie: 90, annotRotatie: 270 });
}

test('rotatie in /Matrix plus tekst-cm op een 90°-blad: breedte en hoogte niet verwisseld (HEA160)', async () => {
  const uit = await matrixVak(HEA160);
  assert.equal(uit.extra.apInnerRect, undefined, 'twee verschillende re: geen apInnerRect');
  verwacht(uit, -90, 55.19385, 18.80713, 'HEA160');
});

test('rotatie in /Matrix plus tekst-cm op een 90°-blad: breedte en hoogte niet verwisseld (Trekstag)', async () => {
  verwacht(await matrixVak(TREKSTAG), -90, 65.31885, 21.95483, 'Trekstag');
});

test('maat uit de omhullende: de omhullende in de weergave telt, niet de PDF-/Rect', () => {
  // Vak 120×20 op −30° op een 90°-blad: weergave-omhullende 113.923×77.321,
  // de PDF-/Rect is 77.321 breed en 113.923 hoog.
  const a = tekstvakMaat({ rotatie: -30, extra: {}, rect: [0, 0, 77.321, 113.923], rectVp: { width: 113.923, height: 77.321 } });
  assert.ok(Math.abs(a.width - 120) <= TOL && Math.abs(a.height - 20) <= TOL, `−30° op een 90°-blad: ${a.width}×${a.height}`);
  // Vak 120×20 op 90° op een 270°-blad: weergave 20×120, PDF-/Rect 120×20.
  const b = tekstvakMaat({ rotatie: 90, extra: {}, rect: [0, 0, 120, 20], rectVp: { width: 20, height: 120 } });
  assert.ok(Math.abs(b.width - 120) <= TOL && Math.abs(b.height - 20) <= TOL, `90° op een 270°-blad: ${b.width}×${b.height}`);
});

test('maat uit de omhullende op een 0°-blad: oriëntatie klopte al, nu ook zonder afronding', () => {
  const uit = tekstvakMaat({ rotatie: -90, extra: {}, rect: [0, 0, 18.80713, 55.19385], rectVp: { width: 18.80713, height: 55.19385 } });
  assert.ok(Math.abs(uit.width - 55.19385) <= TOL && Math.abs(uit.height - 18.80713) <= TOL, `${uit.width}×${uit.height}`);
});

test('doos-re in formulierruimte (zonder tekstclip): verkeerd georiënteerde apInnerRect wordt niet gebruikt', async () => {
  // Zonder de clip-`re` blijft alleen de doos over, getekend BUITEN de
  // tekst-cm: 16.807×53.194, een kwartslag verkeerd.
  const uit = await matrixVak(HEA160, { metClip: false });
  assert.equal(uit.extra.apInnerRect.w, 16.807);
  verwacht(uit, -90, 55.19385, 18.80713, 'HEA160 zonder clip');
});

// ── Wachters bij de oriëntatiecontrole van apInnerRect ──────────────────────

test('wachter: callout zonder /RD houdt zijn apInnerRect (Rect bevat de aanhaallijn)', () => {
  // Vak 60×20 op −90°; de aanhaallijn maakt de /Rect breder dan het vak. Uit
  // die Rect lijkt de omgewisselde oriëntatie dichterbij, maar bij een
  // callout is de Rect geen omhullende van het vak.
  const uit = tekstvakMaat({
    rotatie: -90, extra: { apInnerRect: { w: 60, h: 20 } }, callout: true,
    rect: [0, 0, 22, 63], rectVp: { width: 63, height: 22 },
  });
  assert.deepEqual(uit, { width: 60, height: 20 });
});

test('wachter: een Rect die geen omhullende is (negatieve terugrekening) laat apInnerRect staan', () => {
  // Vak 140×34 op 30° in een Rect van 138×400: de formule geeft −161×555.
  const uit = tekstvakMaat({
    rotatie: 30, extra: { apInnerRect: { w: 140, h: 34 } },
    rect: [0, 0, 400, 138], rectVp: { width: 138, height: 400 },
  });
  assert.deepEqual(uit, { width: 140, height: 34 });
});

test('wachter: bij 45° (det ≈ 0) blijft apInnerRect staan', () => {
  const omh = (140 + 34) * Math.SQRT1_2;
  for (const rotatie of [45, -45, 135, -135]) {
    const uit = tekstvakMaat({
      rotatie, extra: { apInnerRect: { w: 34, h: 140 } },
      rect: [0, 0, omh, omh], rectVp: { width: omh, height: omh },
    });
    assert.deepEqual(uit, { width: 34, height: 140 }, `rotatie ${rotatie}`);
  }
});

test('wachter: apInnerRect ver van beide oriëntaties blijft staan', () => {
  // apInnerRect 30×30 naast een omhullende van een vak 120×20: geen van de
  // twee oriëntaties ligt binnen een paar punt, dus de AP beslist.
  const uit = tekstvakMaat({
    rotatie: -90, extra: { apInnerRect: { w: 30, h: 30 } },
    rect: [0, 0, 20, 120], rectVp: { width: 20, height: 120 },
  });
  assert.deepEqual(uit, { width: 30, height: 30 });
});

test('wachter: bijna vierkant vak van de eigen saver houdt zijn maat op elke paginarotatie', async () => {
  for (const paginaRotatie of [0, 90, 180, 270]) {
    for (const rotatie of [90, -90, 30, -60, 180]) {
      const ap = saverAppearance({ rotatie, paginaRotatie, w: 40, h: 38 });
      const bytes = await schrijf({ paginaRotatie, ap, sleutels: { OPS_Rotation: rotatie } });
      verwacht(await laad(bytes, { paginaRotatie }), rotatie, 40, 38, `blad ${paginaRotatie} rotatie ${rotatie}`);
    }
  }
});
