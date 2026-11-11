// Bewerkbare documentgegevens (#1017): het XMP bijwerken als tekst, en de
// rondgang opslaan → heropenen met pdf-lib, pdf.js en MuPDF, volledig én
// incrementeel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mupdf from 'mupdf';
import { PDFDocument, PDFName } from 'pdf-lib';
import { werkXmpBij, overlayMet, zichtbareWaarden } from './documentgegevens.js';
import { schrijfDocumentgegevens } from './saver/documentgegevens-opslaan.js';
import { xmpWaarde, infoVerschillen } from './pdfa/xmp.js';
import { bewerk } from './saver/incrementeel.testhulp.mjs';

const XMP = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:format>application/pdf</dc:format>
  <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Oude titel</rdf:li></rdf:Alt></dc:title>
  <dc:creator><rdf:Seq><rdf:li>Oude auteur</rdf:li></rdf:Seq></dc:creator>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Oude maker">
  <xmp:ModifyDate>2001-01-01T00:00:00Z</xmp:ModifyDate>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"/>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

/** Een PDF met /Info en een XMP-pakket dat ermee overeenkomt. */
async function bronMetXmp({ xmp = XMP } = {}) {
  const d = await PDFDocument.create();
  d.addPage([200, 200]);
  d.setTitle('Oude titel');
  d.setAuthor('Oude auteur');
  d.setCreator('Oude maker');
  d.setModificationDate(new Date(Date.UTC(2001, 0, 1)));
  if (xmp) {
    const stroom = d.context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
    d.catalog.set(PDFName.of('Metadata'), d.context.register(stroom));
  }
  return d.save({ useObjectStreams: false, updateFieldAppearances: false });
}

function xmpVan(doc) {
  const ref = doc.catalog.get(PDFName.of('Metadata'));
  const obj = doc.context.lookup(ref);
  return new TextDecoder().decode(obj.getContents ? obj.getContents() : obj.contents);
}

async function pdfjsMetadata(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const { info, metadata } = await doc.getMetadata();
    return { info, xmpTitel: metadata?.get('dc:title') ?? null };
  } finally {
    await doc.loadingTask.destroy();
  }
}

const OVERLAY = {
  title: 'Nieuwe titel',
  author: 'Ann & Bob <bureau>',
  subject: 'Funderingsadvies — fase 2',
  keywords: 'beton, wapening',
  creator: '',
};

test('werkXmpBij: element- en attribuutvorm vervangen, ontbrekend toevoegen, leeg weghalen', () => {
  const uit = werkXmpBij(XMP, OVERLAY, { wijzigTijd: new Date(Date.UTC(2026, 10, 10, 12, 0, 0)) });
  assert.equal(xmpWaarde(uit, 'dc:title'), 'Nieuwe titel');
  assert.equal(xmpWaarde(uit, 'dc:creator'), 'Ann & Bob <bureau>');
  assert.match(uit, /Ann &amp; Bob &lt;bureau&gt;/, 'XML-tekens ontsnapt');
  assert.equal(xmpWaarde(uit, 'dc:description'), 'Funderingsadvies — fase 2');
  assert.equal(xmpWaarde(uit, 'pdf:Keywords'), 'beton, wapening');
  assert.equal(xmpWaarde(uit, 'xmp:CreatorTool'), undefined, 'leeg gemaakte maker is weg');
  assert.equal(xmpWaarde(uit, 'xmp:ModifyDate'), '2026-11-10T12:00:00Z');
  assert.equal(xmpWaarde(uit, 'dc:format'), 'application/pdf', 'de rest blijft staan');
  assert.match(uit, /^<\?xpacket begin=/);
  assert.match(uit, /<\?xpacket end="w"\?>$/);
  // Het zelfsluitende pdf-blok kreeg de trefwoorden.
  assert.match(uit, /xmlns:pdf="http:\/\/ns.adobe.com\/pdf\/1.3\/"><pdf:Keywords>beton, wapening<\/pdf:Keywords><\/rdf:Description>/);
});

test('werkXmpBij: zonder wijziging precies hetzelfde pakket (ook de tijd blijft)', () => {
  const zelfde = werkXmpBij(XMP, { title: 'Oude titel', author: 'Oude auteur', creator: 'Oude maker' }, { wijzigTijd: new Date() });
  assert.equal(zelfde, XMP);
  assert.equal(werkXmpBij(XMP, {}), XMP);
  assert.equal(werkXmpBij('geen xmp', { title: 'x' }), 'geen xmp');
});

test('werkXmpBij: namespace die nog niet gedeclareerd is krijgt een eigen rdf:Description', () => {
  const kaal = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta>';
  const uit = werkXmpBij(kaal, { title: 'T', keywords: 'k' });
  assert.equal(xmpWaarde(uit, 'dc:title'), 'T');
  assert.equal(xmpWaarde(uit, 'pdf:Keywords'), 'k');
  assert.match(uit, /xmlns:dc="http:\/\/purl.org\/dc\/elements\/1.1\/"/);
});

test('overlay en zichtbare waarden: de overlay gaat voor op het bestand', () => {
  let o = overlayMet(null, 'title', 'A');
  o = overlayMet(o, 'author', '');
  assert.deepEqual(o, { title: 'A', author: '' });
  assert.deepEqual(zichtbareWaarden({ Title: 'Bestand', Author: 'X', Subject: 'S' }, o),
    { title: 'A', author: '', subject: 'S', keywords: '', creator: '' });
  // Terug naar de waarde van het bestand: het veld valt uit de overlay.
  assert.equal(overlayMet({ title: 'A' }, 'title', 'Bestand', 'Bestand'), null);
  assert.throws(() => overlayMet(null, 'producer', 'x'));
});

