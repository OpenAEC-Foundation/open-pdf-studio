// Wat een export niet meeneemt (#629): de lijst per soort export, afgeleid
// van wat het document echt bevat, en de samenvatting van een open document.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  EXPORT_SOORTEN, XFDF_SOORTEN, VERLIES_CODES, exportVerliezen, vensterNodig, xfdfSchrijft, isDoorzichtig, telSoorten,
} from './export-verlies.js';
import { verzamelExportInhoud } from './export-verlies-inhoud.js';

const codes = (lijst) => lijst.map((v) => v.code);
const vind = (lijst, code) => lijst.find((v) => v.code === code);

const LEEG = { paginas: 0, tekst: false, annotaties: [], formuliervelden: false, lagen: 0, bijlagen: 0, bladwijzers: false, scripts: false, gewijzigd: false };
const PLAN = { ...LEEG, paginas: 3, tekst: true };
const ann = (type, extra = {}) => ({ id: `${type}-${Math.random()}`, type, page: 1, x: 1, y: 2, width: 3, height: 4, ...extra });

test('every export kind gives only known codes, also for an empty or missing summary', () => {
  const vol = {
    paginas: 2, tekst: true, formuliervelden: true, lagen: 2, bijlagen: 1, bladwijzers: true, scripts: true, gewijzigd: true,
    annotaties: [ann('comment', { replies: [{ author: 'A', text: 'x' }], status: 'accepted', hidden: true, opacity: 0.5 }),
      ann('polygon'), ann('stamp'), ann('parametricSymbol')],
  };
  for (const soort of EXPORT_SOORTEN) {
    for (const opties of [{}, { deel: 1 }, { deel: 2 }, { conformance: 'X-4' }, { afbeeldingen: true }, { annotaties: false }]) {
      for (const c of codes(exportVerliezen(soort, vol, opties))) assert.ok(VERLIES_CODES.includes(c), `${soort}: ${c}`);
    }
    assert.ok(Array.isArray(exportVerliezen(soort, undefined)));
    assert.ok(Array.isArray(exportVerliezen(soort, null)));
  }
  assert.deepEqual(exportVerliezen('onbekend', vol), []);
});

test('XFDF: page content, unsupported kinds per type, appearance, status and app data', () => {
  const v = exportVerliezen('xfdf', {
    ...PLAN,
    annotaties: [ann('polygon'), ann('polygon'), ann('measureDistance'), ann('comment', { status: 'accepted' }),
      ann('stamp'), ann('line'), ann('scaleRegion'), ann('draw', { path: [{ x: 1, y: 1 }] })],
  });
  assert.deepEqual(codes(v), ['pageContent', 'typesNotExported', 'xfdfAppearance', 'reviewStatus', 'appSpecific']);
  assert.deepEqual(vind(v, 'typesNotExported'), {
    code: 'typesNotExported', aantal: 4,
    soorten: [{ type: 'polygon', aantal: 2 }, { type: 'measureDistance', aantal: 1 }, { type: 'draw', aantal: 1 }],
  });
  assert.deepEqual(vind(v, 'xfdfAppearance').soorten, [{ type: 'stamp', aantal: 1 }]);
  assert.equal(vind(v, 'reviewStatus').aantal, 1);
  assert.deepEqual(vind(v, 'appSpecific').soorten, [{ type: 'scaleRegion', aantal: 1 }]);
});

test('XFDF: only what the document contains — a plain line on a page warns about the page alone', () => {
  assert.deepEqual(codes(exportVerliezen('xfdf', { ...PLAN, annotaties: [ann('line')] })), ['pageContent']);
  assert.deepEqual(codes(exportVerliezen('xfdf', { ...PLAN, formuliervelden: true, annotaties: [ann('line')] })),
    ['pageContent', 'formFieldValues']);
  // Status "none" is no status.
  assert.deepEqual(codes(exportVerliezen('xfdf', { ...LEEG, annotaties: [ann('line', { status: 'None' })] })), []);
});

