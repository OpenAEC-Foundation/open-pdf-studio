// De extra gegevens van een annotatie terugvinden, ook als de lezer de /Rect
// anders aanlevert dan hij in het bestand staat.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { extractAnnotationColors } from './color-extraction.js';
import { zoekExtraKleuren } from './extra-sleutel.js';
import { onzichtbaarVlakUitExtra } from './geen-rand.js';

/** De extra-gegevens-kaart van één blad, uit echte PDF-bytes. */
async function kaartVan(rect, dict) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([1191, 1684]);
  const annotDict = doc.context.obj({ Type: 'Annot', Rect: rect, ...dict });
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annotDict)]));
  const heropend = await PDFDocument.load(await doc.save());
  return extractAnnotationColors(1, heropend);
}

test('gewone /Rect: exacte sleutel', async () => {
  const kaart = await kaartVan([100, 100, 300, 200], { Subtype: 'Square', IC: [0, 1, 0] });
  assert.equal(zoekExtraKleuren(kaart, [100, 100, 300, 200])?.ic, '#00ff00');
});

test('omgekeerde /Rect: de lezer normaliseert, de sleutel is de rauwe', async () => {
  // Zo schrijft een tekenpakket zijn vlakken weg: [rechts onder links boven].
  const kaart = await kaartVan([543, 899, 483, 927], { Subtype: 'Square', F: 64, Border: [0, 0, 0] });
  assert.deepEqual([...kaart.keys()], ['543,899,483,927'], 'sleutel komt uit de rauwe /Rect');
  // De lezer geeft de annotatie met genormaliseerde hoeken door.
  const extra = zoekExtraKleuren(kaart, [483, 899, 543, 927]);
  assert.ok(extra, 'extra gegevens niet gevonden');
  assert.equal(extra.borderWidth, 0);
  assert.equal(onzichtbaarVlakUitExtra(extra), true, 'onzichtbaar vlak (#435)');
});

test('omgekeerde /Rect in beide richtingen', async () => {
  const kaart = await kaartVan([300, 200, 100, 100], { Subtype: 'Circle', IC: [1, 0, 0] });
  assert.equal(zoekExtraKleuren(kaart, [100, 100, 300, 200])?.ic, '#ff0000');
  const kaartY = await kaartVan([100, 200, 300, 100], { Subtype: 'Circle', IC: [0, 0, 1] });
  assert.equal(zoekExtraKleuren(kaartY, [100, 100, 300, 200])?.ic, '#0000ff');
});

test('opgerekte /Rect: vage match blijft werken, ver ernaast niet', async () => {
  const kaart = await kaartVan([100, 100, 300, 200], { Subtype: 'Square', IC: [0, 1, 0] });
  assert.equal(zoekExtraKleuren(kaart, [99, 99, 301, 201])?.ic, '#00ff00', 'lijndikte-oprekking');
  assert.equal(zoekExtraKleuren(kaart, [400, 400, 600, 500]), undefined, 'andere annotatie');
  assert.equal(zoekExtraKleuren(null, [100, 100, 300, 200]), undefined);
  assert.equal(zoekExtraKleuren(kaart, [100, 100]), undefined);
});

// De vage match gaat via een index (geen volle doorloop per misser meer):
// dezelfde uitkomst als de doorloop, ook bij gelijke afstanden en sleutels
// die geen rechthoek zijn.
test('vage match met index: gelijk aan de volle doorloop', () => {
  const doorloop = (kaart, [x1, y1, x2, y2]) => {
    let beste; let besteAfstand = Infinity;
    for (const [k, v] of kaart.entries()) {
      const delen = k.split(',').map(Number);
      if (delen.length !== 4) continue;
      const d = Math.abs(delen[0] - x1) + Math.abs(delen[1] - y1) + Math.abs(delen[2] - x2) + Math.abs(delen[3] - y2);
      if (d < besteAfstand && d < 8) { besteAfstand = d; beste = v; }
    }
    return beste;
  };
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const kaart = new Map([['@ref:12R', { ref: true }], ['a,b,c,d', { tekst: true }]]);
  const rects = [];
  for (let i = 0; i < 400; i++) {
    const x = Math.round(rnd() * 300 * 4) / 4, y = Math.round(rnd() * 300 * 4) / 4;
    const r = [x, y, x + 10 + Math.round(rnd() * 8), y + 10];
    rects.push(r);
    // Ook dubbele sleutels in de buurt van elkaar: gelijke afstanden.
    kaart.set(r.join(','), { i });
    if (i % 7 === 0) kaart.set([x + 1, y, r[2] + 1, r[3]].join(','), { i, kopie: true });
    if (i % 11 === 0) kaart.set([x - 1.5, y + 1.5, r[2], r[3]].join(','), { i, schuin: true });
  }
  for (let i = 0; i < 2000; i++) {
    const basis = rects[i % rects.length];
    const r = basis.map((v) => v + (rnd() - 0.5) * 12);
    if (i % 3 === 0) r[0] = basis[0] + 0.5; // gelijk aan meerdere
    // Niet exact: de exacte sleutel en de gespiegelde vóór de vage match.
    if (kaart.has(r.join(','))) continue;
    assert.equal(zoekExtraKleuren(kaart, r), doorloop(kaart, r), `rechthoek ${r}`);
  }
  // Ver weg en negatief: niets, net als de doorloop.
  assert.equal(zoekExtraKleuren(kaart, [-500, -500, -490, -490]), undefined);
  // De kaart groeit: de index volgt.
  kaart.set('1000,1000,1010,1010', { laat: true });
  assert.deepEqual(zoekExtraKleuren(kaart, [1001, 1000, 1010, 1010]), { laat: true });
});
