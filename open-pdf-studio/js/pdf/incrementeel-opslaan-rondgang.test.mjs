// Incrementeel opslaan (#679) met de echte saver (rondgang.testhulp.mjs):
// opslaan -> heropenen -> opslaan, met de voorkeur aan en uit, en de gevallen
// die altijd volledig herschrijven. Nagekeken met pdf.js en MuPDF.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFDict, PDFHexString, PDFString } from 'pdf-lib';
import { leegBlad, laad, state } from './rondgang.testhulp.mjs';
import { leesXrefKeten } from './saver/incrementeel.js';
import { pdfjsLees, mupdfLees, qpdfControle, begintMet } from './saver/incrementeel.testhulp.mjs';

// Na de laadhaken van rondgang.testhulp.mjs: de saver en de app-modules.
const { savePDF } = await import('./saver.js');
const { DEFAULT_PREFERENCES } = await import('../core/constants.js');

const basis = {
  page: 1, rotation: 0, color: '#ff0000', strokeColor: '#ff0000', fillColor: null,
  lineWidth: 2, borderStyle: 'solid', opacity: 1, author: 'User',
};
const vak = (id, x) => ({ ...basis, id, type: 'box', x, y: 100, width: 80, height: 40 });

/**
 * De echte saver op `bron`, met wat er gebeurt vastgelegd: geschreven bytes,
 * de cache, opgeslagen-markering en de gekozen wijze.
 */
async function sla(bron, modellen, { incrementeel = true, document = {}, impl = {} } = {}) {
  const log = { geschreven: null, atomair: 0, cache: null, opgeslagen: 0, ontgrendeld: 0 };
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bron,
      setCachedPdfBytes: (_p, b) => { log.cache = b; },
      writeBinaryFileAtomic: (_p, b) => { log.geschreven = b; log.atomair++; return true; },
      writeBinaryFile: () => { throw new Error('opslaan moet atomair schrijven'); },
      markDocumentSaved: () => { log.opgeslagen++; },
      unlockFile: () => { log.ontgrendeld++; },
      ...impl,
    },
  };
  state.preferences = { ...DEFAULT_PREFERENCES, incrementalSave: incrementeel };
  state.documents = [{
    id: 'incr', filePath: 'C:/incr/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [], ...document,
  }];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0]; // de store geeft een eigen proxy terug
  log.gelukt = await savePDF(null, { zonderHandtekeningVraag: true }, doc);
  log.wijze = doc.laatsteOpslagWijze;
  return log;
}

test('standaard uit: de voorkeur bestaat en staat op false; opslaan herschrijft zoals voorheen', async () => {
  assert.equal(DEFAULT_PREFERENCES.incrementalSave, false);
  const bron = await leegBlad();
  const r = await sla(bron, [vak('a', 50)], { incrementeel: false });
  assert.equal(r.gelukt, true);
  assert.equal(r.wijze.wijze, 'volledig');
  assert.equal(r.wijze.reden, 'uitgeschakeld');
  assert.ok(!begintMet(r.geschreven, bron));
});

test('voorkeur aan: annotaties opslaan, heropenen en weer opslaan, drie keer; elke keer een toevoeging', async () => {
  let bytes = await leegBlad();
  const eerste = bytes;
  let modellen = [vak('a', 50)];
  for (let ronde = 1; ronde <= 3; ronde++) {
    const r = await sla(bytes, modellen);
    assert.equal(r.gelukt, true);
    assert.equal(r.wijze.wijze, 'incrementeel', JSON.stringify(r.wijze));
    assert.equal(r.atomair, 1, 'via de atomaire schrijfroute');
    assert.ok(r.ontgrendeld >= 1);
    assert.equal(r.opgeslagen, 1, 'als opgeslagen gemarkeerd');
    assert.deepEqual(r.cache, r.geschreven, 'de cache krijgt de geschreven bytes: de volgende save bouwt erop voort');
    assert.ok(begintMet(r.geschreven, bytes), `ronde ${ronde}: vorige bytes ongewijzigd`);
    assert.ok(begintMet(r.geschreven, eerste));
    const keten = leesXrefKeten(r.geschreven);
    assert.equal(keten.secties, ronde + 1);
    const m = mupdfLees(r.geschreven);
    assert.equal(m.hersteld, false);
    assert.equal(m.annotaties.filter((a) => a.soort === 'Square').length, ronde);
    const p = await pdfjsLees(r.geschreven);
    assert.equal(p.annotaties.filter((a) => a.subtype === 'Square').length, ronde);
    const q = qpdfControle(r.geschreven);
    if (q) assert.equal(q.status, 0, q.uitvoer);
    // Heropenen met de echte lader en een vak erbij.
    bytes = r.geschreven;
    modellen = await laad(bytes);
    assert.equal(modellen.filter((a) => a.type === 'box').length, ronde, 'de lader ziet alle vakken terug');
    modellen.push(vak(`n${ronde}`, 50 + ronde * 90));
  }
});

