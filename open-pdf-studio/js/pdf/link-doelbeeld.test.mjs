// Links van een ander markeerprogramma (#1146): het beeld dat de bestemming
// vraagt (zoom en plek) voor elke bestemmingsvorm, ook op een gedraaide
// pagina, met /UserUnit en een CropBox die niet op 0 begint; de rand uit het
// bestand; en dat opslaan zonder wijziging alles laat staan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString, PDFNull } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const {
  destDoelbeeld, klemPaginaPlek, paginaPlekInVenster, parseDestinationArray, pdfNaarWeergave, weergaveMaatVan,
} = await import('./link-destination.js');
const { linkRandStijl } = await import('./link-rand.js');
const { paginaViewport } = await import('./pagina-viewport.js');

const N = (n) => PDFName.of(n);

// Venster van 800 x 600 CSS-pixels; 100% = 1 pixel per punt.
const VENSTER = { breedte: 800, hoogte: 600, honderd: 1 };

// De links op pagina 1, in volgorde. `dest` wordt /Dest, `actie` /A /S /GoTo.
const LINKS = [
  { naam: 'xyz', dest: (p) => [p[1], N('XYZ'), 150, 650, 2], rand: { Border: [0, 0, 2], C: [1, 0, 0] } },
  { naam: 'xyz-null', dest: (p) => [p[1], N('XYZ'), PDFNull, 600, PDFNull] },
  { naam: 'fit', dest: (p) => [p[1], N('Fit')], rand: { BS: { W: 3, S: N('D'), D: [3, 2] }, C: [0, 0, 1] } },
  { naam: 'fith', dest: (p) => [p[1], N('FitH'), 600], rand: { BS: { W: 1, S: N('U') }, C: [0, 0.5, 0] } },
  { naam: 'fitv', dest: (p) => [p[1], N('FitV'), 200], rand: { Border: [0, 0, 0] } },
  { naam: 'fitr', dest: (p) => [p[1], N('FitR'), 150, 300, 350, 400], rand: { Border: [0, 0, 1], C: [1, 0.5, 0], H: N('O') } },
  { naam: 'fitb', dest: (p) => [p[1], N('FitB')] },
  { naam: 'fitbh', dest: (p) => [p[1], N('FitBH'), 600] },
  { naam: 'fitbv', dest: (p) => [p[1], N('FitBV'), 200] },
  { naam: 'goto-gedraaid', actie: (p) => [p[2], N('FitR'), 100, 200, 300, 300] },
  { naam: 'benoemd-boom', dest: () => PDFString.of('detail-A') },
  { naam: 'benoemd-oud', dest: () => N('DetailB') },
  { naam: 'goto-xyz-gedraaid', actie: (p) => [p[2], N('XYZ'), 100, 500, 1.5] },
];

/**
 * Drie pagina's: 1 gewoon (400 x 500); 2 met een CropBox [100 200 500 700] en
 * /UserUnit 2; 3 een kwartslag gedraaid (/Rotate 90, 400 x 600).
 */
async function bron() {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([400, 500]);
  const p2 = doc.addPage([600, 800]);
  p2.node.set(N('MediaBox'), doc.context.obj([100, 200, 500, 700]));
  p2.node.set(N('CropBox'), doc.context.obj([100, 200, 500, 700]));
  p2.node.set(N('UserUnit'), doc.context.obj(2));
  const p3 = doc.addPage([400, 600]);
  p3.node.set(N('Rotate'), doc.context.obj(90));
  const refs = [p1.ref, p2.ref, p3.ref];

  const annots = LINKS.map((l, i) => {
    const velden = {
      Type: 'Annot', Subtype: 'Link', Rect: [20, 460 - i * 30, 120, 480 - i * 30], ...(l.rand || {}),
    };
    if (velden.BS) velden.BS = doc.context.obj(velden.BS);
    if (l.dest) {
      const d = l.dest(refs);
      velden.Dest = Array.isArray(d) ? doc.context.obj(d) : d;
    }
    if (l.actie) velden.A = doc.context.obj({ Type: 'Action', S: 'GoTo', D: doc.context.obj(l.actie(refs)) });
    return doc.context.register(doc.context.obj(velden));
  });
  p1.node.set(N('Annots'), doc.context.obj(annots));

  // Een benoemde bestemming in de naamboom en een in het oude /Dests-woordenboek.
  doc.catalog.set(N('Names'), doc.context.obj({
    Dests: doc.context.obj({
      Names: [PDFString.of('detail-A'), doc.context.obj([p2.ref, N('FitR'), 300, 500, 500, 700])],
    }),
  }));
  doc.catalog.set(N('Dests'), doc.context.obj({
    DetailB: doc.context.obj({ D: doc.context.obj([p3.ref, N('FitH'), 350]) }),
  }));
  return doc.save({ useObjectStreams: false });
}

