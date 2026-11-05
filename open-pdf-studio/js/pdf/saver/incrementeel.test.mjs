// Incrementeel opslaan (#679): de schrijver en zijn weigeringen, los van de
// saver. Elke uitkomst wordt nagekeken met twee onafhankelijke lezers (pdf.js
// en MuPDF, en qpdf --check als dat geïnstalleerd is).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as mupdf from 'mupdf';
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFNumber, PDFArray, PDFDict } from 'pdf-lib';
import {
  leesXrefKeten, bereidIncrementeelVoor, bouwIncrementeleUpdate, leesOndertekening,
  vereistVolledigeHerschrijving, IncrementeelWeigering,
} from './incrementeel.js';
import {
  handgemaakt, bewerk, voegNotitieToe, pdfjsLees, mupdfLees, qpdfControle, begintMet,
} from './incrementeel.testhulp.mjs';
import { removeHiddenInformation } from '../hidden-information.js';

async function pdfLib({ objectStromen = false } = {}) {
  const d = await PDFDocument.create();
  d.addPage([200, 200]).drawText('Hallo', { x: 20, y: 100 });
  return d.save({ useObjectStreams: objectStromen });
}

function mupdfObjectStromen(bron) {
  const m = mupdf.Document.openDocument(bron, 'application/pdf').asPDF();
  return m.saveToBuffer('compress,objstms=yes').asUint8Array().slice();
}

function mupdfIncrementeel(bron, tekst) {
  const m = mupdf.Document.openDocument(bron, 'application/pdf').asPDF();
  const a = m.loadPage(0).createAnnotation('Text');
  a.setContents(tekst);
  a.update();
  return m.saveToBuffer('incremental').asUint8Array().slice();
}

/** Alles wat een geldige toevoeging moet zijn, met beide lezers. */
async function controleer(bron, uit, { vorm, notities }) {
  assert.ok(begintMet(uit, bron), 'de oorspronkelijke bytes staan ongewijzigd vooraan');
  const oud = leesXrefKeten(bron);
  const nieuw = leesXrefKeten(uit); // controleert ook elke offset
  assert.equal(nieuw.secties, oud.secties + 1, 'precies één xref-sectie erbij');
  assert.equal(nieuw.vorm, vorm, 'xref-vorm');
  assert.ok(nieuw.size >= oud.size, '/Size groeit of blijft');
  assert.equal(nieuw.root.toString(), oud.root.toString());
  const staart = Buffer.from(uit.subarray(bron.length)).toString('latin1');
  assert.match(staart, new RegExp(`/Prev ${oud.startxref}\\b`), '/Prev wijst naar de vorige sectie');
  assert.match(staart, /startxref\s+\d+\s+%%EOF\s*$/);
  if (vorm === 'stroom') assert.match(staart, /\/Type \/XRef/);
  else assert.match(staart, /\nxref\n/);

  const m = mupdfLees(uit);
  assert.equal(m.hersteld, false, 'MuPDF hoeft de xref niet te herstellen');
  assert.equal(m.versies, mupdfLees(bron).versies + 1, 'MuPDF ziet één revisie meer');
  assert.deepEqual(m.annotaties.filter((a) => a.soort === 'Text').map((a) => a.inhoud).sort(), notities.slice().sort());
  assert.match(m.tekst, /Hallo/);
  const p = await pdfjsLees(uit);
  assert.deepEqual(p.annotaties.filter((a) => a.subtype === 'Text').map((a) => a.contentsObj?.str).sort(), notities.slice().sort());
  assert.match(p.tekst, /Hallo/);
  const q = qpdfControle(uit);
  if (q) assert.equal(q.status, 0, q.uitvoer);
}

