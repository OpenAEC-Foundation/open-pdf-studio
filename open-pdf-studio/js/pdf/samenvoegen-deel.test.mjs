// Samenvoegen van een deel van een bestand (#963): alleen de gekozen pagina's
// gaan mee, en wat naar een andere pagina wijst (bladwijzers, benoemde
// bestemmingen, koppelingen, formuliervelden, lagen) gaat weg of wijst nog
// naar een pagina in het resultaat. Er komt nooit een weespagina mee.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFString, PDFHexString } from 'pdf-lib';
import { voegPdfsSamen } from './samenvoegen.js';
import { kortBronIn, labelsVoorSelectie, geldigeIndexen } from './samenvoegen-deel.js';

const N = (s) => PDFName.of(s);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

function stroom(doc, inhoud, dict = {}) {
  return doc.context.register(doc.context.flateStream(inhoud, dict));
}
function annot(doc, pagina, dict) {
  const ref = doc.context.register(doc.context.obj(dict));
  let annots = pagina.node.lookup(N('Annots'));
  if (!(annots instanceof PDFArray)) {
    annots = doc.context.obj([]);
    pagina.node.set(N('Annots'), annots);
  }
  annots.push(ref);
  return ref;
}
function laagOp(doc, pagina, ocg, sleutel) {
  const res = pagina.node.Resources();
  let props = res.lookup(N('Properties'));
  if (!(props instanceof PDFDict)) { props = doc.context.obj({}); res.set(N('Properties'), props); }
  props.set(N(sleutel), ocg);
  pagina.node.addContentStream(stroom(doc, `/OC /${sleutel} BDC 0 0 1 rg 400 60 80 40 re f EMC`));
}
function widget(doc, pagina, rect, extra = {}) {
  return annot(doc, pagina, { Type: 'Annot', Subtype: 'Widget', Rect: rect, F: 4, P: pagina.ref, ...extra });
}

/**
 * Een bron van drie pagina's waarin alles naar alle pagina's wijst:
 * bladwijzers (ook genest), benoemde bestemmingen (naamboom en oude /Dests),
 * koppelingen (direct, benoemd, via GoTo), velden (één widget per pagina, en
 * één veld met widgets op pagina 1 en 3), lagen per pagina en paginalabels.
 */
