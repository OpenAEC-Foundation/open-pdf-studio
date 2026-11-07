// De waarschuwing vóór een export die informatie verliest (#629): één venster
// voor elke exportopdracht, "niet meer vragen" per soort in de opslag van de
// app, en de teksten in elke taal.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

import { EXPORT_SOORTEN, VERLIES_CODES } from './export-verlies.js';
import { bevestigExportVerlies, nietMeerVragen, zetNietMeerVragen, NIET_VRAGEN_NAAM } from '../ui/chrome/export-verlies-bevestigen.js';
import { getDialogs, closeDialog } from '../solid/stores/dialogStore.js';
import { leesOpslagJson, verwijderOpslag } from '../core/opslag.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = new URL('../i18n/locales/', import.meta.url);
const lees = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, LOCALES), 'utf8'));

const venster = () => getDialogs().find((d) => d.name === 'export-verlies');
const nepDoc = (annotations = [], extra = {}) => ({
  annotations,
  pdfDoc: { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'tekst' }] }) }) },
  ...extra,
});

test.beforeEach(() => {
  verwijderOpslag(NIET_VRAGEN_NAAM);
  closeDialog('export-verlies');
});

test('no losses: the export goes on without a dialog', async () => {
  // A flattened copy of a document without markups or form fields loses nothing.
  assert.deepEqual(await bevestigExportVerlies('flattened', nepDoc()), { ok: true, auteurs: null });
  assert.equal(venster(), undefined);
});

test('with losses the dialog asks; cancel stops the export, continue lets it go', async () => {
  const doc = nepDoc([{ id: 'a', type: 'box', page: 1 }]);
  const vraag = bevestigExportVerlies('raster', doc);
  await new Promise((r) => setTimeout(r, 0));
  const d = venster();
  assert.ok(d, 'the dialog is open');
  assert.equal(d.data.soort, 'raster');
  assert.equal(d.data.verliezenTonen, true);
  assert.deepEqual(d.data.verliesVoor(null).map((v) => v.code), ['textAsImage', 'vectorsAsPixels', 'markupsBurnedIn']);
  d.data.resolve({ ok: false });
  assert.deepEqual(await vraag, { ok: false, auteurs: null });
  assert.equal(nietMeerVragen('raster'), false);

  const opnieuw = bevestigExportVerlies('raster', doc);
  await new Promise((r) => setTimeout(r, 0));
  venster().data.resolve({ ok: true, nietMeerVragen: true });
  assert.deepEqual(await opnieuw, { ok: true, auteurs: null });
});

test('"don\'t ask again" is stored per export kind through the app storage', async () => {
  const doc = nepDoc([{ id: 'a', type: 'box', page: 1 }]);
  const vraag = bevestigExportVerlies('bcf', doc);
  await new Promise((r) => setTimeout(r, 0));
  venster().data.resolve({ ok: true, nietMeerVragen: true });
  await vraag;
  assert.deepEqual(leesOpslagJson(NIET_VRAGEN_NAAM), { bcf: true });
  assert.equal(nietMeerVragen('bcf'), true);
  assert.equal(nietMeerVragen('raster'), false);
  closeDialog('export-verlies');
  assert.deepEqual(await bevestigExportVerlies('bcf', doc), { ok: true, auteurs: null });
  assert.equal(venster(), undefined, 'no dialog for this kind any more');
  zetNietMeerVragen('bcf', false);
  assert.equal(nietMeerVragen('bcf'), false);
});

