// Vul-doorzichtigheid van een meetvlak door de keten heen: de alfa uit de
// appearance lezen, en na opslaan weer dezelfde alfa terugvinden.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { fillAlphaAtFirstFill } from './ap-fill-alpha.js';
import { extractAnnotationColors } from './color-extraction.js';
import { buildMeasureAreaAP } from '../saver/appearance-vectors.js';

const alfas = (obj) => new Map(Object.entries(obj));

// ── fillAlphaAtFirstFill (puur) ─────────────────────────────────────────────

test('eerste vlak: alfa van de graphics-state die bij de eerste vul-operator geldt', () => {
  // Zelfde opbouw als het externe meetvlak: vlak op 30%, label apart op 100%.
  const content = '/BBGS gs 1 0 0 RG 1 w 1 0 0 rg 10 10 m 20 10 l 20 20 l b '
    + 'q /BBGS_TEXT gs BT 1 0 0 rg /Helv 12 Tf (157 m\\262) Tj ET Q ';
  assert.equal(fillAlphaAtFirstFill(content, alfas({ BBGS: 0.3, BBGS_TEXT: 1 })), 0.3);
});

test('eerste vlak: q/Q herstelt de alfa van daarvoor', () => {
  const a = alfas({ A: 0.5, B: 0.2 });
  assert.equal(fillAlphaAtFirstFill('/A gs q /B gs 0 0 5 5 re f Q 0 0 9 9 re f', a), 0.2);
  assert.equal(fillAlphaAtFirstFill('/A gs q /B gs Q 0 0 5 5 re f', a), 0.5);
});

test('eerste vlak op de standaard-alfa geeft null', () => {
  assert.equal(fillAlphaAtFirstFill('0 0 5 5 re f /A gs 0 0 9 9 re f', alfas({ A: 0.4 })), null);
});

test('graphics-state zonder /ca laat de lopende vul-alfa staan', () => {
  // S zet alleen /CA en staat daarom niet in de map.
  assert.equal(fillAlphaAtFirstFill('/A gs /S gs 0 0 5 5 re f', alfas({ A: 0.4 })), 0.4);
});

test('zonder vul-operator geen vul-alfa', () => {
  assert.equal(fillAlphaAtFirstFill('/A gs 0 0 5 5 re S', alfas({ A: 0.4 })), null);
  assert.equal(fillAlphaAtFirstFill('', alfas({ A: 0.4 })), null);
});

test('een "f" in een tekststring is geen vul-operator', () => {
  const content = '/T gs BT (f) Tj <66> Tj ET /A gs 0 0 5 5 re f*';
  assert.equal(fillAlphaAtFirstFill(content, alfas({ T: 1, A: 0.3 })), 0.3);
});

test('alle vul-operatoren tellen', () => {
  for (const op of ['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']) {
    assert.equal(fillAlphaAtFirstFill(`/A gs 0 0 5 5 re ${op}`, alfas({ A: 0.6 })), 0.6, op);
  }
});

// ── Laden: extractAnnotationColors ──────────────────────────────────────────

const RECT = [100, 100, 500, 500];

/** Eén /Polygon-meetvlak op een blad, met optionele appearance en extra sleutels. */
async function kleurenVanMeetvlak({ content = null, gs = {}, dict = {} } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([1200, 1200]);
  const context = doc.context;
  const annot = {
    Type: 'Annot', Subtype: 'Polygon', Rect: RECT,
    Vertices: [110, 110, 490, 110, 490, 490, 110, 490],
    C: [1, 0, 0], IC: [1, 0, 0], IT: PDFName.of('PolygonDimension'),
    ...dict,
  };
  if (content !== null) {
    const ext = {};
    for (const [naam, waarden] of Object.entries(gs)) {
      ext[naam] = context.obj({ Type: 'ExtGState', ...waarden });
    }
    const ap = context.stream(content, {
      Type: 'XObject', Subtype: 'Form', BBox: RECT,
      Matrix: [1, 0, 0, 1, -RECT[0], -RECT[1]],
      Resources: context.obj({ ExtGState: context.obj(ext) }),
    });
    annot.AP = context.obj({ N: context.register(ap) });
  }
  const ref = context.register(context.obj(annot));
  pagina.node.set(PDFName.of('Annots'), context.obj([ref]));
  const kaart = await extractAnnotationColors(1, doc);
  return kaart.get(RECT.join(','));
}

const EXTERN_MEETVLAK = '/BBGS gs 1 0 0 RG 1 w 1 0 0 rg 110 110 m 490 110 l 490 490 l 110 490 l b '
  + 'q /BBGS_TEXT gs BT 1 0 0 rg /Helv 12 Tf 1 0 0 1 300 300 Tm (157 m\\262) Tj ET Q ';
const EXTERN_GS = { BBGS: { ca: 0.3, CA: 1 }, BBGS_TEXT: { ca: 1, CA: 1 } };

