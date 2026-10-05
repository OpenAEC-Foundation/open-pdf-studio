// Extra gegevens van proefleescorrecties uit extractAnnotationColors (#508).
//
// pdf.js geeft /Sy, /RD, /NM, /Subj, de rauwe /QuadPoints en de eigen
// sleutels niet door; color-extraction.js leest ze met pdf-lib. Voor /Caret en
// elke tekstmarkering staan ze ook onder '@ref:<obj>R<gen>', zodat
// extraVoorAnnotatie het exacte object vindt en niet een buur met dezelfde
// /Rect.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { extractAnnotationColors } from './color-extraction.js';
import { extraVoorAnnotatie } from './extra-sleutel.js';
import { textEditPropsFromPdf } from './correction-load.js';
import { buildTextEditFixture, buildLegacyMarkupFixture, PAGINAS, OPBOUW, nm } from '../saver/test-fixtures/text-edit-fixture.mjs';

const pdfjsId = (refTekst) => {
  const [num, gen] = refTekst.split(' ');
  return gen === '0' ? `${num}R` : `${num}R${gen}`;
};

async function extras(bytes) {
  const doc = await PDFDocument.load(bytes);
  const perPagina = [];
  for (let i = 0; i < doc.getPageCount(); i++) perPagina.push(await extractAnnotationColors(i + 1, doc));
  return { doc, perPagina };
}

function dictVan(doc, refTekst) {
  const [num, gen] = refTekst.split(' ').map(Number);
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (ref.objectNumber === num && ref.generationNumber === gen) return obj;
  }
  return null;
}

const getallen = (doc, dict, k) => doc.context.lookup(dict.get(PDFName.of(k))).asArray().map((v) => v.asNumber());
const sleutelVan = (doc, dict) => getallen(doc, dict, 'Rect').join(',');

test('invoegtekens en doorhalingen: /Sy, /RD, /NM, /Subj, quads en eigen sleutels onder Rect- en @ref-sleutel', async () => {
  const { bytes, refs } = await buildTextEditFixture();
  const { doc, perPagina } = await extras(bytes);
  PAGINAS.forEach((instelling, i) => {
    const kaart = perPagina[i];
    const p = i + 1;
    const r = refs[i];
    const op = (naam) => {
      const dict = dictVan(doc, r[naam]);
      const opRef = kaart.get(`@ref:${pdfjsId(r[naam])}`);
      const opRect = kaart.get(sleutelVan(doc, dict));
      assert.ok(opRef, `@ref voor ${naam} op pagina ${p}`);
      assert.equal(opRect, opRef, `dezelfde gegevens onder beide sleutels (${naam}, pagina ${p})`);
      return { e: opRef, dict };
    };

    const ouder = op('ouder').e;
    assert.equal(ouder.sy, 'None');
    assert.deepEqual(ouder.rd, [1, 1, 1, 1]);
    assert.equal(ouder.nm, nm(p, 'replace'));
    assert.equal(ouder.subj, 'Inserted Text');
    assert.equal(ouder.intent, 'Replace', 'de bestaande /IT-lezing blijft');
    assert.equal(ouder.ownContents, OPBOUW.vervang.tekst);
    assert.equal(ouder.opsTextDir, undefined);

    const { e: kind, dict: kindDict } = op('kind');
    assert.equal(kind.intent, 'StrikeOutTextEdit');
    assert.equal(kind.nm, nm(p, 'replace-strike'));
    assert.equal(kind.subj, 'Cross-Out');
    assert.deepEqual(kind.rawQuadPoints, getallen(doc, kindDict, 'QuadPoints'), 'quads in bestandsvolgorde');

    const invoeg = op('invoeg').e;
    assert.equal(invoeg.sy, 'P');
    assert.equal(invoeg.rd, undefined);
    assert.equal(invoeg.opsTextDir, (360 - instelling.rotate) % 360);
    assert.equal(invoeg.intent, undefined);

    const { e: schrap, dict: schrapDict } = op('schrap');
    assert.equal(schrap.opsTextDir, (360 - instelling.rotate) % 360);
    assert.equal(schrap.opsMarkedText, OPBOUW.schrap.gemarkeerd);
    assert.equal(schrap.rawQuadPoints.length, 16, 'twee regels');
    assert.deepEqual(schrap.rawQuadPoints, getallen(doc, schrapDict, 'QuadPoints'));

    const { e: oud, dict: oudDict } = op('oud');
    assert.equal(oud.intent, undefined);
    assert.equal(oud.nm, undefined);
    assert.equal(oud.subj, undefined);
    assert.deepEqual(oud.rawQuadPoints, getallen(doc, oudDict, 'QuadPoints'));

    const omgKind = op('omgKind').e;
    assert.equal(omgKind.ownContents, OPBOUW.omgekeerd.tekst, 'eigen tekst, niet die van de ouder');
    op('omgOuder');
  });
});

test('pdf.js-ids vinden via extraVoorAnnotatie het exacte object', async () => {
  const { bytes } = await buildTextEditFixture();
  const { perPagina } = await extras(bytes);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lezer = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  for (let i = 0; i < PAGINAS.length; i++) {
    const annots = await (await lezer.getPage(i + 1)).getAnnotations();
    for (const a of annots.filter((x) => x.subtype === 'Caret' || x.subtype === 'StrikeOut')) {
      const e = extraVoorAnnotatie(perPagina[i], a);
      assert.equal(e, perPagina[i].get(`@ref:${a.id}`), `${a.subtype} ${a.id}`);
    }
  }
});

