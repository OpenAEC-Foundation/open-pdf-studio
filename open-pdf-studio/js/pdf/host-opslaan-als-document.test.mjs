// Opslaan als op de site (#726): het document daarna, de teksten in alle 40
// talen, en de bedrading van Opslaan als en de exports.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { legDocumentVast, blijfBijOrigineel, wisselNaarNieuwBestand } from './host-opslaan-als-document.js';
import { FOUT_SLEUTELS } from '../core/host-opslaan-als.js';

const HIER = dirname(fileURLToPath(import.meta.url));
// CRLF in een checkout op Windows mag niets uitmaken.
const lees = (pad) => readFileSync(join(HIER, pad), 'utf8').replace(/\r\n/g, '\n');

const UITKOMST = { id: 'NIEUW-1', name: 'plan (copy).pdf', version: 1, renamed: false, pad: 'opds-host://NIEUW-1/plan (copy).pdf' };

test('het nieuwe bestand openen: tabblad, pad, id en versie wisselen; alleen-lezen vervalt', () => {
  const doc = {
    filePath: 'opds-host://DOC-1;versie=2/plan.pdf', fileName: 'plan.pdf', isUntitled: false,
    saveTargetPath: null, _renderTemp: true, hostAlleenLezen: true, hostVersie: { versie: 2, totaal: 3 }, modified: true,
  };
  const { weergavePad, nieuwPad } = wisselNaarNieuwBestand(doc, UITKOMST);
  assert.equal(weergavePad, 'opds-host://DOC-1;versie=2/plan.pdf');
  assert.equal(nieuwPad, UITKOMST.pad);
  assert.equal(doc.filePath, UITKOMST.pad);
  assert.equal(doc.fileName, 'plan (copy).pdf');
  assert.deepEqual(doc.hostBestand, { id: 'NIEUW-1', versie: 1 });
  assert.equal(doc.hostAlleenLezen, false);
  assert.equal(doc.hostVersie, null);
  assert.equal(doc.saveTargetPath, null);
  assert.equal(doc._renderTemp, false);
  assert.equal(doc.isUntitled, false);
});

test('verder met het origineel: het opslagdoel blijft het origineel, gewijzigd blijft gewijzigd', () => {
  const doc = { filePath: 'opds-host://DOC-1/plan.pdf', saveTargetPath: null, modified: true };
  const voor = legDocumentVast(doc);
  // savePDF() markeerde het als opgeslagen.
  doc.modified = false;
  assert.deepEqual(blijfBijOrigineel(doc, voor), { weerGewijzigd: true });
  assert.equal(doc.saveTargetPath, null);
  assert.equal(doc.filePath, 'opds-host://DOC-1/plan.pdf');

  // Het opslaan herlaadde op een werkkopie (ingebakken tekst) met saveTargetPath
  // naar het nieuwe bestand: Opslaan moet naar het origineel blijven gaan.
  const doc2 = { filePath: 'opds-host://DOC-1/plan.pdf', saveTargetPath: null, modified: false };
  const voor2 = legDocumentVast(doc2);
  doc2.filePath = 'opds-edit-123.pdf';
  doc2.saveTargetPath = 'opds-host-nieuw://1/plan (copy).pdf';
  assert.deepEqual(blijfBijOrigineel(doc2, voor2), { weerGewijzigd: false });
  assert.equal(doc2.saveTargetPath, 'opds-host://DOC-1/plan.pdf');
});

const SLEUTELS = {
  title: [], location: [], currentFolder: [], up: [], loading: [], listError: [], empty: [], readOnly: [],
  fileName: [], save: [], download: [], nameEmpty: [], nameInvalid: [], copyName: ['{{name}}'],
  saved: ['{{name}}'], renamed: ['{{name}}'], openNew: [], keepOriginal: [], notSavedTitle: [],
  errorReadOnly: [], errorInvalidName: [], errorTooLarge: [], errorQuota: [], errorNetwork: [],
  errorUnsupported: [], errorFailed: ['{{error}}'],
};
// Zinnen die in elke taal anders zijn dan in het Engels.
const ZINNEN = ['listError', 'renamed', 'errorReadOnly', 'errorInvalidName', 'errorTooLarge', 'errorQuota', 'errorNetwork', 'errorUnsupported'];

