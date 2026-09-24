// De CMYK-kant van de PDF/X-export (#422) aan de webview-kant: het
// draadformaat van het Rust-antwoord, de aanroep met rauwe bytes, het
// verslag voor de gebruiker, de onthouden keuze en de vertalingen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  unpackCmykResponse,
  convertToCmyk,
  formatCmykReport,
  profileErrorMessage,
  conversionErrorMessage,
  herstelPdfxInstellingen,
  PDFX_STANDAARD,
  REPORT_KINDS,
  SKIP_REASONS,
} = await import('./pdfx-cmyk.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const menu = (lang) => JSON.parse(readFileSync(join(HERE, '../i18n/locales', lang, 'appMenu.json'), 'utf8'));

/** Een `t` zoals i18next hem geeft, op de echte vertaalbestanden. */
function tFor(lang) {
  const data = menu(lang);
  return (key, vars = {}) => {
    const path = key.replace(/^appMenu:/, '').split('.');
    let v = data;
    for (const p of path) v = v?.[p];
    if (typeof v !== 'string') return key;
    return v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(vars[n]));
  };
}

function pack(meta, profile, pdf) {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(8 + json.length + profile.length + pdf.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, json.length, true);
  out.set(json, 4);
  dv.setUint32(4 + json.length, profile.length, true);
  out.set(profile, 8 + json.length);
  out.set(pdf, 8 + json.length + profile.length);
  return out.buffer;
}

const emptyTally = () => ({ converted: 0, skipped: {} });
const emptyReport = () => Object.fromEntries(REPORT_KINDS.map((k) => [k, emptyTally()]));

test('het draadformaat wordt uitgepakt zonder te kopiëren of te ontleden als JSON-getallen', () => {
  const report = emptyReport();
  report.images.converted = 3;
  const buffer = pack({ report, profileName: 'Proef' }, new Uint8Array([1, 2, 3]), new Uint8Array([37, 80, 68, 70]));
  const out = unpackCmykResponse(buffer);
  assert.equal(out.profileName, 'Proef');
  assert.equal(out.report.images.converted, 3);
  assert.deepEqual([...out.profile], [1, 2, 3]);
  assert.deepEqual([...out.pdf], [37, 80, 68, 70]);
  assert.equal(out.pdf.buffer, buffer, 'een blik op dezelfde buffer');
});

test('een kapot antwoord geeft een fout in plaats van rommel', () => {
  assert.throws(() => unpackCmykResponse(new Uint8Array([255, 255, 0, 0]).buffer), /response/);
});

test('omzetten stuurt de PDF als rauwe body en pad en intent als koppen', async () => {
  const calls = [];
  const invoke = async (cmd, body, options) => {
    calls.push({ cmd, body, options });
    return pack({ report: emptyReport(), profileName: 'X' }, new Uint8Array([9]), new Uint8Array([1]));
  };
  const pdf = new Uint8Array([37, 80, 68, 70]);
  const out = await convertToCmyk(invoke, pdf, { profilePath: 'C:\\Kleur\\Krant René.icc', intent: 'perceptual' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'pdfx_convert_to_cmyk');
  assert.equal(calls[0].body, pdf, 'de bytes zelf, geen array van getallen');
  assert.deepEqual(calls[0].options, {
    headers: { 'x-profile-path': 'C%3A%5CKleur%5CKrant%20Ren%C3%A9.icc', 'x-rendering-intent': 'perceptual' },
  });
  assert.equal(out.profileName, 'X');
});

test('het verslag noemt wat omgezet is en wat niet, met de reden', () => {
  const report = emptyReport();
  report.colourOperators.converted = 53;
  report.images.converted = 8;
  report.images.skipped = { jpeg2000: 1 };
  report.shadings.skipped = { shadingType: 576 };
  const text = formatCmykReport(tFor('en'), { report, profileName: 'Proof', sizeBefore: 1000, sizeAfter: 1500 });
  assert.match(text, /Proof/);
  assert.match(text, /53/);
  assert.match(text, /Images: 8 converted, 1 not converted \(JPEG 2000: 1\)/);
  assert.match(text, /576/);
  assert.match(text, /still RGB/);
  assert.doesNotMatch(text, /grew/);
});

test('bij meer dan twee keer zo groot volgt een waarschuwing', () => {
  const report = emptyReport();
  report.images.converted = 24;
  const text = formatCmykReport(tFor('en'), { report, profileName: 'P', sizeBefore: 119e6, sizeAfter: 322e6 });
  assert.match(text, /grew/);
  assert.match(text, /2\.7/);
  assert.doesNotMatch(text, /still RGB/, 'niets overgeslagen: geen melding over RGB');
});

test('niets om te zetten wordt ook gezegd', () => {
  const text = formatCmykReport(tFor('nl'), { report: emptyReport(), profileName: 'P', sizeBefore: 10, sizeAfter: 10 });
  assert.match(text, /RGB/);
});

test('foutmeldingen voor een profiel en voor de omzetting', () => {
  const en = tFor('en');
  assert.match(profileErrorMessage(en, 'notCmyk', 'scherm.icc'), /scherm\.icc.*not CMYK/);
  assert.match(conversionErrorMessage(en, 'profile:notPrinter'), /output/);
  assert.match(conversionErrorMessage(en, 'encrypted'), /encrypted/);
  // Een onbekende code valt terug op de code zelf, nooit op niets.
  assert.match(conversionErrorMessage(en, 'iets-nieuws'), /iets-nieuws/);
});

test('de onthouden keuze wordt gecontroleerd', () => {
  assert.deepEqual(herstelPdfxInstellingen(undefined), PDFX_STANDAARD);
  assert.deepEqual(herstelPdfxInstellingen({ profilePath: 'C:\\p.icc', profileName: 'P', intent: 'perceptual' }), {
    profilePath: 'C:\\p.icc',
    profileName: 'P',
    intent: 'perceptual',
  });
  assert.deepEqual(herstelPdfxInstellingen({ profilePath: 42, intent: 'raar' }), PDFX_STANDAARD);
  assert.equal(PDFX_STANDAARD.profilePath, null, 'standaard: sRGB zonder omzetting');
  assert.equal(PDFX_STANDAARD.intent, 'relative');
});

test('alle nieuwe teksten staan in het Engels en het Nederlands, met dezelfde plaatshouders', () => {
  const placeholders = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort();
  const en = menu('en').pdfxCmyk;
  const nl = menu('nl').pdfxCmyk;
  assert.ok(en && nl);
  const flat = (o, prefix = '') =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[prefix + k, v]] : flat(v, `${prefix}${k}.`)));
  const enFlat = Object.fromEntries(flat(en));
  const nlFlat = Object.fromEntries(flat(nl));
  assert.deepEqual(Object.keys(nlFlat).sort(), Object.keys(enFlat).sort());
  for (const [k, v] of Object.entries(enFlat)) {
    assert.ok(v.trim() && nlFlat[k].trim(), k);
    assert.deepEqual(placeholders(nlFlat[k]), placeholders(v), k);
  }
  for (const kind of REPORT_KINDS) assert.ok(en.kinds[kind], `kind ${kind}`);
  for (const reason of SKIP_REASONS) assert.ok(en.skipReasons[reason], `reden ${reason}`);
});