async function bron() {
  const doc = await PDFDocument.create();
  const [p1, p2, p3] = [doc.addPage([595, 842]), doc.addPage([595, 842]), doc.addPage([595, 842])];
  const ctx = doc.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  [p1, p2, p3].forEach((p, i) => {
    p.node.Resources().set(N('Font'), ctx.obj({ F1: font }));
    p.node.addContentStream(stroom(doc, `BT /F1 24 Tf 60 700 Td (Bron blad ${i + 1}) Tj ET`));
  });

  // Benoemde bestemmingen: naamboom en de oude /Dests.
  ctx.obj({});
  const names = ctx.obj({ Dests: ctx.register(ctx.obj({ Names: [
    PDFString.of('een'), ctx.obj([p1.ref, N('Fit')]),
    PDFString.of('drie'), ctx.obj([p3.ref, N('Fit')]),
    PDFString.of('twee'), ctx.obj({ D: [p2.ref, N('Fit')] }),
  ] })) });
  doc.catalog.set(N('Names'), ctx.register(names));
  doc.catalog.set(N('Dests'), ctx.register(ctx.obj({ oudEen: [p1.ref, N('Fit')], oudDrie: [p3.ref, N('Fit')] })));

  // Koppelingen op blad 1: naar 2 (direct), naar 3 (direct, benoemd, GoTo, oud) en een webadres.
  annot(doc, p1, { Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], NM: PDFString.of('naar2'), Dest: [p2.ref, N('Fit')] });
  annot(doc, p1, { Type: 'Annot', Subtype: 'Link', Rect: [0, 20, 10, 30], NM: PDFString.of('naar3'), Dest: [p3.ref, N('Fit')] });
  annot(doc, p1, { Type: 'Annot', Subtype: 'Link', Rect: [0, 40, 10, 50], NM: PDFString.of('naam3'), Dest: PDFString.of('drie') });
  annot(doc, p1, { Type: 'Annot', Subtype: 'Link', Rect: [0, 60, 10, 70], NM: PDFString.of('goto3'), A: { S: 'GoTo', D: [p3.ref, N('Fit')] } });
  annot(doc, p1, { Type: 'Annot', Subtype: 'Link', Rect: [0, 80, 10, 90], NM: PDFString.of('oud3'), Dest: N('oudDrie') });
  annot(doc, p1, { Type: 'Annot', Subtype: 'Link', Rect: [0, 100, 10, 110], NM: PDFString.of('web'), A: { S: 'URI', URI: PDFString.of('https://example.org') } });
  annot(doc, p1, { Type: 'Annot', Subtype: 'Link', Rect: [0, 120, 10, 130], NM: PDFString.of('naam1'), Dest: PDFString.of('een') });
  // Een notitie op blad 1 die antwoordt op een notitie op blad 3.
  const vraag = annot(doc, p3, { Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 20, 20], NM: PDFString.of('vraag3'), P: p3.ref });
  annot(doc, p1, { Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 20, 20], NM: PDFString.of('antwoord1'), IRT: vraag, P: p1.ref });

  // Velden.
  const helv = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const af = ctx.obj({ Fields: [], DR: { Font: { Helv: helv } }, DA: PDFString.of('/Helv 0 Tf 0 g') });
  doc.catalog.set(N('AcroForm'), ctx.register(af));
  const velden = af.lookup(N('Fields'));
  const veld1 = widget(doc, p1, [100, 400, 300, 430], { FT: 'Tx', T: PDFString.of('veld1') });
  const veld2 = widget(doc, p2, [100, 400, 300, 430], { FT: 'Tx', T: PDFString.of('veld2') });
  const veld3 = widget(doc, p3, [100, 400, 300, 430], { FT: 'Tx', T: PDFString.of('veld3') });
  // Eén veld, twee widgets: op blad 1 en blad 3.
  const gedeeld = ctx.register(ctx.obj({ FT: 'Tx', T: PDFString.of('gedeeld'), Kids: [] }));
  const kid1 = widget(doc, p1, [100, 300, 300, 330], { Parent: gedeeld });
  const kid3 = widget(doc, p3, [100, 300, 300, 330], { Parent: gedeeld });
  ctx.lookup(gedeeld).lookup(N('Kids')).push(kid1);
  ctx.lookup(gedeeld).lookup(N('Kids')).push(kid3);
  // Een ouder met alleen een kind op blad 3.
  const ouder = ctx.register(ctx.obj({ T: PDFString.of('groep'), Kids: [] }));
  const kind = ctx.register(ctx.obj({ FT: 'Tx', T: PDFString.of('kind'), Parent: ouder, Kids: [] }));
  ctx.lookup(ouder).lookup(N('Kids')).push(kind);
  const kindW = widget(doc, p3, [100, 200, 300, 230], { Parent: kind });
  ctx.lookup(kind).lookup(N('Kids')).push(kindW);
  for (const r of [veld1, veld2, veld3, gedeeld, ouder]) velden.push(r);
  af.set(N('CO'), ctx.obj([veld1, veld3]));

  // Lagen: één per pagina, één op blad 1 en 3, en één zonder pagina.
  const ocg = (naam) => ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText(naam) }));
  const l1 = ocg('Laag1'); const l2 = ocg('Laag2'); const l3 = ocg('Laag3'); const l13 = ocg('Laag13'); const los = ocg('Los');
  laagOp(doc, p1, l1, 'oc1'); laagOp(doc, p2, l2, 'oc1'); laagOp(doc, p3, l3, 'oc1');
  laagOp(doc, p1, l13, 'oc2'); laagOp(doc, p3, l13, 'oc2');
  // Laag3 ook via een annotatie op blad 3 (/OC), niet in de inhoud van 1.
  doc.catalog.set(N('OCProperties'), ctx.obj({
    OCGs: [l1, l2, l3, l13, los],
    D: {
      Order: [l1, PDFString.of('Groep'), [l2, l3], l13, los],
      OFF: [l3], Locked: [l3], RBGroups: [[l2, l3]],
      AS: [{ Event: 'View', Category: ['View'], OCGs: [l1, l3] }],
    },
  }));

  // Bladwijzers: 1, 3, en een kop naar 3 met een kind naar 2.
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  const item = (titel, dest, ouderRef) => {
    const d = ctx.obj({ Title: PDFHexString.fromText(titel), Parent: ouderRef, Dest: dest });
    return { d, ref: ctx.register(d) };
  };
  const b1 = item('Blad 1', ctx.obj([p1.ref, N('Fit')]), rootRef);
  const b3 = item('Blad 3', PDFString.of('drie'), rootRef);
  const kop = item('Kop 3', ctx.obj([p3.ref, N('Fit')]), rootRef);
  const kopKind = item('Kind 2', PDFString.of('twee'), kop.ref);
  const kopKind3 = item('Kind 3', ctx.obj([p3.ref, N('Fit')]), kop.ref);
  kop.d.set(N('First'), kopKind.ref); kop.d.set(N('Last'), kopKind3.ref); kop.d.set(N('Count'), ctx.obj(2));
  kopKind.d.set(N('Next'), kopKind3.ref); kopKind3.d.set(N('Prev'), kopKind.ref);
  b1.d.set(N('Next'), b3.ref); b3.d.set(N('Prev'), b1.ref); b3.d.set(N('Next'), kop.ref); kop.d.set(N('Prev'), b3.ref);
  root.set(N('First'), b1.ref); root.set(N('Last'), kop.ref); root.set(N('Count'), ctx.obj(5));
  doc.catalog.set(N('Outlines'), rootRef);

  // Paginalabels: i, ii, iii.
  doc.catalog.set(N('PageLabels'), ctx.obj({ Nums: [0, { S: 'r' }] }));
  return doc.save();
}