/** Zoals link-layer.js: de links via PDF.js, de bestemming opgelost. */
async function leesLinks(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const annots = (await (await doc.getPage(1)).getAnnotations({ intent: 'display' }))
    .filter((a) => a.subtype === 'Link')
    .sort((a, b) => b.rect[1] - a.rect[1]);
  const uit = {};
  for (let i = 0; i < annots.length; i++) {
    const ann = annots[i];
    const expliciet = typeof ann.dest === 'string' ? await doc.getDestination(ann.dest) : ann.dest;
    const info = parseDestinationArray(expliciet);
    const pagina = (await doc.getPageIndex(info.pageRef)) + 1;
    const page = await doc.getPage(pagina);
    uit[LINKS[i].naam] = {
      ann, info, pagina, page,
      geometrie: { view: Array.from(page.view), rotatie: page.rotate },
    };
  }
  return { uit, sluit: () => doc.loadingTask.destroy() };
}

const bytes = await bron();
const { uit: links, sluit } = await leesLinks(bytes);
test.after(() => sluit());

const beeldVan = (naam, extraRotatie = 0) => {
  const l = links[naam];
  return destDoelbeeld(l.info, { view: l.geometrie.view, rotatie: l.geometrie.rotatie + extraRotatie }, VENSTER);
};

test('elke link uit het bestand wordt gelezen, met zijn doelpagina', () => {
  assert.equal(Object.keys(links).length, LINKS.length);
  for (const naam of ['xyz', 'xyz-null', 'fit', 'fith', 'fitv', 'fitr', 'fitb', 'fitbh', 'fitbv', 'benoemd-boom']) {
    assert.equal(links[naam].pagina, 2, naam);
  }
  for (const naam of ['goto-gedraaid', 'benoemd-oud', 'goto-xyz-gedraaid']) assert.equal(links[naam].pagina, 3, naam);
  assert.equal(links.xyz.info.type, 'XYZ');
  assert.equal(links.fitr.info.type, 'FitR');
  assert.equal(links['goto-gedraaid'].info.type, 'FitR', 'a GoTo action gives the same destination');
  assert.equal(links['benoemd-boom'].info.type, 'FitR', 'a name from the name tree');
  assert.equal(links['benoemd-oud'].info.type, 'FitH', 'a name from the old /Dests dictionary');
});

test('de weergaveruimte is die van de app: geen /UserUnit, CropBox-oorsprong eraf, gedraaid', () => {
  for (const naam of ['xyz', 'goto-gedraaid']) {
    const { page, geometrie } = links[naam];
    for (const extra of [0, 90, 180, 270]) {
      const rotatie = (geometrie.rotatie + extra) % 360;
      const vp = paginaViewport(page, { scale: 1, rotation: rotatie });
      const maat = weergaveMaatVan(geometrie.view, rotatie);
      assert.ok(Math.abs(maat.breedte - vp.width) < 1e-6 && Math.abs(maat.hoogte - vp.height) < 1e-6,
        `${naam} ${rotatie}: page size`);
      for (const [x, y] of [[150, 650], [100, 200], [333, 444]]) {
        const [vx, vy] = vp.convertToViewportPoint(x, y);
        const p = pdfNaarWeergave(geometrie.view, rotatie, x, y);
        assert.ok(Math.abs(p.x - vx) < 1e-6 && Math.abs(p.y - vy) < 1e-6, `${naam} ${rotatie}: (${x}, ${y})`);
      }
    }
  }
  // Pagina 2 is 400 x 500 eenheden, ook met /UserUnit 2.
  assert.deepEqual(weergaveMaatVan(links.xyz.geometrie.view, 0), { breedte: 400, hoogte: 500 });
});