const BRONNEN = {
  'klassieke tabel (handgemaakt)': { maak: () => handgemaakt({ vorm: 'tabel' }), vorm: 'tabel' },
  'xref-stroom met objectstroom (handgemaakt)': { maak: () => handgemaakt({ vorm: 'stroom' }), vorm: 'stroom' },
  'xref-stroom met PNG-voorspeller': { maak: () => handgemaakt({ vorm: 'stroom', voorspeller: true }), vorm: 'stroom' },
  'hybride bestand (tabel + /XRefStm)': { maak: () => handgemaakt({ vorm: 'hybride', voorspeller: true }), vorm: 'tabel' },
  'pdf-lib zonder objectstromen': { maak: () => pdfLib(), vorm: 'tabel' },
  'pdf-lib met objectstromen': { maak: () => pdfLib({ objectStromen: true }), vorm: 'stroom' },
  'MuPDF met objectstromen': { maak: async () => mupdfObjectStromen(await pdfLib()), vorm: 'stroom' },
  'eerdere incrementele revisie (MuPDF)': { maak: async () => mupdfIncrementeel(await pdfLib(), 'eerder'), vorm: 'tabel', eerder: ['eerder'] },
};

for (const [naam, { maak, vorm, eerder = [] }] of Object.entries(BRONNEN)) {
  test(`${naam}: een notitie erbij laat de bron staan en geeft een geldige keten`, async () => {
    const bron = await maak();
    const r = await bewerk(bron, (d) => voegNotitieToe(d, 'nieuw'));
    assert.ok(r.bytes, r.weigering?.message);
    await controleer(bron, r.bytes, { vorm, notities: [...eerder, 'nieuw'] });
  });
}

test('herhaald opslaan en heropenen: elke ronde één revisie meer, alles leesbaar', async () => {
  for (const objectStromen of [false, true]) {
    let bytes = await pdfLib({ objectStromen });
    const notities = [];
    for (let ronde = 1; ronde <= 4; ronde++) {
      const vorige = bytes;
      const r = await bewerk(vorige, (d) => voegNotitieToe(d, `ronde ${ronde}`));
      assert.ok(r.bytes, r.weigering?.message);
      notities.push(`ronde ${ronde}`);
      await controleer(vorige, r.bytes, { vorm: objectStromen ? 'stroom' : 'tabel', notities });
      bytes = r.bytes;
    }
    assert.equal(leesXrefKeten(bytes).secties, 5);
  }
});

test('nieuwe objecten krijgen nummers boven /Size, ook boven objectstromen en xref-stromen', async () => {
  const bron = handgemaakt({ vorm: 'stroom' }); // 6 = objectstroom, 7 = xref-stroom
  const r = await bewerk(bron, (d) => voegNotitieToe(d));
  assert.ok(r.bytes);
  const staart = Buffer.from(r.bytes.subarray(bron.length)).toString('latin1');
  const nummers = [...staart.matchAll(/(\d+) 0 obj/g)].map((m) => Number(m[1]));
  assert.ok(nummers.includes(3), 'de pagina wordt herschreven');
  for (const n of nummers.filter((x) => x !== 3)) assert.ok(n >= 8, `nieuw object ${n} >= /Size`);
});

test('versleutelde bron: weigert met reden; pdf-lib laadt hem zonder ignoreEncryption niet eens', async () => {
  const m = mupdf.Document.openDocument(await pdfLib(), 'application/pdf').asPDF();
  const bron = m.saveToBuffer('encrypt=aes-256,user-password=,owner-password=geheim').asUint8Array().slice();
  await assert.rejects(PDFDocument.load(bron), /encrypt/i);
  const r = await bewerk(bron, (d) => voegNotitieToe(d), { laad: { ignoreEncryption: true } });
  assert.equal(r.bytes, undefined);
  assert.equal(r.weigering.reden, 'versleuteld');
});