test('gewone markeringen: Highlight en Underline onder Rect- en @ref-sleutel, met de rauwe quads', async () => {
  const { bytes, refs } = await buildLegacyMarkupFixture();
  const { doc, perPagina } = await extras(bytes);
  refs.forEach((r, i) => {
    const kaart = perPagina[i];
    for (const naam of ['markeer', 'onder']) {
      const dict = dictVan(doc, r[naam]);
      const e = kaart.get(sleutelVan(doc, dict));
      assert.equal(kaart.get(`@ref:${pdfjsId(r[naam])}`), e, naam);
      assert.deepEqual(e.rawQuadPoints, getallen(doc, dict, 'QuadPoints'), naam);
      for (const k of ['sy', 'rd', 'nm', 'subj', 'opsTextDir', 'opsMarkedText', 'intent', 'ownContents']) {
        assert.equal(e[k], undefined, `${naam}.${k}`);
      }
    }
    // De notitie (Text) krijgt niets van dit alles.
    const notitie = kaart.get(sleutelVan(doc, dictVan(doc, r.notitie)));
    for (const k of ['rawQuadPoints', 'sy', 'nm', 'subj']) assert.equal(notitie?.[k], undefined, `notitie.${k}`);
  });
});

// Markeringen die dezelfde woorden raken, met precies dezelfde /Rect. De
// latere annotatie overschrijft de Rect-sleutel; elke markering moet toch haar
// eigen /IT, /NM en /Subj houden.
async function zelfdeRectFixture() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const pagina = doc.addPage([612, 792]);
  const quad = (r) => [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]];
  const markering = (subtype, rect, extra = {}) => ctx.register(ctx.obj({
    Type: 'Annot', Subtype: subtype, Rect: rect, C: [1, 0, 0], F: 4, T: PDFString.of('Ander'), ...extra,
  }));
  const r1 = [72, 690, 120, 702];
  const r2 = [72, 600, 140, 612];
  const r3 = [72, 500, 100, 512];
  const refs = {
    markeer1: markering('Highlight', r1, { QuadPoints: quad(r1), NM: PDFString.of('hl-1'), Subj: PDFString.of('Highlight') }),
    schrap1: markering('StrikeOut', r1, {
      QuadPoints: quad(r1), IT: PDFName.of('StrikeOutTextEdit'), NM: PDFString.of('so-1'),
      Subj: PDFString.of('Cross-Out'), OPS_MarkedText: PDFString.of('teh'),
    }),
    markeer2: markering('Highlight', r2, { QuadPoints: quad(r2), NM: PDFString.of('hl-2') }),
    onder2: markering('Underline', r2, { QuadPoints: quad(r2), NM: PDFString.of('ul-2'), Subj: PDFString.of('Underline') }),
    // Zonder /QuadPoints en zonder andere extra gegevens.
    kaal3: markering('Highlight', r3),
    schrap3: markering('StrikeOut', r3, { QuadPoints: quad(r3), IT: PDFName.of('StrikeOutTextEdit'), NM: PDFString.of('so-3') }),
  };
  pagina.node.set(PDFName.of('Annots'), ctx.obj(Object.values(refs)));
  return { bytes: await doc.save(), refs, rects: { r1, r2, r3 } };
}

test('een markering met dezelfde /Rect als een latere markering houdt haar eigen /IT, /NM en /Subj', async () => {
  const { bytes, refs, rects } = await zelfdeRectFixture();
  const { perPagina } = await extras(bytes);
  const kaart = perPagina[0];
  const voor = (naam, rect) => extraVoorAnnotatie(kaart, { id: pdfjsId(refs[naam].toString()), rect });

  const markeer1 = voor('markeer1', rects.r1);
  assert.equal(markeer1.intent, undefined, 'geen /IT van de doorhaling');
  assert.equal(markeer1.nm, 'hl-1');
  assert.equal(markeer1.subj, 'Highlight');
  assert.equal(markeer1.opsMarkedText, undefined);
  const schrap1 = voor('schrap1', rects.r1);
  assert.equal(schrap1.intent, 'StrikeOutTextEdit');
  assert.equal(schrap1.nm, 'so-1');

  const markeer2 = voor('markeer2', rects.r2);
  assert.equal(markeer2.nm, 'hl-2');
  assert.equal(markeer2.subj, undefined, 'geen /Subj van de onderstreping');
  assert.equal(voor('onder2', rects.r2).nm, 'ul-2');

  // Ook zonder eigen gegevens niet die van de buur.
  const kaal3 = voor('kaal3', rects.r3);
  assert.ok(kaal3, 'een eigen (lege) @ref-ingang');
  assert.equal(kaal3.nm, undefined);
  assert.equal(kaal3.intent, undefined);
  assert.equal(voor('schrap3', rects.r3).nm, 'so-3');

  // Wat de lader ervan maakt: de Highlight blijft een gewone markering.
  const props = textEditPropsFromPdf({ subtype: 'Highlight', rect: rects.r1 }, markeer1, (x, y) => [x, 792 - y], 0);
  assert.deepEqual(props, { nm: 'hl-1', pdfSubject: 'Highlight' });
});
