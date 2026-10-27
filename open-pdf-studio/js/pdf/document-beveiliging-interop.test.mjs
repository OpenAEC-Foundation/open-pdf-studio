// Documentbeveiliging (#378) tegen andere lezers: wat open-pdf-security
// schrijft, controleren met MuPDF en pdf.js (twee onafhankelijke
// implementaties). De Rust-kant draait via het voorbeeldprogramma
// open-pdf-security/examples/opds-beveiliging.rs; zonder cargo slaat deze
// test over. draai-unit-tests.mjs bouwt het vooraf (OPDS_BEVEILIGING_BIN),
// zodat er tijdens de parallelle tests geen compiler loopt.
//
//  - Beveiligen: beide lezers vragen het wachtwoord, weigeren een verkeerd
//    wachtwoord, zien V 5 / R 6 (AES-256) en de rechten (/P).
//  - Ontsleutelen met het rechtenwachtwoord.
//  - Openen → bewerken → opslaan: de bewerking (een annotatie) komt terug met
//    dezelfde wachtwoorden en rechten, ook het wachtwoord dat de app niet kende.
//  - Een AES-256-bestand van een andere schrijver (MuPDF) overnemen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beveiligingshulp } from '../../scripts/bouw-beveiligingshulp.mjs';
import * as mupdf from 'mupdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { rechtenNaarP, rechtenUitP } from './document-beveiliging.js';
import { STANDAARD_RECHTEN } from './protect-pdf-regels.js';

const map = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-beveiliging-'));
test.after(() => fs.rmSync(map, { recursive: true, force: true }));

// Het programma (vooraf gebouwd, of hier). Geen cargo: overslaan; een
// bouwfout: de test faalt.
const hulp = beveiligingshulp();
const geenCargo = hulp.geenCargo ? 'cargo niet gevonden' : false;

function opds(...args) {
  const r = spawnSync(hulp.bin, args, { encoding: 'utf8' });
  return { status: r.status, uit: (r.stdout || '').trim(), fout: (r.stderr || '').trim() };
}

function moetLukken(...args) {
  const r = opds(...args);
  assert.equal(r.status, 0, `opds-beveiliging ${args[0]} faalde: ${r.fout}`);
  return r.uit;
}

const pad = (naam) => path.join(map, naam);
const lees = (naam) => new Uint8Array(fs.readFileSync(pad(naam)));
const TEKST = 'Geheime tekst 42';

async function maakPlattePdf(naam) {
  const doc = await PDFDocument.create();
  doc.setTitle('Vertrouwelijk rapport');
  const pagina = doc.addPage([300, 200]);
  pagina.drawText(TEKST, { x: 20, y: 100, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  fs.writeFileSync(pad(naam), await doc.save());
}

/** Een tekstnotitie op pagina 1, zoals de saver een annotatie toevoegt. */
async function voegNotitieToe(bron, doel, inhoud) {
  const doc = await PDFDocument.load(lees(bron));
  const pagina = doc.getPage(0);
  const annot = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [20, 20, 40, 40], Contents: PDFString.of(inhoud), T: PDFString.of('Tester'),
  }));
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
  // Standaard met objectstromen, net als de saver.
  fs.writeFileSync(pad(doel), await doc.save());
}

async function pdfjs(bytes, password) {
  return getDocument({ data: bytes.slice(), password, isEvalSupported: false, verbosity: 0 }).promise;
}

async function pdfjsFout(bytes, password) {
  try {
    const d = await pdfjs(bytes, password);
    await d.loadingTask.destroy();
    return null;
  } catch (e) {
    return e;
  }
}

async function paginaTekst(doc) {
  const p = await doc.getPage(1);
  return (await p.getTextContent()).items.map((i) => i.str).join(' ');
}

function encryptVan(bytes) {
  const d = mupdf.Document.openDocument(bytes, 'application/pdf');
  const e = d.asPDF().getTrailer().get('Encrypt');
  const hex = (k) => Buffer.from(e.get(k).asByteString()).toString('hex');
  return {
    v: e.get('V').asNumber(), r: e.get('R').asNumber(), p: e.get('P').asNumber(),
    cfm: e.get('CF').get('StdCF').get('CFM').asName(),
    o: hex('O'), u: hex('U'), oe: hex('OE'), ue: hex('UE'),
  };
}

// pdf.js PermissionFlag-waarden zijn de bits van /P.
const PDFJS_VLAG = { print: 0x4, wijzigen: 0x8, kopieren: 0x10, annoteren: 0x20, formulieren: 0x100, toegankelijkheid: 0x200, samenstellen: 0x400, printHogeKwaliteit: 0x800 };
const MUPDF_RECHT = { print: 'print', wijzigen: 'edit', kopieren: 'copy', annoteren: 'annotate', formulieren: 'form', toegankelijkheid: 'accessibility', samenstellen: 'assemble', printHogeKwaliteit: 'print-hq' };

const RECHTEN = { ...STANDAARD_RECHTEN, kopieren: false, wijzigen: false, samenstellen: false, printHogeKwaliteit: false };
const P = rechtenNaarP(RECHTEN);

