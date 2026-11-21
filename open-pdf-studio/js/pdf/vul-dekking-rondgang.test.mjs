// Aparte dekking voor lijn en vulling (#685): opslaan en heropenen met de
// echte saver en de echte lader.
//
// In het bestand staat de dekking ook ín de appearance (PDFium en MuPDF
// negeren /CA zodra er een /AP is): /GSo met CA = lijn en ca = vulling, en
// een arcering onder /GSv. Een vorm met één dekking (een ouder bestand) blijft
// precies zoals hij was, zonder aparte vul-dekking.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const vd = await import('../annotations/vul-dekking.js');

async function leegBlad() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

async function opslaan(bronBytes, modellen) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'vuldekking', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [], currentPage: 1,
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = [];
  for (const annot of await pagina.getAnnotations()) {
    modellen.push(await convertPdfAnnotation(annot, 1, viewport, new Map(), kaart));
  }
  await doc.loadingTask.destroy();
  return modellen.filter(Boolean);
}

/** Per annotatie: /CA en /ca van de dict en de graphics-states van de appearance. */
async function inBestand(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const getal = (v) => (v === undefined ? undefined : Number(String(ctx.lookup(v) ?? v)));
  const tekst = (s) => Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()).toString('latin1');
  return doc.getPage(0).node.Annots().asArray().map((ref) => {
    const d = ctx.lookup(ref);
    const ap = d.get(PDFName.of('AP')) && ctx.lookup(d.get(PDFName.of('AP')));
    const n = ap && ctx.lookup(ap.get(PDFName.of('N')));
    const res = n && ctx.lookup(n.dict.get(PDFName.of('Resources')));
    const egs = res && ctx.lookup(res.get(PDFName.of('ExtGState')));
    const gs = (naam) => {
      const g = egs && egs.get(PDFName.of(naam)) && ctx.lookup(egs.get(PDFName.of(naam)));
      return g ? { CA: getal(g.get(PDFName.of('CA'))), ca: getal(g.get(PDFName.of('ca'))) } : null;
    };
    return {
      subtype: String(d.get(PDFName.of('Subtype'))),
      CA: getal(d.get(PDFName.of('CA'))),
      ca: getal(d.get(PDFName.of('ca'))),
      opsVul: getal(d.get(PDFName.of('OPS_FillOpacity'))),
      gso: gs('GSo'),
      gsbox: gs('GSbox'),
      gsv: gs('GSv'),
      inhoud: n ? tekst(n) : '',
    };
  });
}

const basis = {
  page: 1, rotation: 0, color: '#cc0000', strokeColor: '#cc0000', lineWidth: 2,
  borderStyle: 'solid', author: 'Tester',
  createdAt: '2026-10-22T10:00:00.000Z', modifiedAt: '2026-10-22T10:00:00.000Z',
};

const MODELLEN = [
  // Volle rand, vulling op 25 % met arcering (het voorbeeld uit het issue).
  { ...basis, id: 'zone', type: 'box', x: 60, y: 60, width: 160, height: 100, fillColor: '#ffff00',
    opacity: 1, fillOpacity: 0.25, hatchPattern: 'diagonal-left', hatchColor: '#0000ff' },
  // Rand op 40 %, vulling dekkend.
  { ...basis, id: 'ovaal', type: 'circle', x: 300, y: 60, width: 140, height: 90, fillColor: '#3366ff',
    opacity: 0.4, fillOpacity: 1 },
  { ...basis, id: 'veelhoek', type: 'polygon', fillColor: '#00aa00', opacity: 1, fillOpacity: 0.3,
    points: [{ x: 60, y: 220 }, { x: 220, y: 220 }, { x: 180, y: 320 }, { x: 80, y: 320 }],
    x: 60, y: 220, width: 160, height: 100, hatchPattern: 'cross', hatchColor: '#000000' },
  { ...basis, id: 'wolk', type: 'cloud', x: 300, y: 220, width: 160, height: 100, fillColor: '#ff8800',
    opacity: 0.8, fillOpacity: 0.2 },
  // Eén dekking, zoals in een ouder bestand.
  { ...basis, id: 'oud', type: 'box', x: 60, y: 400, width: 120, height: 80, fillColor: '#ff00ff', opacity: 0.5 },
];