test('kapotte invoer valt veilig terug: verkeerde startxref, geen startxref, verschoven objecten, /Prev-lus', async () => {
  const bron = Buffer.from(await pdfLib());
  const tekst = bron.toString('latin1');
  const sx = tekst.lastIndexOf('startxref');
  const offset = Number(/startxref\s+(\d+)/.exec(tekst.slice(sx))[1]);
  const gevallen = {
    'verkeerde startxref': Buffer.from(tekst.slice(0, sx) + `startxref\n${offset + 7}\n%%EOF\n`, 'latin1'),
    'geen startxref': Buffer.from(tekst.slice(0, sx), 'latin1'),
    'verschoven objecten': Buffer.from(tekst.replace('obj\n', 'obj\n\n\n\n'), 'latin1'),
  };
  // Een sectie die naar zichzelf terugwijst.
  const lus = await bewerk(new Uint8Array(bron), (d) => voegNotitieToe(d));
  const lt = Buffer.from(lus.bytes).toString('latin1');
  const laatste = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(lt)[1]);
  gevallen['/Prev-lus'] = Buffer.from(lt.replace(/\/Prev \d+/g, (m) => (lt.lastIndexOf(m) > laatste ? `/Prev ${laatste}`.padEnd(m.length) : m)), 'latin1');
  const verwacht = { 'geen startxref': 'geen-startxref' };
  let getoetst = 0;
  for (const [naam, kapot] of Object.entries(gevallen)) {
    // pdf-lib leest objecten op volgorde en kijkt niet naar de xref: het laadt ze allemaal.
    const doc = await PDFDocument.load(new Uint8Array(kapot), { updateMetadata: false });
    getoetst++;
    const plan = bereidIncrementeelVoor(new Uint8Array(kapot), doc);
    assert.ok(plan.weigering instanceof IncrementeelWeigering, naam);
    assert.equal(plan.weigering.reden, verwacht[naam] || 'xref-onjuist', `${naam}: ${plan.weigering.message}`);
    voegNotitieToe(doc);
    assert.equal(bouwIncrementeleUpdate(plan, doc).bytes, undefined, `${naam}: geen toevoeging`);
    // Het herschrijfpad werkt gewoon (pdf-lib leest objecten zonder xref).
    const herschreven = await doc.save();
    assert.equal(mupdfLees(herschreven).hersteld, false, naam);
  }
  assert.equal(getoetst, 4);
});

test('wat niet onder annotaties of formulier valt, weigert: inhoud, draaiing, bladwijzers, verwijderen', async () => {
  const bron = await pdfLib();
  const gevallen = [
    ['pagina-gewijzigd', (d) => d.getPage(0).drawText('Extra', { x: 20, y: 50 })],
    ['inhoud-gewijzigd', (d) => {
      const ref = d.getPage(0).node.Contents();
      const stroom = d.context.lookup(ref instanceof PDFArray ? ref.get(0) : d.getPage(0).node.get(PDFName.of('Contents')));
      const [doel] = d.context.enumerateIndirectObjects().find(([, o]) => o === stroom);
      d.context.assign(doel, d.context.flateStream('BT /F1 12 Tf (Anders) Tj ET'));
    }],
    ['pagina-gewijzigd', (d) => d.getPage(0).node.set(PDFName.of('Rotate'), PDFNumber.of(90))],
    ['catalogus-gewijzigd', (d) => d.catalog.set(PDFName.of('Outlines'), d.context.register(d.context.obj({ Type: 'Outlines', Count: 0 })))],
    ['verwijderd-object', (d) => {
      const [ref] = d.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type'))?.toString() === '/Font');
      d.context.delete(ref);
    }],
    ['geen-wijzigingen', () => {}],
  ];
  for (const [reden, wijzig] of gevallen) {
    const r = await bewerk(bron, wijzig);
    assert.equal(r.bytes, undefined, reden);
    assert.equal(r.weigering.reden, reden, r.weigering.message);
  }
  const r = await bewerk(bron, (d) => voegNotitieToe(d), { vereistVolledig: 'redactie' });
  assert.equal(r.weigering.reden, 'volledig-vereist');
});