test('incrementeel en volledig herschrijven geven dezelfde annotaties terug', async () => {
  const bron = await leegBlad();
  const modellen = () => [vak('a', 50), { ...basis, id: 't', type: 'textbox', x: 300, y: 300, width: 120, height: 40, text: 'Hallo', fontSize: 12, fontFamily: 'Helvetica', textColor: '#000000' }];
  const inc = await sla(bron, modellen());
  const vol = await sla(bron, modellen(), { incrementeel: false });
  assert.equal(inc.wijze.wijze, 'incrementeel', JSON.stringify(inc.wijze));
  const soorten = async (b) => (await laad(b)).map((a) => `${a.type}:${a.text || ''}`).sort();
  assert.deepEqual(await soorten(inc.geschreven), await soorten(vol.geschreven));
});

test('formulier invullen gaat incrementeel; pdf.js en MuPDF lezen de waarde', async () => {
  const d = await PDFDocument.create();
  const pagina = d.addPage([595, 842]);
  d.getForm().createTextField('naam').addToPage(pagina, { x: 50, y: 700, width: 200, height: 20 });
  const bron = await d.save({ useObjectStreams: false });
  const opslag = { size: 1, getRawValue: (id) => (id === 'w1' ? { value: 'Jansen' } : undefined) };
  const r = await sla(bron, [], {
    impl: { getAnnotationStorage: () => opslag, getAnnotIdToFieldName: () => new Map([['w1', 'naam']]) },
  });
  assert.equal(r.wijze.wijze, 'incrementeel', JSON.stringify(r.wijze));
  assert.ok(begintMet(r.geschreven, bron));
  assert.equal((await pdfjsLees(r.geschreven)).velden.naam, 'Jansen');
  assert.equal(mupdfLees(r.geschreven).widgets.find((w) => w.naam === 'naam')?.waarde, 'Jansen');
});

test('altijd volledig: redactie, paginadraaiing, versleuteld, DocMDP P=1, kapotte xref', async () => {
  const bron = await leegBlad();
  const redactie = await sla(bron, [{ ...vak('r', 50), type: 'redaction', overlayColor: '#000000' }]);
  assert.equal(redactie.wijze.wijze, 'volledig');
  assert.equal(redactie.wijze.reden, 'volledig-vereist');
  assert.ok(!begintMet(redactie.geschreven, bron), 'redactie herschrijft het hele bestand');

  const toegepast = await sla(bron, [{ ...vak('z', 50), fillColor: '#000000', redacted: true, locked: true }]);
  assert.equal(toegepast.wijze.reden, 'volledig-vereist');
  assert.ok(!begintMet(toegepast.geschreven, bron));

  const draai = await sla(bron, [vak('a', 50)], { document: { pageRotations: { 1: 90 } } });
  assert.equal(draai.wijze.wijze, 'volledig');
  assert.equal(draai.wijze.reden, 'pagina-gewijzigd');
  assert.equal(mupdfLees(draai.geschreven).hersteld, false);

  // Kapotte xref (verkeerde startxref): pdf-lib leest het wel, de toevoeging zou
  // op een kapotte keten bouwen. Herschrijven repareert het.
  const t = Buffer.from(await leegBlad()).toString('latin1');
  const kapot = new Uint8Array(Buffer.from(t.replace(/startxref\s+(\d+)/, (_m, n) => `startxref\n${Number(n) + 3}`), 'latin1'));
  const k = await sla(kapot, [vak('a', 50)]);
  assert.equal(k.gelukt, true);
  assert.equal(k.wijze.reden, 'xref-onjuist');
  assert.equal(mupdfLees(k.geschreven).hersteld, false);

  // Versleuteld: de saver kan het (zoals voorheen) niet laden; er wordt niets geschreven.
  const mupdf = await import('mupdf');
  const m = mupdf.Document.openDocument(await leegBlad(), 'application/pdf').asPDF();
  const vers = m.saveToBuffer('encrypt=aes-256,user-password=,owner-password=geheim').asUint8Array().slice();
  const v = await sla(vers, [vak('a', 50)], { impl: { showMessage: () => {} } });
  assert.equal(v.gelukt, false);
  assert.equal(v.geschreven, null, 'niets geschreven');
});

test('DocMDP P=1: niet incrementeel; de saver valt terug op herschrijven (na de bestaande handtekeningvraag)', async () => {
  const d = await PDFDocument.create();
  const pagina = d.addPage([595, 842]);
  const ctx = d.context;
  const sig = ctx.register(ctx.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 0, 0, 0],
    Contents: PDFHexString.of('00'.repeat(32)),
    Reference: [{ Type: 'SigRef', TransformMethod: 'DocMDP', TransformParams: { Type: 'TransformParams', P: 1, V: '1.2' } }],
  }));
  const veld = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('h'), V: sig, Rect: [0, 0, 0, 0], P: pagina.ref }));
  pagina.node.set(PDFName.of('Annots'), ctx.obj([veld]));
  d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [veld], SigFlags: 3 }));
  d.catalog.set(PDFName.of('Perms'), ctx.obj({ DocMDP: sig }));
  const bron = await d.save({ useObjectStreams: false });
  const r = await sla(bron, [vak('a', 50)]);
  assert.equal(r.gelukt, true);
  assert.equal(r.wijze.reden, 'docmdp-geen-wijzigingen');
  assert.ok(!begintMet(r.geschreven, bron));
});

