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
