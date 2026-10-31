// PDF's met een openingswachtwoord (wachtwoord-pdf.js): de foutherkenning, de
// vraag-en-ontsleutel-lus, de alleen-lezen-poort (ook het weigeren van
// opslaan), en dat tabblad, recente bestanden en sessie het ORIGINELE pad
// gebruiken en nooit de ontsleutelde werkkopie. Daarnaast de bedrading in de
// app en de teksten in alle 40 locales.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

import {
  FOUT_VERKEERD_WACHTWOORD, isWachtwoordFout, isOnjuistWachtwoordPdfjs, isWachtwoordNodigPdfjs,
  soortOntsleutelFout, isBeveiligdDocument, isAlleenLezen, opslaanGeweigerd, bronPad, hoortBijPad,
  sessieBestanden, vraagEnOntsleutel, markeerBeveiligd, isHostAlleenLezen,
} from './wachtwoord-pdf.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const JS = join(HIER, '..');
const bron = (rel) => readFileSync(join(JS, rel), 'utf8');

const pdfjsFout = (code) => Object.assign(new Error('No password given'), { name: 'PasswordException', code });

// ─── Foutherkenning ────────────────────────────────────────────────────────

test('a PDF.js PasswordException is recognised, other errors are not', () => {
  assert.equal(isWachtwoordFout(pdfjsFout(1)), true);
  assert.equal(isWachtwoordFout(new Error('Invalid PDF structure')), false);
  assert.equal(isWachtwoordFout(Object.assign(new Error('x'), { name: 'InvalidPDFException' })), false);
  assert.equal(isWachtwoordFout(null), false);
  assert.equal(isWachtwoordNodigPdfjs(pdfjsFout(1)), true);
  assert.equal(isOnjuistWachtwoordPdfjs(pdfjsFout(2)), true);
  assert.equal(isOnjuistWachtwoordPdfjs(pdfjsFout(1)), false);
});

test('decrypt errors: the Rust codes (string rejections) and PDF.js', () => {
  assert.equal(soortOntsleutelFout(FOUT_VERKEERD_WACHTWOORD), 'verkeerd-wachtwoord');
  assert.equal(soortOntsleutelFout(new Error('WRONG_PASSWORD')), 'verkeerd-wachtwoord');
  assert.equal(soortOntsleutelFout(pdfjsFout(2)), 'verkeerd-wachtwoord');
  assert.equal(soortOntsleutelFout('PDFIUM_UNAVAILABLE: PDFium is not loaded'), 'geen-pdfium');
  assert.equal(soortOntsleutelFout('DECRYPT_FAILED: cannot read file: not found'), 'mislukt');
  assert.equal(soortOntsleutelFout(new Error('WRONG_PASSWORDS are fun')), 'mislukt');
  assert.equal(soortOntsleutelFout(undefined), 'mislukt');
  // PDF.js vraagt voor het eerst (code 1): geen "verkeerd" bij de eerste vraag.
  assert.equal(soortOntsleutelFout(pdfjsFout(1)), 'mislukt');
});

// ─── Vragen tot het klopt ──────────────────────────────────────────────────

test('wrong password: asks again with the error flag; the right one returns the result', async () => {
  const vragen = [];
  const antwoorden = ['fout', 'ook fout', 'geheim'];
  const resultaat = await vraagEnOntsleutel({
    vraag: async ({ verkeerd }) => { vragen.push(verkeerd); return antwoorden.shift(); },
    ontsleutel: async (ww) => {
      if (ww !== 'geheim') throw 'WRONG_PASSWORD';
      return { filePath: 'C:/tmp/opds-beveiligd/1-0123456789abcdef.pdf' };
    },
  });
  assert.deepEqual(vragen, [false, true, true]);
  assert.deepEqual(resultaat, { filePath: 'C:/tmp/opds-beveiligd/1-0123456789abcdef.pdf' });
});