const dekkingen = (modellen) => Object.fromEntries(modellen.map((m) => [
  `${m.type}:${Math.round(m.x)}`, { opacity: m.opacity, fillOpacity: m.fillOpacity ?? null },
]));

test('de pure regels: eigen vul-dekking, lijn wijzigen, voorkeur', () => {
  assert.equal(vd.eigenVulDekking({ type: 'box', opacity: 1, fillOpacity: 0.25 }), 0.25);
  assert.equal(vd.eigenVulDekking({ type: 'box', opacity: 0.5 }), null, 'zonder eigen waarde: één dekking');
  assert.equal(vd.eigenVulDekking({ type: 'box', opacity: 0.5, fillOpacity: 0.5 }), null, 'gelijk: één dekking');
  assert.equal(vd.eigenVulDekking({ type: 'line', opacity: 1, fillOpacity: 0.2 }), null, 'een lijn heeft geen vulling');
  assert.equal(vd.vulDekking({ type: 'circle', opacity: 0.6 }), 0.6, 'de vulling volgt de dekking');
  // Lijn wijzigen laat de vulling staan, ook zonder eigen vul-dekking.
  const a = { type: 'polygon', opacity: 0.7 };
  vd.zetLijnDekking(a, 0.4);
  assert.deepEqual(a, { type: 'polygon', opacity: 0.4, fillOpacity: 0.7 });
  const lijn = { type: 'line', opacity: 1 };
  vd.zetLijnDekking(lijn, 0.3);
  assert.deepEqual(lijn, { type: 'line', opacity: 0.3 });
  assert.deepEqual(vd.vulDekkingUitVoorkeur({ rectFillOpacity: 25 }, 'rect'), { fillOpacity: 0.25 });
  assert.deepEqual(vd.vulDekkingUitVoorkeur({}, 'rect'), {});
  assert.deepEqual(vd.vulDekkingUitVoorkeur({ circleFillOpacity: 40 }, 'circle', 0.5), { fillOpacity: 0.2 });
});

test('lijn- en vul-dekking staan in de appearance en komen terug na heropenen', async () => {
  const eerste = await opslaan(await leegBlad(), MODELLEN.map((m) => ({ ...m })));
  const bestand = await inBestand(eerste);
  const per = Object.fromEntries(bestand.map((a, i) => [MODELLEN[i].id, a]));

  // Rechthoek: rand vol, vulling 25 %, arcering onder /GSv op 25 %.
  assert.equal(per.zone.subtype, '/Square');
  assert.equal(per.zone.CA, 1);
  assert.equal(per.zone.ca, 0.25);
  assert.deepEqual(per.zone.gso, { CA: 1, ca: 0.25 });
  assert.deepEqual(per.zone.gsv, { CA: 0.25, ca: 0.25 });
  assert.match(per.zone.inhoud, /^\/GSo gs\n/);
  assert.match(per.zone.inhoud, /q\n\/GSv gs\n/);
  // Ellips: rand 40 %, vulling dekkend.
  assert.deepEqual(per.ovaal.gso, { CA: 0.4, ca: 1 });
  assert.equal(per.ovaal.CA, 0.4);
  assert.equal(per.ovaal.ca, 1);
  assert.equal(per.ovaal.gsv?.CA, 1, 'GSv bestaat, maar zonder arcering niet gebruikt');
  assert.doesNotMatch(per.ovaal.inhoud, /GSv gs/);
  // Veelhoek en wolk.
  assert.deepEqual(per.veelhoek.gso, { CA: 1, ca: 0.3 });
  assert.match(per.veelhoek.inhoud, /\/GSv gs/);
  assert.deepEqual(per.wolk.gso, { CA: 0.8, ca: 0.2 });
  // Eén dekking: precies als voorheen, geen /ca en geen /GSv.
  assert.deepEqual(per.oud.gso, { CA: 0.5, ca: 0.5 });
  assert.equal(per.oud.ca, undefined);
  assert.equal(per.oud.gsv, null);
  assert.equal(per.oud.opsVul, undefined);

  const terug = await laad(eerste);
  assert.deepEqual(dekkingen(terug), dekkingen(MODELLEN), 'na heropenen');

  // Nogmaals opslaan met de geladen modellen: hetzelfde, één /GSo.
  const tweede = await opslaan(eerste, terug);
  for (const a of await inBestand(tweede)) {
    assert.ok((a.inhoud.match(/\/GSo gs/g) || []).length <= 1, `${a.subtype}: /GSo gestapeld`);
  }
  assert.deepEqual(dekkingen(await laad(tweede)), dekkingen(MODELLEN), 'na tweede rondgang');
});