test('XFDF: the dialog lists the authors present and returns the choice; losses follow the choice', async () => {
  const anns = [
    { id: 'a', type: 'polygon', page: 1, author: 'Alice' },
    { id: 'b', type: 'line', page: 1, author: 'Bob' },
    { id: 'c', type: 'line', page: 1, author: 'Bob' },
  ];
  const vraag = bevestigExportVerlies('xfdf', nepDoc(anns), { annotatieLijst: anns, auteursKiezen: true });
  await new Promise((r) => setTimeout(r, 0));
  const d = venster();
  assert.deepEqual(d.data.auteurs, [{ naam: 'Alice', aantal: 1 }, { naam: 'Bob', aantal: 2 }]);
  assert.ok(d.data.verliesVoor(['Alice']).some((v) => v.code === 'typesNotExported'));
  assert.ok(!d.data.verliesVoor(['Bob']).some((v) => v.code === 'typesNotExported'));
  d.data.resolve({ ok: true, auteurs: ['Bob'] });
  assert.deepEqual(await vraag, { ok: true, auteurs: ['Bob'] });

  // "Don't ask again" for XFDF still shows the author choice, without the losses.
  zetNietMeerVragen('xfdf');
  const weer = bevestigExportVerlies('xfdf', nepDoc(anns), { annotatieLijst: anns, auteursKiezen: true });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(venster().data.verliezenTonen, false);
  assert.equal(venster().data.auteurs.length, 2);
  venster().data.resolve({ ok: true, auteurs: ['Alice', 'Bob'] });
  assert.deepEqual(await weer, { ok: true, auteurs: ['Alice', 'Bob'] });
});

test('a question that is still open counts as cancelled when the next one comes', async () => {
  const doc = nepDoc([{ id: 'a', type: 'box', page: 1 }]);
  const eerste = bevestigExportVerlies('raster', doc);
  await new Promise((r) => setTimeout(r, 0));
  const tweede = bevestigExportVerlies('bcf', doc);
  assert.deepEqual(await eerste, { ok: false, auteurs: null });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(venster().data.soort, 'bcf');
  venster().data.resolve({ ok: true });
  assert.deepEqual(await tweede, { ok: true, auteurs: null });
});

// ── Elke exportopdracht vraagt het, vóór het opslagvenster ──

const OPDRACHTEN = [
  { pad: '../annotations/xfdf.js', soort: 'xfdf', functie: 'export async function exportXFDFToFile', daarna: 'await saveFileDialog(' },
  { pad: '../bcf/bcf-ui.js', soort: 'bcf', functie: 'export async function exportBcfToFile', daarna: 'buildBcfZip(' },
  { pad: './flattened-copy.js', soort: 'flattened', functie: 'export async function maakGevlakteKopie', daarna: 'await saveFileDialog(' },
  { pad: './office-export.js', soort: 'format', functie: 'export async function exportOffice', daarna: 'await saveFileDialog(' },
  { pad: './pdfx-export.js', soort: 'pdfx', functie: 'export async function exportAsPdfX', daarna: 'await saveFileDialog(' },
  { pad: '../solid/components/dialogs/PdfADialog.jsx', soort: 'pdfa', functie: 'const slaOp = async', daarna: 'slaOpAlsPdfA(' },
  { pad: './exporter.js', soort: 'raster', functie: 'export async function exportAsRasterPdf', daarna: 'await saveFileDialog(' },
  { pad: '../solid/components/dialogs/CadExportDialog.jsx', soort: 'cad', functie: 'async function exporteer()', daarna: 'kiesDoelbestand(' },
];

for (const { pad, soort, functie, daarna } of OPDRACHTEN) {
  test(`${pad} asks before it exports (${soort})`, () => {
    const src = bron(pad);
    assert.match(src, /import \{ bevestigExportVerlies \} from '[./]+\/?(ui\/chrome\/)?export-verlies-bevestigen\.js';/);
    const begin = src.indexOf(functie);
    assert.ok(begin >= 0, functie);
    const fn = src.slice(begin);
    const soortTekst = soort === 'format' ? 'format' : `'${soort}'`;
    const vraag = fn.indexOf(`await bevestigExportVerlies(${soortTekst}`);
    const verder = fn.indexOf(daarna);
    assert.ok(vraag > 0, `${functie} calls bevestigExportVerlies(${soortTekst})`);
    assert.ok(verder > vraag, `${functie}: first the question, then ${daarna}`);
    assert.match(fn.slice(vraag, vraag + 200), /\)\)\.ok\) return|if \(!keuze\.ok\) return/);
  });
}