async function doel() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

async function samen(paginas) {
  const d = await PDFDocument.load(await doel());
  const b = await PDFDocument.load(await bron());
  const verslag = await voegPdfsSamen(d, [{ doc: b, naam: 'bron.pdf', paginas }], { invoegIndex: 1, positie: 'end' });
  const bytes = new Uint8Array(await d.save({ updateFieldAppearances: false }));
  return { m: await PDFDocument.load(bytes), bytes, verslag };
}

/** Elk /Page-object in het bestand, ook wat buiten de paginaboom zweeft. */
function allePaginaObjecten(doc) {
  return doc.context.enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFDict && o.get(N('Type'))?.toString() === '/Page')
    .map(([r]) => r);
}

function tekst(raw) { return raw?.decodeText?.() ?? null; }

function annotNamen(m, i) {
  const annots = m.getPages()[i].node.lookup(N('Annots'));
  return (annots?.asArray() || []).map((r) => tekst(m.context.lookup(r).get(N('NM'))) ?? m.context.lookup(r).get(N('Subtype')).toString());
}

function veldNamen(m) {
  const af = m.catalog.lookup(N('AcroForm'));
  const uit = [];
  const loop = (r, voor) => {
    const d = m.context.lookup(r);
    const t = tekst(d.get(N('T')));
    const naam = t ? (voor ? `${voor}.${t}` : t) : voor;
    const kids = d.lookup(N('Kids'));
    const veldKids = (kids?.asArray() || []).filter((k) => m.context.lookup(k).get(N('T')) !== undefined);
    if (veldKids.length) for (const k of veldKids) loop(k, naam);
    else uit.push({ naam, widgets: d.get(N('Subtype')) ? 1 : (kids?.size() || 0) });
  };
  for (const r of af.lookup(N('Fields')).asArray()) loop(r, '');
  return uit;
}

test('geldigeIndexen: unique, sorted, inside the document', () => {
  assert.deepEqual(geldigeIndexen([2, 0, 2, 9, -1, 1.5], 3), [0, 2]);
});

test('labelsVoorSelectie: consecutive pages continue, a gap starts a series with the source number', () => {
  const reeksen = [{ start: 0, st: 1 }, { start: 3, st: 1 }];
  assert.deepEqual(labelsVoorSelectie(reeksen, [0, 1, 4]), [
    { start: 0, reeks: 0, st: 1 },
    { start: 2, reeks: 1, st: 2 },
  ]);
  assert.deepEqual(labelsVoorSelectie(reeksen, [0, 2]), [
    { start: 0, reeks: 0, st: 1 },
    { start: 1, reeks: 0, st: 3 },
  ]);
  assert.deepEqual(labelsVoorSelectie([{ start: 2, st: 5 }], [0, 2]), [
    { start: 0, reeks: -1, st: null },
    { start: 1, reeks: 0, st: 5 },
  ]);
});