test('redactie, verborgen informatie en verwijderde bijlagen vereisen volledig herschrijven', () => {
  assert.equal(vereistVolledigeHerschrijving({ annotations: [{ type: 'box' }] }), null);
  assert.equal(vereistVolledigeHerschrijving({ annotations: [{ type: 'redaction' }] }), 'redactie');
  assert.equal(vereistVolledigeHerschrijving({ annotations: [{ type: 'box', redacted: true }] }), 'redactie');
  assert.equal(vereistVolledigeHerschrijving({ annotations: [], vereistVolledigeHerschrijving: 'sanitiseren' }), 'sanitiseren');
  assert.equal(vereistVolledigeHerschrijving({ annotations: [], bijlagenWijzigingen: { verwijderd: ['a.txt'] } }), 'bijlage-verwijderd');
});

test('#646: een incrementele revisie bewaart verwijderde inhoud; verborgen informatie verwijderen herschrijft en haalt ze weg', async () => {
  const d = await PDFDocument.create();
  const pagina = d.addPage([200, 200]);
  const geheim = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [1, 1, 9, 9], Contents: PDFString.of('GEHEIM_COMMENTAAR') }));
  pagina.node.set(PDFName.of('Annots'), d.context.obj([geheim]));
  const bron = await d.save({ useObjectStreams: false });
  // Notitie weghalen en een andere erbij, incrementeel.
  const r = await bewerk(bron, (doc) => {
    doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([]));
    voegNotitieToe(doc, 'openbaar');
  });
  assert.ok(r.bytes, r.weigering?.message);
  assert.equal(mupdfLees(r.bytes).annotaties.length, 1, 'de huidige revisie toont alleen de nieuwe');
  assert.match(Buffer.from(r.bytes).toString('latin1'), /GEHEIM_COMMENTAAR/, 'de vorige revisie staat er nog: daarom nooit incrementeel saniteren');
  const { bytes } = await removeHiddenInformation(r.bytes, ['comments']);
  assert.doesNotMatch(Buffer.from(bytes).toString('latin1'), /GEHEIM_COMMENTAAR/);
  assert.ok(!begintMet(bytes, bron), 'gesaniteerde kopie is herschreven, geen toevoeging');
  assert.equal(leesXrefKeten(bytes).secties, 1, 'zonder eerdere revisies');
});

test('#646: het verwijderen van verborgen informatie gebruikt de incrementele schrijver niet', () => {
  for (const f of ['../hidden-information.js', '../hidden-information-service.js', '../hidden-information-scan.js']) {
    const bron = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
    assert.doesNotMatch(bron, /incrementeel/, f);
  }
});

// ── Ondertekend en gecertificeerd ────────────────────────────────────────────

async function ondertekend({ p = null, lock = null } = {}) {
  const d = await PDFDocument.create();
  const pagina = d.addPage([300, 300]);
  pagina.drawText('Hallo', { x: 20, y: 250 });
  const form = d.getForm();
  form.createTextField('naam').addToPage(pagina, { x: 20, y: 150, width: 120, height: 20 });
  form.createTextField('vrij').addToPage(pagina, { x: 20, y: 100, width: 120, height: 20 });
  const ctx = d.context;
  const sigDict = { Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 0, 0, 0], Contents: PDFHexString.of('00'.repeat(64)) };
  if (p !== null) {
    sigDict.Reference = [{ Type: 'SigRef', TransformMethod: 'DocMDP', TransformParams: { Type: 'TransformParams', P: p, V: '1.2' } }];
  }
  const sig = ctx.register(ctx.obj(sigDict));
  const veld = ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('handtekening'), V: sig, Rect: [0, 0, 0, 0], F: 132, P: pagina.ref });
  if (lock) veld.set(PDFName.of('Lock'), ctx.obj({ Type: 'SigFieldLock', Action: lock.actie, ...(lock.velden ? { Fields: lock.velden.map((v) => PDFString.of(v)) } : {}) }));
  const veldRef = ctx.register(veld);
  pagina.node.Annots().push(veldRef);
  const acro = d.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
  acro.lookup(PDFName.of('Fields'), PDFArray).push(veldRef);
  acro.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  if (p !== null) d.catalog.set(PDFName.of('Perms'), ctx.obj({ DocMDP: sig }));
  return d.save({ useObjectStreams: false });
}

