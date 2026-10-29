import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PDFDocument, PDFName, PDFHexString, PDFDict } from 'pdf-lib';
import {
  pasBijlagenToe, leesBijlageNamen, vrijeNaam, metToegevoegd, metVerwijderd, zichtbareBijlagen, wijzigingenVan,
  isUitvoerbaarBestand, tijdelijkeBijlageNaam,
} from './bijlagen.js';

const tekst = (s) => new TextEncoder().encode(s);
const leeg = { toegevoegd: [], verwijderd: [] };

async function nieuwePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  return pdf;
}

// Openen zoals een andere lezer het doet: PDF.js leest de naamboom en de inhoud.
async function bijlagenVolgensPdfJs(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  try {
    const lijst = await pdf.getAttachments();
    const namen = lijst ? [...(lijst instanceof Map ? lijst.keys() : Object.keys(lijst))] : [];
    const inhoud = {};
    for (const naam of namen) inhoud[naam] = new TextDecoder().decode(await pdf.getAttachmentContent(naam));
    return inhoud;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

test('an added attachment survives save and reopen, with its content', async () => {
  const pdf = await nieuwePdf();
  const wijz = metToegevoegd(leeg, { naam: 'model.ifc', bytes: tekst('ISO-10303-21;'), mime: 'application/x-step', aangemaakt: '2026-10-14T10:00:00Z' });
  assert.equal(pasBijlagenToe(pdf, wijz), true);
  const opgeslagen = await pdf.save();
  assert.deepEqual(await bijlagenVolgensPdfJs(opgeslagen), { 'model.ifc': 'ISO-10303-21;' });
  const heropend = await PDFDocument.load(opgeslagen);
  assert.deepEqual(leesBijlageNamen(heropend), ['model.ifc']);
  // In /AF voor lezers die geassocieerde bestanden tonen.
  assert.equal(heropend.catalog.lookup(PDFName.of('AF')).size(), 1);
});

test('applying the same changes to the saved file again does not duplicate anything', async () => {
  const pdf = await nieuwePdf();
  const wijz = metToegevoegd(metToegevoegd(leeg, { naam: 'b.txt', bytes: tekst('B') }), { naam: 'a.txt', bytes: tekst('A') });
  pasBijlagenToe(pdf, wijz);
  const eerste = await pdf.save();
  const tweede = await PDFDocument.load(eerste);
  pasBijlagenToe(tweede, wijz);
  const bytes = await tweede.save();
  assert.deepEqual(leesBijlageNamen(await PDFDocument.load(bytes)), ['a.txt', 'b.txt']);
  assert.deepEqual(await bijlagenVolgensPdfJs(bytes), { 'a.txt': 'A', 'b.txt': 'B' });
});

test('removing an attachment written by another tool takes it out of the file', async () => {
  const pdf = await nieuwePdf();
  const groot = new Uint8Array(randomBytes(60000)); // comprimeert niet
  await pdf.attach(groot, 'calc.xlsx', { mimeType: 'application/vnd.ms-excel' });
  await pdf.attach(tekst('blijft'), 'notes.txt', { mimeType: 'text/plain' });
  const bron = await pdf.save();
  const doc = await PDFDocument.load(bron);
  assert.deepEqual(leesBijlageNamen(doc).sort(), ['calc.xlsx', 'notes.txt']);
  assert.equal(pasBijlagenToe(doc, metVerwijderd(leeg, 'calc.xlsx')), true);
  const uit = await doc.save();
  assert.deepEqual(await bijlagenVolgensPdfJs(uit), { 'notes.txt': 'blijft' });
  // De ingesloten stream is echt weg, niet alleen uit de lijst.
  assert.ok(uit.length < bron.length - 50000, `${uit.length} vs ${bron.length}`);
  // Nogmaals verwijderen (volgende save) verandert niets.
  assert.equal(pasBijlagenToe(await PDFDocument.load(uit), metVerwijderd(leeg, 'calc.xlsx')), false);
});

test('a name tree split over /Kids is read and rewritten as one flat list', async () => {
  const pdf = await nieuwePdf();
  const { context } = pdf;
  const spec = (naam) => context.register(context.obj({
    Type: 'Filespec', UF: PDFHexString.fromText(naam),
    EF: { F: context.register(context.flateStream(tekst(naam), { Type: 'EmbeddedFile' })) },
  }));
  const kind = (namen) => context.register(context.obj({
    Limits: [PDFHexString.fromText(namen[0]), PDFHexString.fromText(namen[namen.length - 1])],
    Names: namen.flatMap((n) => [PDFHexString.fromText(n), spec(n)]),
  }));
  const wortel = context.register(context.obj({ Kids: [kind(['a.txt', 'b.txt']), kind(['c.txt'])] }));
  pdf.catalog.set(PDFName.of('Names'), context.obj({ EmbeddedFiles: wortel }));
  const bron = await pdf.save();
  const doc = await PDFDocument.load(bron);
  assert.deepEqual(leesBijlageNamen(doc), ['a.txt', 'b.txt', 'c.txt']);
  pasBijlagenToe(doc, metToegevoegd(metVerwijderd(leeg, 'b.txt'), { naam: 'd.txt', bytes: tekst('d.txt') }));
  const uit = await doc.save();
  const ef = (await PDFDocument.load(uit)).catalog.lookup(PDFName.of('Names')).lookup(PDFName.of('EmbeddedFiles'));
  assert.ok(ef instanceof PDFDict && !ef.has(PDFName.of('Kids')));
  assert.deepEqual(await bijlagenVolgensPdfJs(uit), { 'a.txt': 'a.txt', 'c.txt': 'c.txt', 'd.txt': 'd.txt' });
});

test('a file specification still used by an annotation is kept when its list entry goes', async () => {
  const pdf = await nieuwePdf();
  await pdf.attach(tekst('x'), 'shared.txt');
  const doc = await PDFDocument.load(await pdf.save());
  const { context } = doc;
  const ef = doc.catalog.lookup(PDFName.of('Names')).lookup(PDFName.of('EmbeddedFiles'));
  const specRef = ef.lookup(PDFName.of('Names')).get(1);
  const annot = context.register(context.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [0, 0, 20, 20], FS: specRef }));
  doc.getPage(0).node.set(PDFName.of('Annots'), context.obj([annot]));
  pasBijlagenToe(doc, metVerwijderd(leeg, 'shared.txt'));
  assert.deepEqual(leesBijlageNamen(doc), []);
  assert.ok(context.lookup(specRef) instanceof PDFDict);
  assert.equal(doc.catalog.lookup(PDFName.of('Names')), undefined);
});