test('laden: extern meetvlak met label-graphics-state krijgt vul-alfa 0.3', async () => {
  const kleuren = await kleurenVanMeetvlak({ content: EXTERN_MEETVLAK, gs: EXTERN_GS });
  assert.equal(kleuren.fillOpacity, 0.3);
  assert.equal(kleuren.opacity, 1);
});

test('laden: /FillOpacity zonder appearance is de terugval', async () => {
  const kleuren = await kleurenVanMeetvlak({ dict: { FillOpacity: 0.3 } });
  assert.equal(kleuren.fillOpacity, 0.3);
});

test('laden: de appearance wint van /FillOpacity', async () => {
  const kleuren = await kleurenVanMeetvlak({
    content: '/G gs 1 0 0 rg 110 110 380 380 re f', gs: { G: { ca: 0.5 } },
    dict: { FillOpacity: 0.3 },
  });
  assert.equal(kleuren.fillOpacity, 0.5);
});

test('laden: de eigen OPS_FillOpacity wint van /FillOpacity', async () => {
  const kleuren = await kleurenVanMeetvlak({ dict: { FillOpacity: 0.3, OPS_FillOpacity: 0.6 } });
  assert.equal(kleuren.fillOpacity, 0.6);
});

test('laden: ongeldige /FillOpacity wordt genegeerd', async () => {
  const kleuren = await kleurenVanMeetvlak({ dict: { FillOpacity: 3 } });
  assert.equal(kleuren.fillOpacity, undefined);
});

test('laden: meerdere alfa-waarden en een dekkend eerste vlak geeft geen vul-alfa', async () => {
  const kleuren = await kleurenVanMeetvlak({
    content: '1 0 0 rg 110 110 380 380 re f /A gs 0 0 1 rg 120 120 5 5 re f /B gs 130 130 5 5 re f',
    gs: { A: { ca: 0.5 }, B: { ca: 0.2 } },
  });
  assert.equal(kleuren.fillOpacity, undefined);
});

// ── Opslaan: buildMeasureAreaAP ─────────────────────────────────────────────

const ID = (v) => v;
const VIERKANT = [{ x: 110, y: 110 }, { x: 490, y: 110 }, { x: 490, y: 490 }, { x: 110, y: 490 }];

test('opslaan: vul-alfa alleen om het vlak, met /GSf', () => {
  const ap = buildMeasureAreaAP({
    points: VIERKANT, X: ID, Y: ID, fillColorHex: '#ff0000', strokeColorHex: '#ff0000',
    lineWidth: 1, borderStyle: 'solid', text: '157 m2', fillAlpha: 0.3,
  });
  assert.equal(ap.fillAlpha, 0.3);
  assert.match(ap.content, /^q\n\/GSf gs\n1 0 0 rg\n[\s\S]*?f\*\nQ\n/);
  // Rand en label staan buiten die q…Q en blijven dus dekkend.
  const naVlak = ap.content.slice(ap.content.indexOf('f*\nQ\n') + 5);
  assert.doesNotMatch(naVlak, /\/GSf gs/);
  assert.match(naVlak, /\nS\n/);
  assert.equal(fillAlphaAtFirstFill(ap.content, alfas({ GSf: 0.3 })), 0.3);
});

test('opslaan: zonder vul-alfa (of 1) geen graphics-state', () => {
  for (const fillAlpha of [undefined, null, 1]) {
    const ap = buildMeasureAreaAP({
      points: VIERKANT, X: ID, Y: ID, fillColorHex: '#ff0000', strokeColorHex: '#ff0000',
      text: '157 m2', fillAlpha,
    });
    assert.equal(ap.fillAlpha, undefined, String(fillAlpha));
    assert.doesNotMatch(ap.content, /gs\n/);
  }
});

test('opslaan: zonder vulkleur geen vul-alfa, ook als die bekend is', () => {
  const ap = buildMeasureAreaAP({
    points: VIERKANT, X: ID, Y: ID, fillColorHex: 'none', strokeColorHex: '#ff0000',
    text: '157 m2', fillAlpha: 0.3,
  });
  assert.equal(ap.fillAlpha, undefined);
  assert.doesNotMatch(ap.content, /\/GSf/);
});

test('rondgang: opgeslagen meetvlak-appearance leest terug als vul-alfa 0.3', async () => {
  const ap = buildMeasureAreaAP({
    points: VIERKANT, X: ID, Y: ID, fillColorHex: '#ff0000', strokeColorHex: '#ff0000',
    lineWidth: 1, borderStyle: 'solid', text: '157 m2', fillAlpha: 0.3,
  });
  // Dezelfde ExtGState die attachVectorAP (saver.js) bij built.fillAlpha schrijft.
  const kleuren = await kleurenVanMeetvlak({ content: ap.content, gs: { GSf: { ca: ap.fillAlpha } } });
  assert.equal(kleuren.fillOpacity, 0.3);
});