test('/XYZ: het punt linksboven in het venster, met de zoom van de link', () => {
  // CropBox [100 200 500 700]: left 150 ligt 50 van links, top 650 ligt 50 van boven.
  assert.deepEqual(beeldVan('xyz'), { zoom: 2, x: 50, y: 50, ankerX: 'begin', ankerY: 'begin' });
  assert.deepEqual(paginaPlekInVenster(beeldVan('xyz'), 2, VENSTER), { x: -100, y: -100 });
  // 100% is niet altijd 1 pixel per punt (schermresolutie, kalibratie).
  const l = links.xyz;
  assert.equal(destDoelbeeld(l.info, l.geometrie, { ...VENSTER, honderd: 4 / 3 }).zoom, 8 / 3);
});

test('/XYZ met null: zoom en horizontale plek blijven zoals ze zijn', () => {
  const beeld = beeldVan('xyz-null');
  assert.deepEqual(beeld, { zoom: null, x: null, y: 100, ankerX: 'begin', ankerY: 'begin' });
  // Zonder eigen zoom een kleine marge boven het punt.
  assert.deepEqual(paginaPlekInVenster(beeld, 1.5, VENSTER, 12), { x: null, y: 12 - 150 });
  // Zoom 0 betekent hetzelfde als null.
  assert.equal(destDoelbeeld(parseDestinationArray([0, { name: 'XYZ' }, 10, 20, 0]),
    { view: [0, 0, 100, 100], rotatie: 0 }, VENSTER).zoom, null);
});

test('/Fit en /FitB: de hele pagina passend in het midden', () => {
  for (const naam of ['fit', 'fitb']) {
    // 400 x 500 in 800 x 600: de hoogte bepaalt (600 / 500).
    assert.deepEqual(beeldVan(naam), { zoom: 1.2, x: 200, y: 250, ankerX: 'midden', ankerY: 'midden' }, naam);
  }
  assert.deepEqual(paginaPlekInVenster(beeldVan('fit'), 1.2, VENSTER), { x: 160, y: 0 });
});

test('/FitH en /FitBH: de breedte passend, top bovenaan', () => {
  for (const naam of ['fith', 'fitbh']) {
    assert.deepEqual(beeldVan(naam), { zoom: 2, x: 200, y: 100, ankerX: 'midden', ankerY: 'begin' }, naam);
  }
  assert.deepEqual(paginaPlekInVenster(beeldVan('fith'), 2, VENSTER), { x: 0, y: -200 });
});

test('/FitV en /FitBV: de hoogte passend, left links', () => {
  for (const naam of ['fitv', 'fitbv']) {
    assert.deepEqual(beeldVan(naam), { zoom: 1.2, x: 100, y: 250, ankerX: 'begin', ankerY: 'midden' }, naam);
  }
});

test('/FitR: de rechthoek passend in het midden van het venster', () => {
  // [150 300 350 400] is 200 x 100: de breedte bepaalt (800 / 200 = 4).
  const beeld = beeldVan('fitr');
  assert.deepEqual(beeld, { zoom: 4, x: 150, y: 350, ankerX: 'midden', ankerY: 'midden' });
  // Linkerbovenhoek van de rechthoek (50, 300) komt op (0, 100) in het venster.
  const plek = paginaPlekInVenster(beeld, 4, VENSTER);
  assert.deepEqual({ x: plek.x + 50 * 4, y: plek.y + 300 * 4 }, { x: 0, y: 100 });
});

test('een benoemde bestemming geeft hetzelfde beeld als een expliciete', () => {
  // [300 500 500 700] op pagina 2: 200 x 200, de hoogte bepaalt (600 / 200).
  assert.deepEqual(beeldVan('benoemd-boom'), { zoom: 3, x: 300, y: 100, ankerX: 'midden', ankerY: 'midden' });
});

