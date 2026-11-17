// Een formulierveld houdt bij het opslaan het lettertype uit zijn /DA (#1154).
// Getoetst met een gegenereerde PDF: een tekstveld waarvan de /DA een ingebed
// TrueType-lettertype in de /DR van het formulier aanwijst.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import {
  PDFDocument, PDFDict, PDFName, PDFRef, PDFString, decodePDFRawStream,
} from 'pdf-lib';
import {
  lettertypeNaamUitDA, tekstOngewijzigd, veldLettertype, werkVeldWeergavenBij,
} from './veld-lettertype.js';
import { isOntbrekendeGlyfenFout } from '../../text/glyf-dekking.js';
import { cssFamilie, lettertypenPerAnnotatie, vraagtEigenLettertype } from '../form-layer/veld-lettertype.js';

const N = (naam) => PDFName.of(naam);
const TTF = readFileSync(fileURLToPath(new URL(
  '../../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url,
)));

// Een enkelvoudig TrueType-lettertype (WinAnsi) met het hele bestand ingebed.
// `eerste`/`laatste`: het bereik van /Widths; daarbuiten heeft het lettertype
// voor de app geen glyf (zoals bij een ingebedde deelverzameling).
function enkelvoudigLettertype(doc, { basis = 'LiberationSans', eerste = 32, laatste = 126 } = {}) {
  const font = fontkit.create(TTF);
  const schaal = 1000 / font.unitsPerEm;
  const breedtes = [];
  for (let code = eerste; code <= laatste; code++) {
    breedtes.push(Math.round(font.glyphForCodePoint(code).advanceWidth * schaal));
  }
  const bestand = doc.context.register(doc.context.flateStream(TTF, { Length1: TTF.length }));
  const descriptor = doc.context.register(doc.context.obj({
    Type: 'FontDescriptor', FontName: basis, Flags: 32,
    FontBBox: [font.bbox.minX, font.bbox.minY, font.bbox.maxX, font.bbox.maxY].map((v) => Math.round(v * schaal)),
    ItalicAngle: 0, Ascent: Math.round(font.ascent * schaal), Descent: Math.round(font.descent * schaal),
    CapHeight: Math.round(font.capHeight * schaal), StemV: 80, FontFile2: bestand,
  }));
  return doc.context.register(doc.context.obj({
    Type: 'Font', Subtype: 'TrueType', BaseFont: basis, Encoding: 'WinAnsiEncoding',
    FirstChar: eerste, LastChar: laatste, Widths: breedtes, FontDescriptor: descriptor,
  }));
}

// Eén pagina met tekstveld "nummer" (waarde 1001) in het lettertype /MICR uit
// de /DR, met een bestaande weergave in dat lettertype.
async function chequePdf({ lettertype = {}, type0 = false, meerRegels = false } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([400, 200]);
  const form = doc.getForm();
  const veld = form.createTextField('nummer');
  if (meerRegels) veld.enableMultiline();
  veld.addToPage(page, { x: 20, y: 100, width: 200, height: meerRegels ? 60 : 24, borderWidth: 0 });

  let fontRef;
  if (type0) {
    const ingebed = await doc.embedFont(TTF, { subset: false });
    ingebed.encodeText('0123456789');
    await ingebed.embed();
    fontRef = ingebed.ref;
  } else {
    fontRef = enkelvoudigLettertype(doc, lettertype);
  }
  const acro = doc.catalog.lookup(N('AcroForm'), PDFDict);
  acro.set(N('DR'), doc.context.obj({ Font: { MICR: fontRef } }));
  veld.acroField.dict.set(N('DA'), PDFString.of('0 g /MICR 12 Tf'));
  veld.setText('1001');
  const eigen = veldLettertype(doc, veld.acroField.getWidgets()[0].dict);
  assert.ok(eigen, 'het lettertype uit de /DR is bruikbaar');
  veld.updateAppearances(eigen.font);
  return new Uint8Array(await doc.save({ updateFieldAppearances: false }));
}

function weergave(doc, naam = 'nummer') {
  const widget = doc.getForm().getTextField(naam).acroField.getWidgets()[0];
  const ap = widget.dict.lookup(N('AP'), PDFDict);
  const ref = ap.get(N('N'));
  const stream = doc.context.lookup(ref);
  const tekst = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  const fonts = stream.dict.lookup(N('Resources'), PDFDict).lookup(N('Font'), PDFDict);
  return { ref, tekst, fonts, widget };
}