test('every export kind has a command that asks, and the options reach the losses', () => {
  const alle = OPDRACHTEN.map((o) => o.soort).filter((s) => s !== 'format');
  for (const s of EXPORT_SOORTEN) {
    if (['docx', 'odt', 'xlsx'].includes(s)) continue;
    assert.ok(alle.includes(s), s);
  }
  assert.match(bron('./office-export.js'), /bevestigExportVerlies\(format, doc, \{ afbeeldingen: includeImages \}\)/);
  assert.match(bron('./pdfx-export.js'), /bevestigExportVerlies\('pdfx', activeDoc, \{ conformance \}\)/);
  assert.match(bron('../solid/components/dialogs/PdfADialog.jsx'), /bevestigExportVerlies\('pdfa', d, \{ deel: deel\(\) \}\)/);
  assert.match(bron('../solid/components/dialogs/CadExportDialog.jsx'), /bevestigExportVerlies\('cad', doc, \{ annotaties: !!inst\.annotations \}\)/);
  // Raster: only interactively; a caller with its own outputPath is not asked.
  const raster = bron('./exporter.js');
  const r = raster.slice(raster.indexOf('export async function exportAsRasterPdf'));
  assert.ok(r.indexOf('if (!outputPath) {') < r.indexOf("bevestigExportVerlies('raster'"));
});

test('one movable Windows-style dialog, registered once', () => {
  const host = bron('../solid/components/DialogHost.jsx');
  assert.match(host, /import ExportVerliesDialog from '\.\/dialogs\/ExportVerliesDialog\.jsx';/);
  assert.match(host, /'export-verlies': ExportVerliesDialog,/);
  const dialoog = bron('../solid/components/dialogs/ExportVerliesDialog.jsx');
  assert.match(dialoog, /import Dialog from '\.\.\/Dialog\.jsx';/);
  assert.match(dialoog, /closeDialog\('export-verlies'\)/);
  for (const k of ['intro', 'authors', 'allAuthors', 'noAuthors', 'dontAskAgain', 'continue']) {
    assert.ok(dialoog.includes(`t('exportLoss.${k}')`), k);
  }
  assert.match(dialoog, /t\(`exportLoss\.title_\$\{data\.soort\}`\)/);
  assert.match(dialoog, /t\(`exportLoss\.\$\{v\.code\}`/);
  const css = bron('../../styles/dialogs.css');
  const blok = css.slice(css.indexOf('/* Wat een export niet meeneemt'), css.indexOf('/* Title Block Edit Dialog */'));
  assert.ok(blok.length > 100);
  assert.doesNotMatch(blok, /border-radius|cursor:/, 'square corners, default cursor');
});

// ── Teksten ──

const UI = ['intro', 'authors', 'allAuthors', 'noAuthors', 'dontAskAgain', 'continue'];
const sleutels = () => [...UI, ...EXPORT_SOORTEN.map((s) => `title_${s}`), ...VERLIES_CODES];
const invulplekken = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

test('every language has every text, with the same placeholders as English', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const en = lees('en', 'dialogs').exportLoss;
  assert.deepEqual(Object.keys(en).sort(), sleutels().sort());
  for (const taal of talen) {
    const t = lees(taal, 'dialogs').exportLoss || {};
    for (const k of sleutels()) {
      assert.ok(typeof t[k] === 'string' && t[k].trim(), `${taal}: exportLoss.${k}`);
      assert.deepEqual(invulplekken(t[k]), invulplekken(en[k]), `${taal}: exportLoss.${k}`);
    }
    const m = lees(taal, 'common').xfdfImportMerged;
    assert.deepEqual(invulplekken(m), ['count', 'duplicates', 'replies'], taal);
  }
});

test('Dutch is translated, and every list with kinds has a place for them', () => {
  const en = lees('en', 'dialogs').exportLoss;
  const nl = lees('nl', 'dialogs').exportLoss;
  const zelfde = Object.keys(en).filter((k) => !k.startsWith('title_') && nl[k] === en[k]);
  assert.deepEqual(zelfde, []);
  assert.equal(nl.dontAskAgain, 'Niet meer vragen voor deze export');
  assert.equal(nl.continue, 'Doorgaan');
  for (const k of ['typesNotExported', 'xfdfAppearance', 'appSpecific', 'pdfaFlattened']) {
    assert.ok(en[k].includes('{{types}}'), k);
  }
  assert.notEqual(lees('nl', 'common').xfdfImportMerged, lees('en', 'common').xfdfImportMerged);
});