test('gedraaide pagina: de rechthoek ligt een kwartslag gedraaid op het scherm', () => {
  // Pagina 3: 400 x 600 met /Rotate 90, op het scherm 600 x 400.
  // [100 200 300 300] wordt 100 breed en 200 hoog, van (200, 100) tot (300, 300).
  assert.deepEqual(beeldVan('goto-gedraaid'), { zoom: 3, x: 250, y: 200, ankerX: 'midden', ankerY: 'midden' });
  // Een halve slag erbij (paginarotatie of weergaverotatie van de app).
  assert.deepEqual(beeldVan('goto-gedraaid', 180), { zoom: 3, x: 350, y: 200, ankerX: 'midden', ankerY: 'midden' });
  // /XYZ 100 500 op de gedraaide pagina: het punt ligt op (500, 100).
  assert.deepEqual(beeldVan('goto-xyz-gedraaid'), { zoom: 1.5, x: 500, y: 100, ankerX: 'begin', ankerY: 'begin' });
  // /FitH op een gedraaide pagina: de breedte passend, bovenaan beginnen.
  assert.deepEqual(beeldVan('benoemd-oud'), { zoom: 800 / 600, x: 300, y: 0, ankerX: 'midden', ankerY: 'begin' });
});

test('de pagina blijft in het venster: passend in het midden, anders tot aan haar rand', () => {
  // Pagina 400 x 500 op zoom 1 past in 800 x 600: in het midden, waar het punt ook ligt.
  assert.deepEqual(klemPaginaPlek({ x: -50, y: -400 }, { breedte: 400, hoogte: 500 }, VENSTER), { x: 200, y: 50 });
  // Op zoom 4 (1600 x 2000): het punt geldt, maar niet voorbij de rand.
  assert.deepEqual(klemPaginaPlek({ x: -200, y: -1200 }, { breedte: 1600, hoogte: 2000 }, VENSTER), { x: -200, y: -1200 });
  assert.deepEqual(klemPaginaPlek({ x: 100, y: -5000 }, { breedte: 1600, hoogte: 2000 }, VENSTER), { x: 0, y: -1400 });
  // Een as zonder punt blijft zoals hij is.
  assert.deepEqual(klemPaginaPlek({ x: null, y: -10 }, { breedte: 1600, hoogte: 2000 }, VENSTER), { x: null, y: -10 });
});

test('een bestemming zonder leesbaar beeld geeft null: alleen de pagina', () => {
  const pagina = { view: [0, 0, 400, 500], rotatie: 0 };
  assert.equal(destDoelbeeld(parseDestinationArray([0, { name: 'Onbekend' }, 1, 2]), pagina, VENSTER), null);
  assert.equal(destDoelbeeld(parseDestinationArray([0, { name: 'FitR' }, 10, 10, 10, 50]), pagina, VENSTER), null);
  assert.equal(destDoelbeeld(parseDestinationArray([0, { name: 'FitR' }, 10, null, 30, 50]), pagina, VENSTER), null);
  assert.equal(destDoelbeeld(null, pagina, VENSTER), null);
  assert.equal(destDoelbeeld(parseDestinationArray([0, { name: 'Fit' }]), { view: [0, 0, 0, 0] }, VENSTER), null);
});

test('de rand uit het bestand wordt de rand van het klikvlak', () => {
  assert.deepEqual(linkRandStijl(links.xyz.ann, 1.5),
    { boxSizing: 'border-box', border: '3px solid rgb(255, 0, 0)' }, '/Border with /C');
  assert.deepEqual(linkRandStijl(links.fit.ann, 1),
    { boxSizing: 'border-box', border: '3px dashed rgb(0, 0, 255)' }, 'dashed /BS');
  assert.deepEqual(linkRandStijl(links.fith.ann, 2),
    { boxSizing: 'border-box', borderBottom: '2px solid rgb(0, 128, 0)' }, 'underline /BS');
  assert.equal(linkRandStijl(links.fitv.ann, 1), null, 'width 0: no border');
  assert.equal(linkRandStijl(links.fitb.ann, 1), null, 'no /Border and no /BS: no border');
  assert.equal(linkRandStijl({ borderStyle: { width: 1, style: 1 }, color: null }, 1), null, 'no colour');
  assert.equal(linkRandStijl(null, 1), null);
});