function drLettertype(doc) {
  const dr = doc.catalog.lookup(N('AcroForm'), PDFDict).lookup(N('DR'), PDFDict);
  return dr.lookup(N('Font'), PDFDict).get(N('MICR'));
}

const hex = (tekst) => Buffer.from(tekst, 'latin1').toString('hex').toUpperCase();

// Wat de saver doet: waarde zetten, eigen lettertype, daarna pdf-lib voor de rest.
async function vulEnBewaar(bytes, waarde, opties = { weigerOntbrekend: true }) {
  const doc = await PDFDocument.load(bytes);
  const veld = doc.getForm().getTextField('nummer');
  if (!tekstOngewijzigd(veld, waarde)) veld.setText(waarde);
  const gedaan = werkVeldWeergavenBij(doc, opties);
  doc.getForm().updateFieldAppearances();
  const uit = new Uint8Array(await doc.save({ updateFieldAppearances: false }));
  return { gedaan, doc: await PDFDocument.load(uit), bytes: uit };
}

test('de /DA-naam wordt gelezen, ook met kleur ervoor', () => {
  assert.equal(lettertypeNaamUitDA('0 g /MICR 12 Tf'), 'MICR');
  assert.equal(lettertypeNaamUitDA('/Helv 0 Tf 0 0 1 rg'), 'Helv');
  assert.equal(lettertypeNaamUitDA('0 g'), '');
  assert.equal(lettertypeNaamUitDA(undefined), '');
});

test('een gewijzigde waarde houdt het ingebedde lettertype uit de /DR', async () => {
  const bron = await chequePdf();
  const { gedaan, doc } = await vulEnBewaar(bron, '2468');
  assert.equal(gedaan, 1);

  const { tekst, fonts } = weergave(doc);
  const dr = drLettertype(doc);
  assert.ok(dr instanceof PDFRef, 'de /DR houdt zijn lettertype');
  assert.deepEqual(fonts.keys().map(String), ['/MICR'], 'de weergave kent alleen het lettertype van het veld');
  assert.equal(fonts.get(N('MICR')), dr, 'de weergave wijst naar hetzelfde object als de /DR');
  assert.match(tekst, /\/MICR 12 Tf/);
  assert.ok(tekst.includes(`<${hex('2468')}>`), 'de nieuwe waarde staat in de codering van het lettertype');
  assert.doesNotMatch(tekst, /Helvetica/);

  const font = doc.context.lookup(dr, PDFDict);
  assert.equal(String(font.get(N('BaseFont'))), '/LiberationSans');
  assert.ok(font.lookup(N('FontDescriptor'), PDFDict).has(N('FontFile2')), 'het lettertype blijft ingebed');
  const veld = doc.getForm().getTextField('nummer');
  assert.equal(veld.getText(), '2468');
  assert.match(veld.acroField.getDefaultAppearance(), /\/MICR 12 Tf/, 'de /DA houdt zijn lettertype');
});

test('een ongewijzigde waarde laat de bestaande weergave staan', async () => {
  const bron = await chequePdf();
  const voor = weergave(await PDFDocument.load(bron));
  const { gedaan, doc } = await vulEnBewaar(bron, '1001');
  assert.equal(gedaan, 0);
  const na = weergave(doc);
  assert.equal(na.tekst, voor.tekst);
  assert.equal(na.fonts.get(N('MICR')), drLettertype(doc));
  assert.match(doc.getForm().getTextField('nummer').acroField.getDefaultAppearance(), /\/MICR 12 Tf/);
});

test('een samengesteld (Type0) lettertype uit de /DR blijft ook behouden', async () => {
  const bron = await chequePdf({ type0: true });
  const { gedaan, doc } = await vulEnBewaar(bron, '9075');
  assert.equal(gedaan, 1);
  const { tekst, fonts } = weergave(doc);
  assert.equal(fonts.get(N('MICR')), drLettertype(doc));
  assert.match(tekst, /\/MICR 12 Tf/);
  assert.match(tekst, /<[0-9A-F]{16}> Tj/, 'vier tekens van twee bytes');
  assert.equal(String(doc.context.lookup(drLettertype(doc), PDFDict).get(N('Subtype'))), '/Type0');
});