test('cancel returns null without decrypting; other errors are not retried', async () => {
  let pogingen = 0;
  assert.equal(await vraagEnOntsleutel({
    vraag: async () => null,
    ontsleutel: async () => { pogingen++; },
  }), null);
  assert.equal(pogingen, 0);

  await assert.rejects(vraagEnOntsleutel({
    vraag: async () => 'geheim',
    ontsleutel: async () => { pogingen++; throw 'DECRYPT_FAILED: disk full'; },
  }), /DECRYPT_FAILED/);
  assert.equal(pogingen, 1);

  // Annuleren na een verkeerd wachtwoord.
  const vragen = [];
  assert.equal(await vraagEnOntsleutel({
    vraag: async ({ verkeerd }) => { vragen.push(verkeerd); return vragen.length === 1 ? 'fout' : null; },
    ontsleutel: async () => { throw new Error('WRONG_PASSWORD'); },
  }), null);
  assert.deepEqual(vragen, [false, true]);
});

// ─── Alleen-lezen en opslaan ───────────────────────────────────────────────

test('a password-protected document is read-only and cannot be made editable', () => {
  const doc = { filePath: 'C:/tmp/opds-beveiligd/1-0123456789abcdef.pdf' };
  markeerBeveiligd(doc, 'D:/Projecten/geheim.pdf');
  assert.equal(isBeveiligdDocument(doc), true);
  assert.equal(isAlleenLezen(doc), true);
  // "Bewerken inschakelen" van PDF/A heft het niet op.
  doc.pdfaCompliance = { part: 2, conformance: 'B' };
  doc.pdfADismissed = true;
  assert.equal(isAlleenLezen(doc), true);
  assert.equal(opslaanGeweigerd(doc), true);
});

test('a document the host opened read-only (#704) cannot be edited; it is not password-protected', () => {
  const doc = { filePath: 'opds-host://DOC-1/a.pdf', hostAlleenLezen: true };
  assert.equal(isHostAlleenLezen(doc), true);
  assert.equal(isAlleenLezen(doc), true);
  doc.pdfaCompliance = { part: 2, conformance: 'B' };
  doc.pdfADismissed = true;
  assert.equal(isAlleenLezen(doc), true, '"Bewerken inschakelen" van PDF/A heft het niet op');
  assert.equal(opslaanGeweigerd(doc), false, 'opslaan als (een download) mag; de saver weigert alleen het terugschrijven');
  assert.equal(isHostAlleenLezen({ filePath: 'opds-host://DOC-2/b.pdf' }), false);
  assert.equal(isHostAlleenLezen(null), false);
});

test('PDF/A stays read-only until editing is enabled, and may be saved', () => {
  const doc = { filePath: 'D:/a.pdf', pdfaCompliance: { part: 1, conformance: 'B' }, pdfADismissed: false };
  assert.equal(isAlleenLezen(doc), true);
  assert.equal(opslaanGeweigerd(doc), false);
  doc.pdfADismissed = true;
  assert.equal(isAlleenLezen(doc), false);
  assert.equal(isAlleenLezen({ filePath: 'D:/b.pdf' }), false);
  assert.equal(isAlleenLezen(null), false);
  assert.equal(opslaanGeweigerd(null), false);
  // Alleen `true` telt: een losse waarheid elders in het model niet.
  assert.equal(isBeveiligdDocument({ passwordProtected: 'ja' }), false);
});

// ─── Origineel pad: tabblad, recent, sessie ────────────────────────────────

test('session and recent files use the original path, never the working copy', () => {
  const beveiligd = { filePath: 'C:/Temp/opds-beveiligd/42-0123456789abcdef.pdf', fileName: 'x' };
  markeerBeveiligd(beveiligd, 'D:/Projecten/contract.pdf');
  const gewoon = { filePath: 'D:/Projecten/tekening.pdf' };
  const naamloos = { filePath: 'C:/Temp/opds-blank-1.pdf', isUntitled: true };
  assert.equal(bronPad(beveiligd), 'D:/Projecten/contract.pdf');
  assert.equal(bronPad(gewoon), 'D:/Projecten/tekening.pdf');
  assert.equal(bronPad(null), null);
  assert.deepEqual(sessieBestanden([beveiligd, gewoon, naamloos, null]), [
    'D:/Projecten/contract.pdf',
    'D:/Projecten/tekening.pdf',
  ]);
  assert.ok(!sessieBestanden([beveiligd]).some((p) => p.includes('opds-beveiligd')));
  assert.equal(hoortBijPad(beveiligd, 'D:/Projecten/contract.pdf'), true);
  assert.equal(hoortBijPad(beveiligd, beveiligd.filePath), true);
  assert.equal(hoortBijPad(gewoon, 'D:/Projecten/contract.pdf'), false);
});