test('buildPdfx: met sRGB gaat er niets naar Rust en is de uitvoer die van vóór #422', async () => {
  const { buildPdfx } = await import('./pdfx-cmyk.js');
  const { buildPdfxBytes } = await import('./pdfx-enrich.js');
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const input = await doc.save();
  const calls = [];
  const invoke = async (...a) => { calls.push(a); throw new Error('mag niet'); };
  const out = await buildPdfx(input, { conformance: 'X-3', title: 'T', profilePath: null }, { invoke });
  assert.equal(calls.length, 0);
  assert.equal(out.conversion, null);
  const expected = await buildPdfxBytes(input, { conformance: 'X-3', title: 'T' });
  assert.equal(out.pdfBytes.length, expected.length);
});

test('buildPdfx: met een drukprofiel eerst omzetten, dan dat profiel in de output-intent', async () => {
  const { buildPdfx } = await import('./pdfx-cmyk.js');
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const input = await doc.save();
  const report = emptyReport();
  report.colourOperators.converted = 2;
  const phases = [];
  const invoke = async (cmd, body, options) => {
    assert.equal(cmd, 'pdfx_convert_to_cmyk');
    assert.equal(body, input);
    assert.equal(options.headers['x-rendering-intent'], 'perceptual');
    return pack({ report, profileName: 'Proefdruk' }, new Uint8Array([7, 7, 7, 7]), input);
  };
  const out = await buildPdfx(
    input,
    { conformance: 'X-4', title: 'T', profilePath: 'p.icc', intent: 'perceptual' },
    { invoke, onPhase: (p) => phases.push(p) },
  );
  assert.deepEqual(phases, ['converting', 'writing']);
  assert.equal(out.conversion.profileName, 'Proefdruk');
  assert.equal(out.conversion.report.colourOperators.converted, 2);
  const back = await PDFDocument.load(out.pdfBytes);
  const intent = back.catalog.lookup(PDFName.of('OutputIntents')).lookup(0);
  assert.equal(intent.lookup(PDFName.of('DestOutputProfile')).dict.get(PDFName.of('N')).asNumber(), 4);
  assert.equal(intent.get(PDFName.of('OutputConditionIdentifier')).decodeText(), 'Proefdruk');
});

test('een klein bestand dat alleen groeit door het ingesloten profiel krijgt geen waarschuwing', () => {
  const report = emptyReport();
  report.colourOperators.converted = 12;
  const text = formatCmykReport(tFor('en'), { report, profileName: 'P', sizeBefore: 5_000, sizeAfter: 165_000 });
  assert.doesNotMatch(text, /grew/);
});