test('the panel model: unique names, replace, remove and the visible list', () => {
  assert.equal(vrijeNaam('plan.pdf', ['plan.pdf', 'plan (2).pdf']), 'plan (3).pdf');
  assert.equal(vrijeNaam('README', ['README']), 'README (2)');
  assert.equal(vrijeNaam('', []), 'bijlage');
  let w = metToegevoegd(leeg, { naam: 'a.txt', bytes: tekst('1') });
  w = metToegevoegd(w, { naam: 'a.txt', bytes: tekst('2') });
  assert.equal(w.toegevoegd.length, 1);
  assert.equal(new TextDecoder().decode(w.toegevoegd[0].bytes), '2');
  // Een toegevoegde naam die weer weg gaat, staat in de verwijderlijst: hij
  // kan al in een eerder opgeslagen versie van het bestand staan.
  w = metVerwijderd(w, 'a.txt');
  assert.deepEqual(w, { toegevoegd: [], verwijderd: ['a.txt'] });
  const basis = [{ naam: 'oud.txt' }, { naam: 'vervangen.txt' }, { naam: 'weg.txt' }];
  const lijst = zichtbareBijlagen(basis, {
    toegevoegd: [{ naam: 'vervangen.txt', bytes: tekst('nieuw') }], verwijderd: ['weg.txt'],
  });
  assert.deepEqual(lijst.map((b) => [b.naam, !!b.nieuw]), [['oud.txt', false], ['vervangen.txt', true]]);
  // Nooit het object op het document muteren (een document bewaart een kopie).
  const doc = { bijlagenWijzigingen: { toegevoegd: [], verwijderd: ['x'] } };
  const kopie = wijzigingenVan(doc);
  kopie.verwijderd.push('y');
  assert.deepEqual(doc.bijlagenWijzigingen.verwijderd, ['x']);
  assert.deepEqual(wijzigingenVan({}), leeg);
});

test('opening asks first for files the system runs, installs or follows', () => {
  for (const naam of [
    'setup.exe', 'run.BAT', 'x.msc', 'help.chm', 'link.url', 'disk.iso', 'snel.lnk', 'scherm.scr', 'app.hta',
    'paneel.cpl', 'tool.jar', 'script.ps1', 'script.vbs', 'script.wsf', 'x.scf', 'x.application', 'x.appref-ms',
    'x.vb', 'x.ws', 'x.inf', 'x.vhd', 'x.msix', 'x.settingcontent-ms', 'x.py', 'x.sh', 'x.desktop', 'x.AppImage',
    'x.dmg', 'x.pkg', 'x.command', 'x.workflow',
    // Windows negeert punten en spaties aan het eind.
    'setup.exe.', 'setup.exe  ', 'map/sub\\setup.exe',
  ]) assert.equal(isUitvoerbaarBestand(naam), true, naam);
  for (const naam of ['tekening.pdf', 'model.ifc', 'staat.xlsx', 'foto.jpg', 'exe', 'readme', '', null, 'notes.txt', 'archief.zip']) {
    assert.equal(isUitvoerbaarBestand(naam), false, String(naam));
  }
});

test('a file name from a PDF becomes a safe temp file name', () => {
  assert.equal(tijdelijkeBijlageNaam('..\\..\\Windows\\evil.exe'), 'evil.exe');
  assert.equal(tijdelijkeBijlageNaam('/etc/passwd'), 'passwd');
  assert.equal(tijdelijkeBijlageNaam('notes.txt:hidden.exe'), 'notes.txt_hidden.exe');
  assert.equal(isUitvoerbaarBestand(tijdelijkeBijlageNaam('notes.txt:hidden.exe')), true);
  assert.equal(tijdelijkeBijlageNaam('a<b>|c?.pdf'), 'a_b__c_.pdf');
  assert.equal(tijdelijkeBijlageNaam('setup.exe. . '), 'setup.exe');
  assert.equal(tijdelijkeBijlageNaam('..'), 'attachment');
  assert.equal(tijdelijkeBijlageNaam(''), 'attachment');
  assert.equal(tijdelijkeBijlageNaam(undefined), 'attachment');
});
