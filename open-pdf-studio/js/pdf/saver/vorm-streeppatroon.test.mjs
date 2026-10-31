// Gestreepte en gestippelde rechthoeken en ellipsen in de appearance.
//
// De saver schreef het streeppatroon wel in /BS /D, maar de appearance
// (/AP /N, generateAppearanceStream) tekende de rand met `re S` zonder
// d-operator. Andere lezers tekenen de appearance, dus daar was elke
// gestreepte of gestippelde rechthoek en ellips doorgetrokken. Lijn, veelhoek,
// inkt, tekstvak en toelichting schreven de d-operator al
// (appearance-vectors.js dashArrayForStyle, utils.js streepOperator).
//
// Hier: per lijnstijl en per variant (leeg, gevuld, met arcering, met kruis,
// zonder rand, onzichtbaar vlak) de d-operator in de appearance, gelijk aan
// /BS /D. Doorgetrokken: geen streeppatroon (of `[] 0 d`).

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { generateAppearanceStream, buildBorderStyle } from './utils.js';
import { dashArrayForStyle } from './appearance-vectors.js';

const Y = (y) => 800 - y;
const STIJLEN = ['solid', 'dashed', 'dotted', 'dash-dot', 'dash-dot-dot', 'long-dash',
  'long-dash-dot', 'long-dash-dot-dot'];
const VERWACHT = {
  solid: null, dashed: [3, 4], dotted: [2, 4], 'dash-dot': [10, 8, 2, 8],
  'dash-dot-dot': [10, 8, 2, 8, 2, 8], 'long-dash': [20, 10],
  'long-dash-dot': [20, 10, 2, 10], 'long-dash-dot-dot': [20, 10, 2, 10, 2, 10],
};

const basis = {
  page: 1, x: 100, y: 100, width: 140, height: 80, rotation: 0,
  color: '#1144cc', strokeColor: '#1144cc', fillColor: null, lineWidth: 2, opacity: 1,
};

const inhoud = (stream) => Buffer.from(stream.getContents()).toString('latin1');

async function apVan(ann) {
  const doc = await PDFDocument.create();
  const stream = generateAppearanceStream(doc.context, ann, Y);
  assert.ok(stream, `${ann.type}: een appearance`);
  return inhoud(stream);
}

/** /BS /D zoals de saver hem naast de appearance schrijft (null: geen /D). */
async function bsStreep(stijl) {
  const doc = await PDFDocument.create();
  const bs = buildBorderStyle(doc.context, 2, stijl);
  const d = bs.get(PDFName.of('D'));
  return d ? doc.context.lookup(d).asArray().map((g) => g.asNumber()) : null;
}

/** Alle d-operatoren in volgorde: [[patroon, fase, index in de stroom], ...]. */
function streepOperatoren(s) {
  return [...s.matchAll(/\[([^\]]*)\]\s+(-?[\d.]+)\s+d\b/g)].map((m) => ({
    patroon: m[1].trim() ? m[1].trim().split(/\s+/).map(Number) : [],
    fase: Number(m[2]), index: m.index,
  }));
}

/** Index van de eerste streek-operator (S of B) na `vanaf`. */
function eersteStreek(s, vanaf = 0) {
  const m = /(?:^|\s)(S|B)\s/g;
  m.lastIndex = vanaf;
  const r = m.exec(s);
  return r ? r.index : -1;
}

/** Het patroon dat geldt voor de eerste streek: de laatste d ervóór. */
function patroonBijStreek(s, vanaf = 0) {
  const streek = eersteStreek(s, vanaf);
  assert.ok(streek >= 0, 'er wordt gestreken');
  const ervoor = streepOperatoren(s).filter((d) => d.index < streek);
  return ervoor.length ? ervoor[ervoor.length - 1] : null;
}