test('beveiligen: andere lezers vragen het wachtwoord en zien AES-256 en de rechten', { skip: geenCargo }, async () => {
  assert.ok(hulp.bin, `bouwen mislukt: ${hulp.fout}`);
  await maakPlattePdf('plat.pdf');
  moetLukken('protect', pad('plat.pdf'), pad('beveiligd.pdf'), 'open-ww-1', 'rechten-ww-1', String(P));
  const bytes = lees('beveiligd.pdf');
  assert.ok(!Buffer.from(bytes).toString('latin1').includes(TEKST), 'de tekst staat leesbaar in het bestand');
  assert.match(Buffer.from(bytes.subarray(0, 8)).toString('latin1'), /^%PDF-2\.0/);

  // MuPDF
  const m = mupdf.Document.openDocument(bytes, 'application/pdf');
  assert.equal(m.needsPassword(), true);
  assert.equal(m.authenticatePassword('verkeerd'), 0, 'verkeerd wachtwoord geweigerd');
  assert.equal(m.authenticatePassword('open-ww-1') & 2, 2, 'openwachtwoord geldt als gebruikerswachtwoord');
  for (const [recht, naam] of Object.entries(MUPDF_RECHT)) {
    assert.equal(m.hasPermission(naam), RECHTEN[recht], `MuPDF-recht ${naam}`);
  }
  const enc = encryptVan(bytes);
  assert.deepEqual([enc.v, enc.r, enc.cfm], [5, 6, 'AESV3']);
  assert.equal(enc.p | 0, P);
  assert.deepEqual(rechtenUitP(enc.p), RECHTEN);

  // pdf.js
  const zonder = await pdfjsFout(bytes);
  assert.equal(zonder?.name, 'PasswordException');
  assert.equal(zonder.code, 1, 'pdf.js vraagt om een wachtwoord');
  const fout = await pdfjsFout(bytes, 'verkeerd');
  assert.equal(fout?.code, 2, 'pdf.js weigert een verkeerd wachtwoord');
  const d = await pdfjs(bytes, 'open-ww-1');
  assert.match(await paginaTekst(d), /Geheime tekst 42/);
  assert.equal((await d.getMetadata()).info.Title, 'Vertrouwelijk rapport');
  const vlaggen = new Set(await d.getPermissions());
  for (const [recht, vlag] of Object.entries(PDFJS_VLAG)) {
    assert.equal(vlaggen.has(vlag), RECHTEN[recht], `pdf.js-recht ${recht}`);
  }
  await d.loadingTask.destroy();
});

test('ontsleutelen met het rechtenwachtwoord', { skip: geenCargo }, async () => {
  const bytes = lees('beveiligd.pdf');
  const m = mupdf.Document.openDocument(bytes, 'application/pdf');
  assert.equal(m.authenticatePassword('rechten-ww-1') & 4, 4, 'MuPDF: rechtenwachtwoord geeft eigenaarstoegang');
  assert.equal(m.hasPermission('copy'), true, 'met het rechtenwachtwoord gelden de beperkingen niet');

  moetLukken('decrypt', pad('beveiligd.pdf'), 'rechten-ww-1', pad('ontsleuteld.pdf'));
  const plat = lees('ontsleuteld.pdf');
  assert.equal(mupdf.Document.openDocument(plat, 'application/pdf').needsPassword(), false);
  const d = await pdfjs(plat);
  assert.match(await paginaTekst(d), /Geheime tekst 42/);
  assert.equal(await d.getPermissions(), null, 'geen beperkingen meer');
  await d.loadingTask.destroy();

  const r = opds('decrypt', pad('beveiligd.pdf'), 'verkeerd', pad('x.pdf'));
  assert.equal(r.status, 2);
  assert.equal(r.fout, 'WRONG_PASSWORD');
});