test('only the chosen pages are copied, and no page of the source floats along outside the page tree', async () => {
  const { m, verslag } = await samen([0, 1]);
  assert.equal(m.getPageCount(), 3);
  assert.equal(allePaginaObjecten(m).length, 3, 'geen weespagina in het resultaat');
  assert.equal(verslag.paginasIngevoegd, 2);
  assert.equal(verslag.bronnen[0].aantal, 2);
  assert.equal(verslag.bronnen[0].weggelaten.paginas, 1);
});

test('bookmarks to a dropped page go; a heading with a surviving child stays without a target', async () => {
  const { m, bytes } = await samen([0, 1]);
  const pd = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const uit = [];
  const loop = async (items, diepte) => {
    for (const it of items || []) {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await pd.getDestination(dest);
      uit.push([it.title, dest ? await pd.getPageIndex(dest[0]) : null, diepte]);
      await loop(it.items, diepte + 1);
    }
  };
  await loop(await pd.getOutline(), 0);
  assert.deepEqual(uit, [
    ['bron.pdf', 1, 0],
    ['Blad 1', 1, 1],
    ['Kop 3', null, 1],
    ['Kind 2', 2, 2],
  ]);
  assert.ok(m.getPageCount() === 3);
});

test('named destinations to a dropped page go, the others point into the result', async () => {
  const { m } = await samen([0, 1]);
  const names = m.catalog.lookup(N('Names'));
  const arr = names.lookup(N('Dests')).lookup(N('Names')).asArray();
  const paren = [];
  for (let i = 0; i < arr.length; i += 2) paren.push([tekst(arr[i]), arr[i + 1]]);
  assert.deepEqual(paren.map(([k]) => k).sort(), ['een', 'twee']);
  const paginas = m.getPages().map((p) => p.ref);
  for (const [, v] of paren) {
    const dest = m.context.lookup(v);
    const a = dest instanceof PDFDict ? dest.lookup(N('D')) : dest;
    assert.ok(paginas.includes(a.get(0)), 'bestemming wijst naar een pagina in het resultaat');
  }
  const oud = m.catalog.lookup(N('Dests'));
  assert.deepEqual(oud.keys().map((k) => k.decodeText()), ['oudEen']);
});

test('links to a dropped page go (direct, named, GoTo, old /Dests); other links and the reply stay', async () => {
  const { m, verslag } = await samen([0, 1]);
  assert.deepEqual(annotNamen(m, 1).filter((n) => !n.startsWith('/')), ['naar2', 'web', 'naam1', 'antwoord1']);
  assert.equal(verslag.bronnen[0].weggelaten.koppelingen, 4);
  // De koppeling naar blad 2 wijst naar blad 2 in het resultaat.
  const naar2 = m.getPages()[1].node.lookup(N('Annots')).asArray().map((r) => m.context.lookup(r))
    .find((d) => tekst(d.get(N('NM'))) === 'naar2');
  assert.equal(naar2.lookup(N('Dest')).get(0), m.getPages()[2].ref);
  // Het antwoord wees naar een notitie op een weggevallen pagina: die verwijzing is weg.
  const antwoord = m.getPages()[1].node.lookup(N('Annots')).asArray().map((r) => m.context.lookup(r))
    .find((d) => tekst(d.get(N('NM'))) === 'antwoord1');
  assert.equal(antwoord.get(N('IRT')), undefined);
  assert.equal(antwoord.get(N('P')), m.getPages()[1].ref);
});

test('form fields: widgets on dropped pages leave the field, fields without widgets go (also from /CO)', async () => {
  const { m, verslag } = await samen([0, 1]);
  assert.deepEqual(veldNamen(m), [
    { naam: 'veld1', widgets: 1 },
    { naam: 'veld2', widgets: 1 },
    { naam: 'gedeeld', widgets: 1 },
  ]);
  assert.equal(verslag.bronnen[0].weggelaten.velden, 3, 'veld3, groep en kind');
  const co = m.catalog.lookup(N('AcroForm')).lookup(N('CO')).asArray();
  assert.equal(co.length, 1);
  assert.equal(tekst(m.context.lookup(co[0]).get(N('T'))), 'veld1');
  // Elke widget van een veld staat op een pagina van het resultaat.
  const opPaginas = new Set(m.getPages().flatMap((p) => p.node.lookup(N('Annots'))?.asArray() || []).map(String));
  const gedeeld = m.catalog.lookup(N('AcroForm')).lookup(N('Fields')).asArray().map((r) => m.context.lookup(r))
    .find((d) => tekst(d.get(N('T'))) === 'gedeeld');
  for (const k of gedeeld.lookup(N('Kids')).asArray()) assert.ok(opPaginas.has(String(k)));
});