test('alle 40 talen hebben de teksten van Opslaan als op de site, met de invulplekken', () => {
  const locales = join(HIER, '../i18n/locales');
  const talen = readdirSync(locales);
  assert.equal(talen.length, 40);
  const en = JSON.parse(lees('../i18n/locales/en/common.json')).hostSaveAs;
  for (const taal of talen) {
    const h = JSON.parse(lees(`../i18n/locales/${taal}/common.json`)).hostSaveAs;
    assert.ok(h && typeof h === 'object', `${taal}: hostSaveAs ontbreekt`);
    assert.deepEqual(Object.keys(h).sort(), Object.keys(SLEUTELS).sort(), `${taal}: andere sleutels`);
    for (const [k, plekken] of Object.entries(SLEUTELS)) {
      assert.ok(typeof h[k] === 'string' && h[k].trim(), `${taal}: hostSaveAs.${k} leeg`);
      for (const plek of plekken) assert.ok(h[k].includes(plek), `${taal}: hostSaveAs.${k} zonder ${plek}`);
      // Geen stuur- of richtingstekens in een tekst (behalve de ZWNJ van het Perzisch).
      assert.doesNotMatch(h[k], /[\u0000-\u001f\u200e\u200f\u202a-\u202e\u2066-\u2069]/, `${taal}: hostSaveAs.${k}`);
    }
    if (taal !== 'en') for (const k of ZINNEN) assert.notEqual(h[k], en[k], `${taal}: hostSaveAs.${k} niet vertaald`);
  }
});

test('de code gebruikt de sleutels', () => {
  const code = [
    '../core/host-opslaan-als.js', 'host-opslaan-als-ui.js', 'saver.js',
    '../solid/components/dialogs/HostSaveAsDialog.jsx',
  ].map(lees).join('\n');
  for (const k of Object.keys(SLEUTELS)) {
    const sleutel = `hostSaveAs.${k}`;
    assert.ok(code.includes(`'${sleutel}'`) || Object.values(FOUT_SLEUTELS).includes(sleutel)
      || (k === 'nameEmpty' || k === 'nameInvalid') && code.includes("'hostSaveAs.nameEmpty' : 'hostSaveAs.nameInvalid'"),
    `de code gebruikt ${sleutel} niet`);
  }
});

test('Opslaan als gaat naar de site en biedt de keuze; de exports schrijven via het platform', () => {
  const saver = lees('saver.js');
  assert.match(saver, /if \(savePath && leesHostNieuwPad\(savePath\)\) return slaOpAlsOpSite\(doc, savePath, opties\);/);
  assert.match(saver, /HOST_OPSLAAN_ALS_UI\.naOpslaanAls\(uitkomst\)/);
  assert.match(saver, /wisselNaarNieuwBestand\(doc, uitkomst\)/);
  assert.match(saver, /void meldHostGeopend\(uitkomst\.id\)/);
  assert.match(saver, /if \(error\?\.gemeld\) return false;/, 'een gemelde weigering niet nog eens melden');
  // Pagina's uitnemen en de gevlakte kopie vragen een PDF via saveFileDialog
  // en schrijven met writeBinaryFile: daar zit de route naar de site.
  const pm = lees('page-manager.js');
  assert.match(pm, /saveFileDialog\(defaultPath, \[\{ name: 'PDF Files', extensions: \['pdf'\] \}\]\)/);
  assert.match(pm, /await writeBinaryFile\(savePath, extractBytes\)/);
  assert.match(pm, /await writeBinaryFile\(pad, bytes\)/);
  assert.match(lees('flattened-copy.js'), /saveFileDialog\(standaardDoelPad\(doc, null, GEVLAKT_ACHTERVOEGSEL\), \[\s*\{ name: 'PDF', extensions: \['pdf'\] \}/);
  const job = lees('print-job.js');
  assert.match(job, /await writeBinaryFile\(pad, await pdf\.save\(\)\);\n\s+\/\/[^\n]*\n\s+const doelPad = opgeslagenPad\(pad\);/);
  // De downloads van de webversie: eerst de site.
  for (const f of [
    '../solid/components/HiddenInformation.jsx', '../solid/components/PrintPreflight.jsx',
    '../solid/components/dialogs/FormRecognitionDialog.jsx', '../solid/components/dialogs/PortfolioDialog.jsx',
  ]) assert.match(lees(f), /bewaarPdfOpSite\(/, f);
  // De dialogen staan in de DialogHost.
  const host = lees('../solid/components/DialogHost.jsx');
  assert.match(host, /'host-save-as': HostSaveAsDialog/);
  assert.match(host, /'host-keuze': HostKeuzeDialog/);
});