test('een ouder bestand met één dekking krijgt beide velden op die waarde', async () => {
  const bytes = await opslaan(await leegBlad(), [{ ...MODELLEN[4] }]);
  const [ann] = await laad(bytes);
  assert.equal(ann.opacity, 0.5);
  assert.equal(ann.fillOpacity, undefined);
  assert.equal(vd.lijnDekking(ann), 0.5);
  assert.equal(vd.vulDekking(ann), 0.5);
});

test('doorschijnende CSS-vullingen houden kleur en dekking na twee opslagrondes', async () => {
  const vak = { ...basis, x: 60, y: 60, width: 90, height: 45, text: 'Controle', textColor: '#112233', opacity: 1 };
  const modellen = [
    { ...vak, type: 'textbox', id: 'tekst', fillColor: 'rgba(123,104,238,0.15)' },
    { ...vak, x: 220, type: 'callout', id: 'aanhaal', fillColor: '#ee883344', arrowX: 180, arrowY: 55 },
    { ...vak, x: 330, type: 'box', id: 'vorm', fillColor: 'rgba(255,0,0,0.08)', opacity: 0.5 },
  ];
  let bytes = await leegBlad(), huidige = modellen;
  for (let ronde = 0; ronde < 2; ronde++) {
    bytes = await opslaan(bytes, huidige);
    huidige = await laad(bytes);
    assert.deepEqual(huidige.map(m => m.fillColor.toLowerCase()), ['#7b68ee', '#ee8833', '#ff0000']);
    const verwacht = [0.15, 68 / 255, 0.04];
    huidige.forEach((m, i) => assert.ok(Math.abs(m.fillOpacity - verwacht[i]) < 1e-6));
    const annotaties = await inBestand(bytes);
    for (const [i, a] of annotaties.slice(0, 2).entries()) {
      assert.ok(Math.abs(a.gsbox.ca - verwacht[i]) < 1e-6);
      assert.match(a.inhoud, /q\n\/GSbox gs\n[\s\S]*?\nB\nQ\n[\s\S]*?BT/);
    }
  }
});

test('een grijze of CMYK-vulling behoudt haar kleur en eigen dekking na heropenen', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  for (const [i, kleur] of [[0, [0.8]], [1, [0, 0, 0, 0]]]) {
    const rect = [20, 20 + i * 50, 70, 45 + i * 50];
    page.node.addAnnot(doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Square', Rect: rect, C: [1, 0, 0], IC: kleur, CA: 1, ca: 0.25,
    })));
  }
  const bron = await doc.save();
  const modellen = await laad(bron);
  const kleuren = modellen => modellen.map(m => [m.fillColor, m.fillOpacity]);
  const verwacht = [['#cccccc', 0.25], ['#ffffff', 0.25]];
  assert.deepEqual(kleuren(modellen), verwacht);
  assert.deepEqual(kleuren(await laad(await opslaan(bron, modellen))), verwacht);
});