test('opslaan zonder wijziging laat bestemming en stijl van elke link staan', async () => {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bytes,
      writeBinaryFile: (_pad, b) => { uit = b; return true; },
      writeBinaryFileAtomic: (_pad, b) => { uit = b; return true; },
    },
  };
  state.documents = [{
    id: 'doelbeeld', filePath: 'C:/links/bron.pdf', pdfDoc: {}, annotations: [],
    pageRotations: {}, _annotationPagesReady: new Set([1, 2, 3]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/links/uit.pdf', { zonderHandtekeningVraag: true }), true);

  const linksVan = (pdf) => pdf.getPage(0).node.Annots().asArray().map((r) => pdf.context.lookup(r));
  const tekst = (v) => (v === undefined ? undefined : v.toString());
  // Paginaverwijzingen als paginanummer: objectnummers mogen verschuiven.
  const dest = (pdf, d) => {
    const v = d instanceof Object && typeof d.asArray === 'function' ? d : null;
    if (!v) return tekst(d);
    const paginas = pdf.getPages().map((p) => p.ref.toString());
    return v.asArray().map((e, i) => (i === 0 ? `p${paginas.indexOf(e.toString()) + 1}` : e.toString())).join(' ');
  };
  const voor = await PDFDocument.load(bytes);
  const na = await PDFDocument.load(uit);
  const a = linksVan(voor);
  const b = linksVan(na);
  assert.equal(b.length, LINKS.length);
  for (let i = 0; i < LINKS.length; i++) {
    const naam = LINKS[i].naam;
    assert.equal(tekst(b[i].lookup(N('Subtype'))), '/Link', naam);
    for (const sleutel of ['Rect', 'Border', 'C', 'BS', 'H']) {
      assert.equal(tekst(b[i].lookup(N(sleutel))), tekst(a[i].lookup(N(sleutel))), `${naam} /${sleutel}`);
    }
    assert.equal(dest(na, b[i].lookup(N('Dest'))), dest(voor, a[i].lookup(N('Dest'))), `${naam} /Dest`);
    const actieVoor = a[i].lookup(N('A'));
    const actieNa = b[i].lookup(N('A'));
    assert.equal(!!actieNa, !!actieVoor, `${naam} /A`);
    if (actieVoor) {
      assert.equal(tekst(actieNa.lookup(N('S'))), '/GoTo', naam);
      assert.equal(dest(na, actieNa.lookup(N('D'))), dest(voor, actieVoor.lookup(N('D'))), `${naam} /A /D`);
    }
    assert.equal(b[i].get(N('OPS_Subtype')), undefined, `${naam}: still a link of the other program`);
  }
  assert.ok(dest(na, b[0].lookup(N('Dest'))).startsWith('p2 /XYZ 150 650 2'));

  // De benoemde bestemmingen staan er nog, en wijzen naar dezelfde pagina.
  const boom = na.catalog.lookup(N('Names')).lookup(N('Dests')).lookup(N('Names')).asArray();
  assert.equal(boom[0].decodeText(), 'detail-A');
  assert.equal(dest(na, na.context.lookup(boom[1])), 'p2 /FitR 300 500 500 700');
  const oud = na.catalog.lookup(N('Dests')).lookup(N('DetailB')).lookup(N('D'));
  assert.equal(dest(na, oud), 'p3 /FitH 350');
});

test('een trage sprong overschrijft geen nieuwere sprong en geen ander document', async () => {
  const bron = readFileSync(new URL('./link-layer.js', import.meta.url), 'utf8');
  // De regel zelf, los van de app (link-layer.js laadt de DOM-kant).
  const m = bron.match(/export function sprongNogGeldig\(beurt, laatste, doc, actief\) \{([^}]*)\}/);
  assert.ok(m, 'sprongNogGeldig staat in link-layer.js');
  const sprongNogGeldig = new Function('beurt', 'laatste', 'doc', 'actief', m[1]);
  const a = { naam: 'a' };
  const b = { naam: 'b' };
  assert.equal(sprongNogGeldig(3, 3, a, a), true);
  assert.equal(sprongNogGeldig(2, 3, a, a), false, 'er is intussen een nieuwere sprong');
  assert.equal(sprongNogGeldig(3, 3, a, b), false, 'er is intussen een ander document actief');
  assert.equal(sprongNogGeldig(3, 3, null, null), false);
  // Na elke wachtstap in handleInternalLink wordt de sprong opnieuw getoetst.
  const fn = bron.slice(bron.indexOf('export async function handleInternalLink'), bron.indexOf('const DEST_SCROLL_MARGIN_PX'));
  assert.ok(fn.includes('const beurt = ++_sprongBeurt;'));
  assert.equal(fn.split('if (!geldig()) return;').length - 1, 3, 'na getDestination, getPageIndex en goToPage');
  assert.ok(fn.includes('if (!getoond && geldig()) await goToPage(targetPage);'));
});