test('XFDF_SOORTEN are exactly the branches that xfdf.js writes', () => {
  const bron = readFileSync(new URL('../annotations/xfdf.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const fn = bron.slice(bron.indexOf('function annotationToXFDF('), bron.indexOf('// Parse XFDF element to annotation'));
  const takken = [...fn.matchAll(/^\s{4}case '(\w+)':/gm)].map((m) => m[1]);
  assert.deepEqual([...takken].sort(), [...XFDF_SOORTEN].sort());
  assert.equal(xfdfSchrijft(ann('draw', { path: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })), true);
  assert.equal(xfdfSchrijft(ann('draw', { path: [] })), false);
  assert.equal(xfdfSchrijft(ann('cloud')), false);
});

test('BCF: only issues and a picture per page', () => {
  assert.deepEqual(exportVerliezen('bcf', { ...PLAN, annotaties: [ann('box'), ann('comment')] }), [
    { code: 'bcfPageSnapshot' }, { code: 'bcfOnlyIssues', aantal: 2 },
  ]);
});

test('flattened copy: form field values only with form fields, editability with markups, note text', () => {
  assert.deepEqual(codes(exportVerliezen('flattened', PLAN)), []);
  assert.deepEqual(codes(exportVerliezen('flattened', { ...PLAN, formuliervelden: true })), ['formFieldValues']);
  const v = exportVerliezen('flattened', { ...PLAN, annotaties: [ann('box'), ann('comment', { replies: [{ text: 'a' }, { text: 'b' }] })] });
  assert.deepEqual(v, [{ code: 'editability', aantal: 2 }, { code: 'noteText', aantal: 3 }]);
});

test('DOCX/ODT/XLSX: layout, markups, drawings depending on the page images option, scans', () => {
  const inhoud = { ...PLAN, annotaties: [ann('box')] };
  assert.deepEqual(codes(exportVerliezen('docx', inhoud)), ['layout', 'annotationsNotExported', 'drawingsNotExported']);
  assert.deepEqual(codes(exportVerliezen('odt', inhoud, { afbeeldingen: true })), ['layout', 'annotationsNotExported', 'drawingsAsImage']);
  assert.deepEqual(codes(exportVerliezen('xlsx', inhoud, { afbeeldingen: true })), ['layout', 'annotationsNotExported', 'drawingsNotInSheet']);
  assert.deepEqual(codes(exportVerliezen('docx', { ...PLAN, tekst: false, formuliervelden: true })),
    ['layout', 'noText', 'drawingsNotExported', 'formFieldValues']);
});

test('PDF/X: unsaved changes; transparency and layers only for X-3', () => {
  const inhoud = { ...PLAN, gewijzigd: true, lagen: 2, annotaties: [ann('textHighlight', { opacity: 0.3 }), ann('box', { fillOpacity: 0.5 }), ann('line')] };
  assert.deepEqual(exportVerliezen('pdfx', inhoud, { conformance: 'X-3' }), [
    { code: 'unsavedChanges' }, { code: 'pdfxTransparency', aantal: 2 }, { code: 'pdfxLayers', aantal: 2 },
  ]);
  assert.deepEqual(codes(exportVerliezen('pdfx', inhoud, { conformance: 'X-4' })), ['unsavedChanges']);
  assert.deepEqual(exportVerliezen('pdfx', PLAN), []);
});

test('PDF/A: what each part removes, and nothing for a plain document', () => {
  const inhoud = {
    ...PLAN, scripts: true, bijlagen: 2, lagen: 3,
    annotaties: [ann('polygon'), ann('box', { hidden: true }), ann('circle', { opacity: 0.5 })],
  };
  assert.deepEqual(codes(exportVerliezen('pdfa', inhoud, { deel: 1 })),
    ['scriptsRemoved', 'hiddenRemoved', 'attachmentsRemoved', 'layersMerged', 'pdfaTransparency', 'pdfaFlattened']);
  assert.deepEqual(vind(exportVerliezen('pdfa', inhoud, { deel: 1 }), 'pdfaFlattened').soorten, [{ type: 'polygon', aantal: 1 }]);
  assert.deepEqual(codes(exportVerliezen('pdfa', inhoud, { deel: 2 })), ['scriptsRemoved', 'hiddenRemoved', 'attachmentsOnlyPdfa']);
  assert.deepEqual(codes(exportVerliezen('pdfa', inhoud, { deel: 3 })), ['scriptsRemoved', 'hiddenRemoved']);
  assert.deepEqual(exportVerliezen('pdfa', PLAN, { deel: 1 }), []);
});

test('raster PDF: text and vectors, then only what is present', () => {
  assert.deepEqual(codes(exportVerliezen('raster', PLAN)), ['textAsImage', 'vectorsAsPixels']);
  assert.deepEqual(codes(exportVerliezen('raster', { ...PLAN, tekst: false })), ['vectorsAsPixels']);
  const vol = { ...PLAN, formuliervelden: true, bladwijzers: true, bijlagen: 1, lagen: 2, annotaties: [ann('box')] };
  assert.deepEqual(codes(exportVerliezen('raster', vol)),
    ['textAsImage', 'vectorsAsPixels', 'markupsBurnedIn', 'formFieldsAsImage', 'bookmarks', 'attachments', 'layers']);
});

test('CAD: which annotation kinds do not make it into the drawing', () => {
  const inhoud = { ...PLAN, gewijzigd: true, annotaties: [ann('comment'), ann('box', { hidden: true }), ann('line')] };
  assert.deepEqual(exportVerliezen('cad', inhoud, { annotaties: false }), [{ code: 'cadAnnotationsOff', aantal: 3 }]);
  assert.deepEqual(exportVerliezen('cad', inhoud, { annotaties: true }), [
    { code: 'unsavedChanges' }, { code: 'cadNotes', aantal: 1 }, { code: 'cadHidden', aantal: 1 },
  ]);
  assert.deepEqual(exportVerliezen('cad', { ...PLAN, gewijzigd: true }, { annotaties: true }), []);
});

test('helpers: transparency and counting per kind', () => {
  assert.equal(isDoorzichtig({ opacity: 1 }), false);
  assert.equal(isDoorzichtig({ opacity: 0.99 }), true);
  assert.equal(isDoorzichtig({ fillOpacity: 0 }), true);
  assert.equal(isDoorzichtig(null), false);
  assert.deepEqual(telSoorten([ann('a'), ann('b'), ann('a'), null, {}]), [{ type: 'a', aantal: 2 }, { type: 'b', aantal: 1 }]);
});

test('the dialog only comes when there is something to say or an author to choose', () => {
  const v = [{ code: 'pageContent' }];
  assert.deepEqual(vensterNodig({ verliezen: [], auteurs: [] }), { tonen: false, verliezenTonen: false, auteursTonen: false });
  assert.deepEqual(vensterNodig({ verliezen: v }), { tonen: true, verliezenTonen: true, auteursTonen: false });
  assert.deepEqual(vensterNodig({ verliezen: v, nietVragen: true }), { tonen: false, verliezenTonen: false, auteursTonen: false });
  // "Don't ask again" does not skip the author choice.
  assert.deepEqual(vensterNodig({ verliezen: v, nietVragen: true, auteurs: [{ naam: 'A' }, { naam: 'B' }] }),
    { tonen: true, verliezenTonen: false, auteursTonen: true });
  assert.equal(vensterNodig({ auteurs: [{ naam: 'A' }] }).tonen, false, 'one author: nothing to choose');
});

// ── De samenvatting van een open document ──

function nepPdf({ tekst = ['Hallo'], velden = null, lagen = [], bijlagen = null, outline = null, js = null, fout = false } = {}) {
  const gooi = () => { throw new Error('kapot'); };
  return {
    numPages: 2,
    getPage: async () => ({ getTextContent: async () => (fout ? gooi() : { items: tekst.map((str) => ({ str })) }) }),
    getFieldObjects: async () => (fout ? gooi() : velden),
    getOptionalContentConfig: async () => (fout ? gooi() : new Map(lagen.map((id) => [id, { visible: true }]))),
    getAttachments: async () => (fout ? gooi() : bijlagen),
    getOutline: async () => (fout ? gooi() : outline),
    getJSActions: async () => (fout ? gooi() : js),
  };
}

test('verzamelExportInhoud reads the open document through the pdf.js API', async () => {
  const doc = {
    modified: true, bookmarks: [],
    annotations: [ann('box')],
    bijlagenWijzigingen: { toegevoegd: [{ naam: 'b.txt' }], verwijderd: [] },
    pdfDoc: nepPdf({
      velden: new Map([['naam', [{ type: 'text' }]]]), lagen: ['1R', '2R'],
      bijlagen: new Map([['a.pdf', {}]]), outline: [{ title: 'H1' }], js: { open: ['x'] },
    }),
  };
  const s = await verzamelExportInhoud(doc);
  assert.deepEqual({ ...s, annotaties: s.annotaties.length }, {
    paginas: 2, tekst: true, annotaties: 1, formuliervelden: true, lagen: 2, bijlagen: 2,
    bladwijzers: true, scripts: true, gewijzigd: true,
  });
  const alleen = [ann('line'), ann('line')];
  assert.equal((await verzamelExportInhoud(doc, { annotaties: alleen })).annotaties, alleen);
});

test('verzamelExportInhoud: a scan without text, an empty document, and failing calls', async () => {
  const scan = await verzamelExportInhoud({ annotations: [], pdfDoc: nepPdf({ tekst: ['  ', ''] }) });
  assert.equal(scan.tekst, false);
  assert.equal(scan.formuliervelden, false);
  assert.equal(scan.lagen, 0);
  assert.equal(scan.bijlagen, 0);
  assert.equal(scan.bladwijzers, false);
  assert.equal(scan.scripts, false);
  // Failing calls count as "not present", unreadable text as "has text".
  const kapot = await verzamelExportInhoud({ pdfDoc: nepPdf({ fout: true }) });
  assert.deepEqual({ ...kapot, annotaties: kapot.annotaties.length }, {
    paginas: 2, tekst: true, annotaties: 0, formuliervelden: false, lagen: 0, bijlagen: 0,
    bladwijzers: false, scripts: false, gewijzigd: false,
  });
  const geen = await verzamelExportInhoud(null);
  assert.equal(geen.paginas, 0);
});