const vulIn = (naam, waarde) => (d) => {
  const f = d.getForm();
  f.getTextField(naam).setText(waarde);
  f.updateFieldAppearances();
};

test('ondertekening herkennen: DocMDP, SigFlags en vergrendelde velden', async () => {
  for (const [opties, verwacht] of [
    [{}, { docMdp: null, sigFlags: 3, handtekeningen: 1 }],
    [{ p: 1 }, { docMdp: 1 }], [{ p: 2 }, { docMdp: 2 }], [{ p: 3 }, { docMdp: 3 }],
  ]) {
    const doc = await PDFDocument.load(await ondertekend(opties));
    const o = leesOndertekening(doc.context, doc.catalog);
    assert.equal(o.ondertekend, true);
    for (const [k, v] of Object.entries(verwacht)) assert.equal(o[k], v, k);
  }
  const doc = await PDFDocument.load(await ondertekend({ lock: { actie: 'Include', velden: ['naam'] } }));
  const o = leesOndertekening(doc.context, doc.catalog);
  assert.equal(o.heeftVergrendeling, true);
  assert.equal(o.vergrendeld('naam'), true);
  assert.equal(o.vergrendeld('vrij'), false);
});

test('DocMDP P=1 weigert elke wijziging; P=2 alleen formulier; P=3 ook annotaties', async () => {
  const p1 = await bewerk(await ondertekend({ p: 1 }), vulIn('naam', 'Jan'));
  assert.equal(p1.weigering?.reden, 'docmdp-geen-wijzigingen');

  const p2bron = await ondertekend({ p: 2 });
  const p2annot = await bewerk(p2bron, (d) => voegNotitieToe(d));
  assert.equal(p2annot.weigering?.reden, 'docmdp-alleen-formulier');
  const p2form = await bewerk(p2bron, vulIn('naam', 'Jan'));
  assert.ok(p2form.bytes, p2form.weigering?.message);
  assert.ok(begintMet(p2form.bytes, p2bron), 'ondertekende bytes onaangeroerd');
  const pj = await pdfjsLees(p2form.bytes);
  assert.equal(pj.velden.naam, 'Jan');
  assert.equal(mupdfLees(p2form.bytes).widgets.find((w) => w.naam === 'naam')?.waarde, 'Jan');
  assert.equal(mupdfLees(p2form.bytes).hersteld, false);

  const p3bron = await ondertekend({ p: 3 });
  const p3 = await bewerk(p3bron, (d) => voegNotitieToe(d, 'opmerking'));
  assert.ok(p3.bytes, p3.weigering?.message);
  assert.ok(begintMet(p3.bytes, p3bron));
});

test('FieldMDP: een vergrendeld veld weigert, een ander veld mag', async () => {
  const bron = await ondertekend({ lock: { actie: 'Include', velden: ['naam'] } });
  assert.equal((await bewerk(bron, vulIn('naam', 'Jan'))).weigering?.reden, 'fieldmdp-vergrendeld');
  const vrij = await bewerk(bron, vulIn('vrij', 'ok'));
  assert.ok(vrij.bytes, vrij.weigering?.message);
  const alles = await ondertekend({ lock: { actie: 'All' } });
  assert.equal((await bewerk(alles, vulIn('vrij', 'x'))).weigering?.reden, 'fieldmdp-vergrendeld');
});

test('een handtekening zelf wordt nooit incrementeel gewijzigd', async () => {
  const bron = await ondertekend();
  const r = await bewerk(bron, (d) => {
    const [, sig] = d.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type'))?.toString() === '/Sig');
    sig.set(PDFName.of('Reason'), PDFString.of('anders'));
  });
  assert.equal(r.weigering?.reden, 'handtekening-gewijzigd');
});