test('openen, bewerken en opslaan houdt de beveiliging en de annotatie', { skip: geenCargo }, async () => {
  // Zoals de app: een andere implementatie (hier MuPDF, in de app PDFium)
  // ontsleutelt met het openwachtwoord naar een werkkopie ...
  const m = mupdf.Document.openDocument(lees('beveiligd.pdf'), 'application/pdf');
  assert.ok(m.authenticatePassword('open-ww-1'));
  fs.writeFileSync(pad('werkkopie.pdf'), m.asPDF().saveToBuffer('decrypt').asUint8Array());
  // ... pdf-lib voegt een annotatie toe ...
  await voegNotitieToe('werkkopie.pdf', 'bewerkt-plat.pdf', 'Notitie bij een beveiligd bestand');
  // ... en Rust schrijft terug met de beveiliging van het origineel.
  moetLukken('rewrap', pad('beveiligd.pdf'), 'open-ww-1', pad('bewerkt-plat.pdf'), pad('bewerkt.pdf'));
  const bytes = lees('bewerkt.pdf');
  assert.ok(!Buffer.from(bytes).toString('latin1').includes('Notitie bij'), 'de notitie staat leesbaar in het bestand');

  const oud = encryptVan(lees('beveiligd.pdf'));
  const nieuw = encryptVan(bytes);
  assert.deepEqual(nieuw, oud, 'zelfde /O, /U, /OE, /UE, /P en methode');

  assert.equal((await pdfjsFout(bytes))?.code, 1, 'vraagt nog steeds het wachtwoord');
  const d = await pdfjs(bytes, 'open-ww-1');
  assert.match(await paginaTekst(d), /Geheime tekst 42/);
  const annots = await (await d.getPage(1)).getAnnotations();
  assert.equal(annots.length, 1);
  assert.equal(annots[0].contentsObj?.str, 'Notitie bij een beveiligd bestand');
  assert.equal(new Set(await d.getPermissions()).has(PDFJS_VLAG.kopieren), false, 'rechten blijven');
  await d.loadingTask.destroy();

  // Het rechtenwachtwoord, dat de app nooit zag, werkt nog.
  const e = mupdf.Document.openDocument(bytes, 'application/pdf');
  assert.equal(e.authenticatePassword('rechten-ww-1') & 4, 4);
  assert.equal(e.authenticatePassword('verkeerd'), 0);

  // Terugschrijven met een verkeerd wachtwoord lukt niet.
  const r = opds('rewrap', pad('beveiligd.pdf'), 'verkeerd', pad('bewerkt-plat.pdf'), pad('y.pdf'));
  assert.equal(r.status, 2);
  assert.equal(r.fout, 'WRONG_PASSWORD');
});

test('zonder openwachtwoord: opent vrij, de rechten gelden en blijven bij opslaan', { skip: geenCargo }, async () => {
  const rechten = { ...STANDAARD_RECHTEN, print: false, printHogeKwaliteit: false };
  moetLukken('protect', pad('plat.pdf'), pad('rechten.pdf'), '', 'rechten-ww-2', String(rechtenNaarP(rechten)));
  const bytes = lees('rechten.pdf');
  const m = mupdf.Document.openDocument(bytes, 'application/pdf');
  assert.equal(m.needsPassword(), false);
  assert.equal(m.hasPermission('print'), false);
  const d = await pdfjs(bytes);
  assert.equal(new Set(await d.getPermissions()).has(PDFJS_VLAG.print), false);
  await d.loadingTask.destroy();

  // Openen met het lege wachtwoord, bewerken, terugschrijven.
  moetLukken('decrypt', pad('rechten.pdf'), '', pad('rechten-plat.pdf'));
  await voegNotitieToe('rechten-plat.pdf', 'rechten-bewerkt-plat.pdf', 'Tweede notitie');
  moetLukken('rewrap', pad('rechten.pdf'), '', pad('rechten-bewerkt-plat.pdf'), pad('rechten-bewerkt.pdf'));
  const terug = lees('rechten-bewerkt.pdf');
  assert.deepEqual(encryptVan(terug), encryptVan(bytes));
  const t = await pdfjs(terug);
  assert.equal((await (await t.getPage(1)).getAnnotations())[0].contentsObj?.str, 'Tweede notitie');
  assert.equal(new Set(await t.getPermissions()).has(PDFJS_VLAG.print), false);
  await t.loadingTask.destroy();
});

test('een AES-256-bestand van een andere schrijver overnemen', { skip: geenCargo }, async () => {
  const plat = mupdf.Document.openDocument(lees('plat.pdf'), 'application/pdf');
  const p = rechtenNaarP({ ...STANDAARD_RECHTEN, kopieren: false });
  fs.writeFileSync(pad('mupdf.pdf'), plat.asPDF().saveToBuffer(
    `encrypt=aes-256,user-password=mu-open,owner-password=mu-rechten,permissions=${p},compress`,
  ).asUint8Array());
  const info = JSON.parse(moetLukken('info', pad('mupdf.pdf')));
  assert.deepEqual([info.encrypted, info.methode, info.v, info.r, info.p], [true, 'AES-256', 5, 6, p]);

  await voegNotitieToe('plat.pdf', 'mupdf-bewerkt-plat.pdf', 'Derde notitie');
  moetLukken('rewrap', pad('mupdf.pdf'), 'mu-open', pad('mupdf-bewerkt-plat.pdf'), pad('mupdf-bewerkt.pdf'));
  const bytes = lees('mupdf-bewerkt.pdf');
  const m = mupdf.Document.openDocument(bytes, 'application/pdf');
  assert.equal(m.authenticatePassword('mu-rechten') & 4, 4, 'het rechtenwachtwoord van MuPDF werkt nog');
  const d = await pdfjs(bytes, 'mu-open');
  assert.equal((await (await d.getPage(1)).getAnnotations())[0].contentsObj?.str, 'Derde notitie');
  assert.equal(new Set(await d.getPermissions()).has(PDFJS_VLAG.kopieren), false);
  await d.loadingTask.destroy();

  assert.equal(JSON.parse(moetLukken('info', pad('plat.pdf'))).encrypted, false);
});