test('layers used only on dropped pages go from the list, visibility, order, locks and groups', async () => {
  const { m, verslag } = await samen([0, 1]);
  const oc = m.catalog.lookup(N('OCProperties'));
  const naam = (r) => tekst(m.context.lookup(r).get(N('Name')));
  assert.deepEqual(oc.lookup(N('OCGs')).asArray().map(naam), ['Laag1', 'Laag2', 'Laag13', 'Los']);
  assert.equal(verslag.bronnen[0].weggelaten.lagen, 1);
  const d = oc.lookup(N('D'));
  const alleRefs = (arr) => arr.asArray().flatMap((e) => (e instanceof PDFRef ? [e] : e instanceof PDFArray ? alleRefs(e) : []));
  const order = alleRefs(d.lookup(N('Order'))).map(naam);
  assert.ok(!order.includes('Laag3'));
  assert.ok(order.includes('Laag2'));
  assert.equal(d.lookup(N('OFF'))?.size() || 0, 0);
  assert.equal(d.lookup(N('Locked'))?.size() || 0, 0);
  for (const g of d.lookup(N('RBGroups'))?.asArray() || []) assert.ok(!m.context.lookup(g).asArray().map(naam).includes('Laag3'));
  for (const e of d.lookup(N('AS'))?.asArray() || []) assert.ok(!m.context.lookup(e).lookup(N('OCGs')).asArray().map(naam).includes('Laag3'));
});

test('page labels follow the chosen pages: pages 1 and 3 keep i and iii', async () => {
  const { bytes } = await samen([0, 2]);
  const pd = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const labels = await pd.getPageLabels();
  assert.deepEqual(labels.slice(1), ['i', 'iii']);
});

test('choosing pages 1 and 3 keeps what points between them and the shared field keeps both widgets', async () => {
  const { m } = await samen([0, 2]);
  assert.equal(allePaginaObjecten(m).length, 3);
  assert.deepEqual(veldNamen(m).map((v) => [v.naam, v.widgets]), [['veld1', 1], ['veld3', 1], ['gedeeld', 2], ['groep.kind', 1]]);
  assert.deepEqual(annotNamen(m, 1).filter((n) => !n.startsWith('/')), ['naar3', 'naam3', 'goto3', 'oud3', 'web', 'naam1', 'antwoord1']);
  // De koppeling naar blad 3 wijst nu naar de tweede ingevoegde pagina.
  const naar3 = m.getPages()[1].node.lookup(N('Annots')).asArray().map((r) => m.context.lookup(r))
    .find((d) => tekst(d.get(N('NM'))) === 'naar3');
  assert.equal(naar3.lookup(N('Dest')).get(0), m.getPages()[2].ref);
  const oc = m.catalog.lookup(N('OCProperties'));
  const naam = (r) => tekst(m.context.lookup(r).get(N('Name')));
  assert.deepEqual(oc.lookup(N('OCGs')).asArray().map(naam), ['Laag1', 'Laag3', 'Laag13', 'Los']);
});

test('all pages chosen (or none given) merges the whole file unchanged', async () => {
  const geheel = await samen(undefined);
  const alle = await samen([0, 1, 2]);
  assert.equal(geheel.m.getPageCount(), 4);
  assert.equal(alle.m.getPageCount(), 4);
  assert.equal(alle.verslag.bronnen[0].weggelaten.paginas, 0);
  assert.deepEqual(veldNamen(alle.m), veldNamen(geheel.m));
});

test('kortBronIn on a single page leaves a valid document', async () => {
  const b = await PDFDocument.load(await bron());
  const weg = kortBronIn(b, [1]);
  assert.equal(b.getPageCount(), 1);
  assert.equal(weg.paginas, 2);
  const bytes = await b.save({ updateFieldAppearances: false });
  const opnieuw = await PDFDocument.load(bytes);
  assert.equal(opnieuw.getPageCount(), 1);
  const pd = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  assert.equal(pd.numPages, 1);
  assert.deepEqual(await pd.getPageLabels(), ['ii']);
});