test('conflict: verandert het document tijdens het opslaan, dan wordt er niets geschreven', async () => {
  const bron = await leegBlad();
  const r = await sla(bron, [vak('a', 50)], {
    impl: {
      unlockFile: () => { state.documents = []; },
      showMessage: () => {},
    },
  });
  assert.equal(r.gelukt, false);
  assert.equal(r.geschreven, null);
});

test('het model blijft na een incrementele save ongemoeid (undo en herhaald opslaan werken op hetzelfde model)', async () => {
  const bron = await leegBlad();
  const modellen = [vak('a', 50), vak('b', 200)];
  const kopie = JSON.stringify(modellen);
  const r = await sla(bron, modellen);
  assert.equal(r.wijze.wijze, 'incrementeel');
  assert.equal(JSON.stringify(modellen), kopie);
  // Een annotatie weghalen (zoals undo van "toevoegen") en opnieuw opslaan.
  const r2 = await sla(r.geschreven, [modellen[0]]);
  assert.equal(r2.wijze.wijze, 'incrementeel');
  assert.equal(mupdfLees(r2.geschreven).annotaties.filter((a) => a.soort === 'Square').length, 1);
  assert.equal(leesXrefKeten(r2.geschreven).secties, 3);
});

test('een nieuw object botst niet met /Info of objectstromen van de bron (pdf-lib-bron met objectstromen)', async () => {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  d.setTitle('Titel');
  const bron = await d.save({ useObjectStreams: true });
  const r = await sla(bron, [vak('a', 50)]);
  assert.equal(r.wijze.wijze, 'incrementeel', JSON.stringify(r.wijze));
  const keten = leesXrefKeten(r.geschreven);
  assert.equal(keten.vorm, 'stroom');
  const lib = await PDFDocument.load(r.geschreven);
  assert.equal(lib.getTitle(), 'Titel');
  assert.match(lib.getProducer() || '', /pdf-lib/, 'documentgegevens bijgewerkt zoals bij herschrijven');
  const info = lib.context.lookup(lib.context.trailerInfo.Info);
  assert.ok(info instanceof PDFDict);
});

test('bladwijzers: een ongewijzigde outline blijft staan (incrementeel), een gewijzigde titel herschrijft', async () => {
  const d = await PDFDocument.create();
  const p1 = d.addPage([595, 842]);
  const p2 = d.addPage([595, 842]);
  const ctx = d.context;
  const root = ctx.nextRef();
  const a = ctx.nextRef();
  const b = ctx.nextRef();
  const kind = ctx.nextRef();
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: a, Last: b, Count: 3 }));
  ctx.assign(a, ctx.obj({ Title: PDFString.of('Inleiding'), Parent: root, Next: b, Dest: [p1.ref, 'XYZ', null, null, null] }));
  ctx.assign(b, ctx.obj({ Title: PDFString.of('Tekeningen'), Parent: root, Prev: a, First: kind, Last: kind, Count: 1, Dest: [p2.ref, 'XYZ', 0, 842, null] }));
  ctx.assign(kind, ctx.obj({ Title: PDFString.of('Plattegrond'), Parent: b, Dest: [p2.ref, 'XYZ', 0, 400, null] }));
  d.catalog.set(PDFName.of('Outlines'), root);
  const bron = await d.save({ useObjectStreams: false });

  const { loadBookmarksFromPdf } = await import('./bladwijzers-lezen.js');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const js = await pdfjs.getDocument({ data: bron.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const bookmarks = await loadBookmarksFromPdf(js);
  await js.loadingTask.destroy();
  assert.equal(bookmarks.length, 3);

  const zelfde = await sla(bron, [vak('a', 50)], { document: { bookmarks: bookmarks.map((x) => ({ ...x })) } });
  assert.equal(zelfde.wijze.wijze, 'incrementeel', JSON.stringify(zelfde.wijze));
  const staart = Buffer.from(zelfde.geschreven.subarray(bron.length)).toString('latin1');
  assert.doesNotMatch(staart, /Inleiding|Outlines/, 'de outline staat niet in de toevoeging');

  const anders = bookmarks.map((x) => ({ ...x, title: x.title === 'Inleiding' ? 'Voorwoord' : x.title }));
  const gewijzigd = await sla(bron, [vak('a', 50)], { document: { bookmarks: anders } });
  assert.equal(gewijzigd.wijze.wijze, 'volledig');
  assert.equal(gewijzigd.wijze.reden, 'catalogus-gewijzigd');
  const js2 = await pdfjs.getDocument({ data: gewijzigd.geschreven.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  assert.equal((await js2.getOutline())[0].title, 'Voorwoord');
  await js2.loadingTask.destroy();
});