test('een veld met meerdere regels houdt het lettertype op elke regel', async () => {
  const bron = await chequePdf({ meerRegels: true });
  const { doc } = await vulEnBewaar(bron, '12\n34');
  const { tekst, fonts } = weergave(doc);
  assert.equal(fonts.get(N('MICR')), drLettertype(doc));
  assert.ok(tekst.includes(`<${hex('12')}>`) && tekst.includes(`<${hex('34')}>`));
});

test('een teken dat het ingebedde lettertype mist, weigert het opslaan en noemt het', async () => {
  // Alleen cijfers in de deelverzameling.
  const bron = await chequePdf({ lettertype: { basis: 'ABCDEF+LiberationSans', eerste: 48, laatste: 57 } });
  await assert.rejects(vulEnBewaar(bron, '12A4'), (fout) => {
    assert.ok(isOntbrekendeGlyfenFout(fout));
    assert.deepEqual(fout.tekens, ['A']);
    assert.equal(fout.veld, 'nummer');
    return true;
  });
  // Cijfers kunnen wel.
  const { doc } = await vulEnBewaar(bron, '7788');
  assert.ok(weergave(doc).tekst.includes(`<${hex('7788')}>`));
});

test('zonder weigeren (paginabewerking) maakt pdf-lib de weergave zoals voorheen', async () => {
  const bron = await chequePdf({ lettertype: { basis: 'ABCDEF+LiberationSans', eerste: 48, laatste: 57 } });
  const { gedaan, doc } = await vulEnBewaar(bron, '12A4', { weigerOntbrekend: false });
  assert.equal(gedaan, 0);
  assert.equal(doc.getForm().getTextField('nummer').getText(), '12A4');
  assert.ok(drLettertype(doc) instanceof PDFRef, 'de /DR blijft heel');
});

test('een /DA met een standaardlettertype zonder breedtes blijft bij pdf-lib', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const veld = doc.getForm().createTextField('naam');
  veld.addToPage(page, { x: 20, y: 100, width: 200, height: 24 });
  veld.setText('abc');
  assert.equal(werkVeldWeergavenBij(doc, { weigerOntbrekend: true }), 0);
  await doc.save();
  assert.equal(doc.getForm().getTextField('naam').getText(), 'abc');
});

test('PDF.js leest uit de weergave welk lettertype het veld gebruikt', async () => {
  const { bytes } = await vulEnBewaar(await chequePdf(), '2468');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const page = await pdf.getPage(1);
    const [veld] = (await page.getAnnotations({ intent: 'display' })).filter((a) => a.subtype === 'Widget');
    assert.equal(veld.defaultAppearanceData.fontName, 'MICR');
    assert.equal(vraagtEigenLettertype(veld), true);
    assert.equal(vraagtEigenLettertype({ ...veld, defaultAppearanceData: { fontName: 'Helv' } }), false);
    const opList = await page.getOperatorList({ intent: 'display', annotationMode: pdfjs.AnnotationMode.ENABLE });
    const perAnnotatie = lettertypenPerAnnotatie(opList, pdfjs.OPS);
    const objNaam = perAnnotatie.get(veld.id);
    assert.ok(objNaam, 'de weergave van het veld zet een lettertype');
    const font = await new Promise((klaar) => page.commonObjs.get(objNaam, klaar));
    assert.equal(font.missingFile, false, 'het ingebedde lettertypebestand is geladen');
    assert.match(String(font.mimetype), /^font\//);
    assert.equal(cssFamilie(font, () => true), font.loadedName, 'de naam voor het invoervak');
    assert.equal(cssFamilie(font, () => false), '', 'niet aangemeld bij de browser: geen lettertype zetten');
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test('lettertypenPerAnnotatie neemt het eerste lettertype binnen elke annotatie', () => {
  const OPS = { beginAnnotation: 1, endAnnotation: 2, setFont: 3, showText: 4 };
  const opList = {
    fnArray: [3, 1, 4, 3, 3, 2, 1, 2, 3, 1, 3, 2],
    argsArray: [['g_p'], ['12R'], [], ['g_a'], ['g_b'], [], ['13R'], [], ['g_q'], ['14R'], ['g_c'], []],
  };
  assert.deepEqual([...lettertypenPerAnnotatie(opList, OPS)], [['12R', 'g_a'], ['14R', 'g_c']]);
});