function controleer(s, stijl, label) {
  const verwacht = VERWACHT[stijl];
  const d = patroonBijStreek(s);
  if (verwacht) {
    assert.ok(d, `${label}: een d-operator vóór de streek`);
    assert.deepEqual(d.patroon, verwacht, `${label}: het patroon`);
    assert.equal(d.fase, 0, `${label}: fase 0`);
  } else {
    assert.ok(!d || d.patroon.length === 0, `${label}: doorgetrokken heeft geen streeppatroon`);
  }
}

for (const soort of ['box', 'circle']) {
  for (const stijl of STIJLEN) {
    test(`${soort} ${stijl}: de appearance draagt het streeppatroon van /BS /D`, async () => {
      assert.deepEqual(dashArrayForStyle(stijl), VERWACHT[stijl], 'de bron van het patroon');
      const bs = await bsStreep(stijl);
      assert.deepEqual(bs, VERWACHT[stijl], '/BS /D');
      const s = await apVan({ ...basis, type: soort, borderStyle: stijl });
      controleer(s, stijl, 'leeg');
      const d = patroonBijStreek(s);
      assert.deepEqual(d && d.patroon.length ? d.patroon : null, bs, 'appearance gelijk aan /BS /D');
    });

    test(`${soort} ${stijl}: ook gevuld`, async () => {
      const s = await apVan({ ...basis, type: soort, borderStyle: stijl, fillColor: '#ffee00' });
      controleer(s, stijl, 'gevuld');
    });

    test(`${soort} ${stijl}: met kruis is ook het kruis gestreept, zoals op het scherm`, async () => {
      const s = await apVan({ ...basis, type: soort, borderStyle: stijl, cross: true });
      // Rand en kruis staan in hetzelfde patroon; geen d die het tussendoor terugzet.
      const alle = streepOperatoren(s);
      if (VERWACHT[stijl]) {
        assert.equal(alle.length, 1, 'één d-operator voor rand en kruis');
        assert.deepEqual(alle[0].patroon, VERWACHT[stijl]);
      } else {
        assert.ok(alle.every((d) => d.patroon.length === 0));
      }
    });

    test(`${soort} ${stijl}: zonder rand houdt het kruis het patroon`, async () => {
      const s = await apVan({ ...basis, type: soort, borderStyle: stijl, strokeColor: 'none',
        fillColor: '#ffee00', cross: true });
      controleer(s, stijl, 'zonder rand');
    });

    test(`${soort} ${stijl}: een onzichtbaar vlak met kruis houdt het patroon`, async () => {
      const s = await apVan({ ...basis, type: soort, borderStyle: stijl, lineWidth: 0,
        onzichtbaarVlak: true, cross: true });
      controleer(s, stijl, 'onzichtbaar vlak');
    });

    test(`${soort} ${stijl}: de arcering blijft doorgetrokken, de rand niet`, async () => {
      const s = await apVan({ ...basis, type: soort, borderStyle: stijl, fillColor: '#ffee00',
        hatchPattern: 'diagonal', hatchColor: '#ff0000', hatchScale: 100, hatchAngle: 45 });
      // De arcering staat in q…Q; het patroon komt pas daarna, vóór de rand.
      const einde = s.lastIndexOf('Q\n');
      assert.ok(einde > 0, 'arcering in q…Q');
      assert.ok(streepOperatoren(s).every((d) => d.index > einde || d.patroon.length === 0),
        'geen streeppatroon in of vóór de arcering');
      const d = patroonBijStreek(s, einde);
      if (VERWACHT[stijl]) assert.deepEqual(d?.patroon, VERWACHT[stijl], 'de rand na de arcering');
      else assert.ok(!d || d.patroon.length === 0);
    });
  }
}

test('maskeer: de appearance volgt /BS /D van zijn lijnstijl', async () => {
  for (const stijl of STIJLEN) {
    const s = await apVan({ ...basis, type: 'mask', borderStyle: stijl, fillColor: '#ffffff' });
    controleer(s, stijl, `maskeer ${stijl}`);
  }
});