test('volledig opslaan: /Info en XMP krijgen de nieuwe waarden; pdf-lib, pdf.js en MuPDF lezen ze terug', async () => {
  const bron = await bronMetXmp();
  const doc = await PDFDocument.load(bron);
  const r = schrijfDocumentgegevens(doc, OVERLAY);
  assert.deepEqual(r.info.sort(), ['author', 'creator', 'keywords', 'subject', 'title']);
  assert.equal(r.xmp, true);
  const uit = await doc.save();

  const terug = await PDFDocument.load(uit, { updateMetadata: false });
  assert.equal(terug.getTitle(), 'Nieuwe titel');
  assert.equal(terug.getAuthor(), 'Ann & Bob <bureau>');
  assert.equal(terug.getSubject(), 'Funderingsadvies — fase 2');
  assert.equal(terug.getKeywords(), 'beton, wapening');
  assert.equal(terug.getCreator(), undefined);
  const xml = xmpVan(terug);
  const info = { Title: terug.getTitle(), Author: terug.getAuthor(), Subject: terug.getSubject(), Keywords: terug.getKeywords() };
  assert.deepEqual(infoVerschillen(info, xml), [], 'XMP en /Info gelijk');

  const pj = await pdfjsMetadata(uit);
  assert.equal(pj.info.Title, 'Nieuwe titel');
  assert.equal(pj.xmpTitel, 'Nieuwe titel', 'pdf.js geeft het XMP voorrang: dat moet dus ook kloppen');

  const m = mupdf.Document.openDocument(uit, 'application/pdf');
  assert.equal(m.getMetaData('info:Title'), 'Nieuwe titel');
  assert.equal(m.getMetaData('info:Author'), 'Ann & Bob <bureau>');
});

test('volledig opslaan zonder XMP en zonder /Info-velden: alleen /Info, geen pakket erbij', async () => {
  const d = await PDFDocument.create();
  d.addPage([100, 100]);
  const bron = await d.save();
  const doc = await PDFDocument.load(bron);
  const r = schrijfDocumentgegevens(doc, { title: 'Één titel', author: 'Zoë' });
  assert.equal(r.xmp, false);
  const terug = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  assert.equal(terug.getTitle(), 'Één titel');
  assert.equal(terug.getAuthor(), 'Zoë');
  assert.equal(terug.catalog.get(PDFName.of('Metadata')), undefined);
});

test('schrijven is idempotent: dezelfde overlay op het opgeslagen bestand verandert niets', async () => {
  const doc = await PDFDocument.load(await bronMetXmp());
  schrijfDocumentgegevens(doc, OVERLAY);
  const eerste = await doc.save();
  // Zonder updateMetadata: pdf-lib zet anders zelf een maker op een leeg veld.
  const opnieuw = await PDFDocument.load(eerste, { updateMetadata: false });
  const r = schrijfDocumentgegevens(opnieuw, OVERLAY);
  assert.deepEqual(r, { info: [], xmp: false });
});

test('incrementeel opslaan: alleen documentgegevens gewijzigd is een echte revisie, met XMP mee', async () => {
  const bron = await bronMetXmp();
  const r = await bewerk(bron, (doc) => { schrijfDocumentgegevens(doc, OVERLAY); });
  assert.ok(r.bytes, r.weigering?.message);
  assert.ok(r.bytes.length > bron.length);
  assert.deepEqual(Buffer.from(r.bytes.subarray(0, bron.length)), Buffer.from(bron), 'de bron blijft voorvoegsel');

  const terug = await PDFDocument.load(r.bytes, { updateMetadata: false });
  assert.equal(terug.getTitle(), 'Nieuwe titel');
  assert.equal(terug.getCreator(), undefined);
  assert.equal(xmpWaarde(xmpVan(terug), 'dc:title'), 'Nieuwe titel');

  const pj = await pdfjsMetadata(r.bytes);
  assert.equal(pj.info.Title, 'Nieuwe titel');
  assert.equal(pj.xmpTitel, 'Nieuwe titel');
  const m = mupdf.Document.openDocument(r.bytes, 'application/pdf').asPDF();
  assert.equal(m.wasRepaired(), false);
  assert.equal(m.countVersions(), 2);
  assert.equal(m.getMetaData('info:Title'), 'Nieuwe titel');

  // Daarna dezelfde overlay nog eens: niets meer te doen.
  const nogmaals = await bewerk(r.bytes, (doc) => { schrijfDocumentgegevens(doc, OVERLAY); });
  assert.equal(nogmaals.bytes, undefined);
  assert.equal(nogmaals.weigering.reden, 'geen-wijzigingen');
});

test('incrementeel opslaan zonder XMP: alleen een nieuwe titel wordt niet geweigerd', async () => {
  const bron = await bronMetXmp({ xmp: null });
  const r = await bewerk(bron, (doc) => { schrijfDocumentgegevens(doc, { title: 'Alleen titel' }); });
  assert.ok(r.bytes, r.weigering?.message);
  const terug = await PDFDocument.load(r.bytes, { updateMetadata: false });
  assert.equal(terug.getTitle(), 'Alleen titel');
  assert.equal(terug.getAuthor(), 'Oude auteur');
});