test('reader mode writes no position file for a protected PDF', async () => {
  const { readerTrackingPath } = await import('../core/reader-mode-tracking.js');
  const doc = { filePath: 'C:/Temp/opds-beveiligd/42-0123456789abcdef.pdf' };
  markeerBeveiligd(doc, 'D:/Projecten/contract.pdf');
  assert.equal(readerTrackingPath(doc), null);
  assert.equal(readerTrackingPath({ filePath: 'D:/Projecten/tekening.pdf' }), 'D:/Projecten/tekening.pdf');
});

test('opening the original again finds the existing tab (findDocumentByPath)', async () => {
  register('../core/app-test-hooks.mjs', import.meta.url);
  const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
  installeerBrowserStubs();
  const { state, findDocumentByPath } = await import('../core/state.ts');
  const voor = state.documents.length;
  const doc = { filePath: 'C:/Temp/opds-beveiligd/7-0123456789abcdef.pdf', fileName: 'contract.pdf' };
  markeerBeveiligd(doc, 'D:/Projecten/contract.pdf');
  state.documents.push(doc);
  try {
    assert.equal(findDocumentByPath('D:/Projecten/contract.pdf'), voor);
    assert.equal(findDocumentByPath(doc.filePath), voor);
    assert.equal(findDocumentByPath('D:/Projecten/anders.pdf'), -1);
  } finally {
    state.documents.splice(voor, 1);
  }
});

// ─── Wachtwoorddialoog (store) ─────────────────────────────────────────────

test('the dialog store: OK hands over the password, cancel gives null, one question at a time', async () => {
  register('../core/app-test-hooks.mjs', import.meta.url);
  const store = await import('../solid/stores/wachtwoordDialoogStore.js');
  const { getDialogs } = await import('../solid/stores/dialogStore.js');
  const open = () => getDialogs().some((d) => d.name === store.WACHTWOORD_DIALOOG);

  const gemeld = [];
  const afmelden = store.bijWachtwoordVraag(({ fileName }) => gemeld.push(fileName));

  const eerste = store.vraagWachtwoord({ fileName: 'contract.pdf' });
  assert.equal(open(), true);
  assert.equal(store.bestandsnaam(), 'contract.pdf');
  assert.equal(store.verkeerd(), false);
  assert.equal(store.wachtwoordGevraagd(), true);
  store.bevestigWachtwoord('geheim');
  assert.equal(await eerste, 'geheim');
  assert.equal(store.bezig(), true, 'the dialog stays open while decrypting');
  assert.equal(open(), true);

  const tweede = store.vraagWachtwoord({ fileName: 'contract.pdf', verkeerd: true });
  assert.equal(store.verkeerd(), true);
  assert.equal(store.bezig(), false);
  store.annuleerWachtwoord();
  assert.equal(await tweede, null);
  assert.equal(open(), false);
  afmelden();
  assert.deepEqual(gemeld, ['contract.pdf', 'contract.pdf']);

  // metWachtwoordDialoog: na elkaar, en daarna is de dialoog dicht.
  const volgorde = [];
  let losA;
  const a = store.metWachtwoordDialoog(async () => {
    volgorde.push('a-start');
    await new Promise((r) => { losA = r; });
    volgorde.push('a-eind');
    return 'A';
  });
  const b = store.metWachtwoordDialoog(async () => { volgorde.push('b'); return 'B'; });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(volgorde, ['a-start']);
  losA();
  assert.deepEqual(await Promise.all([a, b]), ['A', 'B']);
  assert.deepEqual(volgorde, ['a-start', 'a-eind', 'b']);
  assert.equal(open(), false);
});

// ─── Bedrading ─────────────────────────────────────────────────────────────

test('wiring: loader, saver, tabs, session and MCP use the gate', () => {
  const loader = bron('pdf/loader.js');
  assert.match(loader, /export function isPdfAReadOnly\(\) \{\s*return isAlleenLezen\(/);
  assert.match(loader, /isWachtwoordFout\(fout\)/);
  assert.match(loader, /invoke\('open_protected_pdf'/);
  assert.match(loader, /password: wachtwoord/, 'browser build passes the password to PDF.js');
  assert.match(loader, /addRecentFile\(recentPad/);

  const saver = bron('pdf/saver.js');
  const savePdf = saver.slice(saver.indexOf('export async function savePDF('));
  assert.match(savePdf.slice(0, 600), /weigerOpslaanBeveiligd\(activeDoc\)/, 'savePDF refuses first');
  const saveAs = saver.slice(saver.indexOf('export async function savePDFAs('));
  assert.match(saveAs.slice(0, 400), /weigerOpslaanBeveiligd\(doc\)/, 'savePDFAs refuses too');

  const tabs = bron('ui/chrome/tabs.js');
  // #378: alleen geen vraag als opslaan de beveiliging niet kan behouden.
  assert.match(tabs, /doc\.modified && !opslaanGeweigerd\(doc\)/, 'no unsaved-changes prompt when it cannot be saved');
  assert.match(tabs, /release_protected_pdf/, 'working copy deleted on close');
  assert.match(tabs, /unlockFile\(doc\.originalFilePath\)/);

  assert.match(bron('main.js'), /const openFiles = sessieBestanden\(state\.documents\)/);

  const mcp = bron('mcp-bridge.js');
  const save = mcp.slice(mcp.indexOf('async function handleSavePdf('));
  assert.match(save.slice(0, 700), /opslaanGeweigerd\(doc\)[\s\S]*readOnly: true/);
  assert.match(mcp, /dialog: 'pdf-password'/);

  assert.match(bron('solid/components/DialogHost.jsx'), /'pdf-password': PasswordDialog/);
  assert.match(bron('solid/App.jsx'), /<BeveiligdBar \/>/);
});

test('the password dialog: password field, Enter = OK, cancel on close/Esc', () => {
  const dlg = bron('solid/components/dialogs/PasswordDialog.jsx');
  assert.match(dlg, /type="password"/);
  assert.match(dlg, /e\.key === 'Enter'/);
  assert.match(dlg, /onClose=\{annuleerWachtwoord\}/);
  assert.match(dlg, /<Show when=\{verkeerd\(\)\}>/);
});

// ─── Teksten ───────────────────────────────────────────────────────────────

const LOCALES = join(JS, 'i18n/locales');
const lees = (l, ns) => JSON.parse(readFileSync(join(LOCALES, l, `${ns}.json`), 'utf8'));
const teksten = (l) => ({
  title: lees(l, 'dialogs').pdfPassword?.title,
  message: lees(l, 'dialogs').pdfPassword?.message,
  label: lees(l, 'dialogs').pdfPassword?.label,
  wrong: lees(l, 'dialogs').pdfPassword?.wrong,
  bar: lees(l, 'statusbar').passwordProtectedBar,
  save: lees(l, 'common').protectedPdfReadOnly,
});

test('all 40 locales have the password texts, translated', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  const en = teksten('en');
  for (const l of locales) {
    const t = teksten(l);
    for (const [k, v] of Object.entries(t)) {
      assert.equal(typeof v, 'string', `${l} ${k} missing`);
      assert.ok(v.trim().length > 0, `${l} ${k} empty`);
    }
    assert.match(t.message, /\{\{fileName\}\}/, `${l}: message lacks {{fileName}}`);
    if (l === 'en') continue;
    for (const k of ['message', 'wrong', 'bar', 'save']) {
      assert.notEqual(t[k], en[k], `${l} ${k} is the English text`);
    }
  }
});
