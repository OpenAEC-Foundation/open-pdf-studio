// Dynamic stamps (#629) through the real saver and loader: the appearance
// shows the filled-in text (read back with pdf.js text extraction, as any
// reader sees it), template and values come back so the stamp stays
// editable, an edit after reopening changes the appearance, and a locked
// stamp stays locked (PDF flags + app key).

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { leegBlad, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';
import { laadMetBeelden, pngDataUrl } from './stempel-rondgang.testhulp.mjs';
import {
  BUILTIN_DYNAMIC_TEMPLATES, createDynamicStamp, applyDynamicStampToAnnotation, setDynamicStampValue,
  lockDynamicStamp, normalizeTemplate,
} from '../annotations/dynamic-stamp.js';
import { naturalStampSize } from '../annotations/dynamic-stamp-layout.js';

const NOW = new Date(2026, 9, 28, 9, 5);
const CTX = { now: NOW, locale: 'nl', user: 'Oscar Ö', page: 1, pages: 1, filename: 'plan.pdf', title: 'Bouwplan' };
const APPROVED_BY = BUILTIN_DYNAMIC_TEMPLATES.find((t) => t.id === 'builtin-approved-by');

function stempel(template, given = {}, extra = {}) {
  const ds = createDynamicStamp(template, CTX, given);
  const maat = naturalStampSize(ds.template, ds.values);
  const ann = {
    id: 'dyn-1', type: 'stamp', page: 1, x: 120, y: 200, ...maat, rotation: 0, opacity: 1,
    author: 'Oscar', locked: false, readOnly: false, printable: true, dynamicStamp: ds, ...extra,
  };
  return applyDynamicStampToAnnotation(ann);
}

/**
 * Text of every stamp appearance on page 1 as pdf.js extracts it: each
 * appearance is drawn on an extra page (as flattening would) and read with
 * getTextContent.
 */
async function apTekst(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const annots = doc.getPage(0).node.Annots()?.asArray() || [];
  const teksten = [];
  for (const ref of annots) {
    const dict = ctx.lookup(ref);
    if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Stamp') continue;
    const n = ctx.lookup(dict.get(PDFName.of('AP'))).get(PDFName.of('N'));
    const blad = doc.addPage([600, 400]);
    blad.node.set(PDFName.of('Resources'), ctx.obj({ XObject: ctx.obj({ S0: n }) }));
    blad.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('q 1 0 0 1 20 20 cm /S0 Do Q')));
    teksten.push(doc.getPageCount());
  }
  const plat = await doc.save();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: plat, isEvalSupported: false, verbosity: 0 }).promise;
  const uit = [];
  for (const nr of teksten) {
    const inhoud = await (await pdf.getPage(nr)).getTextContent();
    uit.push(inhoud.items.map((i) => i.str).filter((s) => s.trim()));
  }
  await pdf.loadingTask.destroy();
  return uit;
}

async function stempelDict(bytes) {
  const lijst = await woordenboeken(bytes);
  return lijst.find(({ dict }) => dict.get(PDFName.of('Subtype'))?.toString() === '/Stamp');
}

test('saved: /Stamp with an appearance showing the filled-in text, plus the app keys', async () => {
  const ann = stempel(APPROVED_BY, { 'Approved by': 'J. Smit', 'Project number': 'P-42' });
  const bytes = await opslaan(await leegBlad(), [ann]);
  const { dict } = await stempelDict(bytes);
  assert.equal(dict.get(PDFName.of('IT'))?.toString(), '/Stamp');
  assert.ok(dict.get(PDFName.of('OPS_DynStamp')), 'template + values in an app key');
  const [regels] = await apTekst(bytes);
  assert.deepEqual(regels, ['APPROVED', 'By: J. Smit', 'Project: P-42', 'Date: 28-10-2026']);
});

test('reopened: template and values restored, the stamp is editable again', async () => {
  const ann = stempel(APPROVED_BY, { 'Approved by': 'J. Smit', 'Project number': 'P-42' });
  const bytes = await opslaan(await leegBlad(), [ann]);
  const [terug] = await laad(bytes);
  assert.equal(terug.type, 'stamp');
  assert.ok(terug.dynamicStamp, 'dynamic again');
  assert.deepEqual(terug.dynamicStamp.template.lines, ann.dynamicStamp.template.lines);
  assert.deepEqual(terug.dynamicStamp.values, ann.dynamicStamp.values);
  assert.equal(terug.dynamicStamp.placedAt, ann.dynamicStamp.placedAt);
  assert.equal(terug.stampText, ann.stampText);
  assert.equal(terug.color, ann.dynamicStamp.template.color);
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(terug[k] - ann[k]) < 0.5, `${k}: ${terug[k]} vs ${ann[k]}`);
  assert.equal(terug.locked, false);

  // Correct the date after reopening: the next save shows the new date.
  assert.equal(setDynamicStampValue(terug, 'date', '30-10-2026'), true);
  const opnieuw = await opslaan(bytes, [terug]);
  const [regels] = await apTekst(opnieuw);
  assert.ok(regels.includes('Date: 30-10-2026'), regels.join(' | '));
  assert.ok(!regels.includes('Date: 28-10-2026'));
  const [nogmaals] = await laad(opnieuw);
  assert.equal(nogmaals.dynamicStamp.values.date, '30-10-2026');
});

test('locked: ReadOnly + Locked flags and the app key; still locked after reopening', async () => {
  const ann = stempel(APPROVED_BY, { 'Approved by': 'J. Smit' });
  lockDynamicStamp(ann);
  const bytes = await opslaan(await leegBlad(), [ann]);
  const { dict } = await stempelDict(bytes);
  const f = dict.get(PDFName.of('F'));
  assert.ok(f instanceof PDFNumber);
  assert.equal(f.asNumber() & 64, 64, 'ReadOnly');
  assert.equal(f.asNumber() & 128, 128, 'Locked');
  assert.equal(dict.get(PDFName.of('OPS_StampLocked'))?.toString(), 'true');
  const [terug] = await laad(bytes);
  assert.equal(terug.dynamicStamp.locked, true);
  assert.equal(terug.locked, true);
  assert.equal(terug.readOnly, true);
  assert.equal(setDynamicStampValue(terug, 'Approved by', 'Other'), false, 'no edits after reopening either');
});

test('rotated stamp, template with an image and non-ASCII values: same box and text after reopening', async () => {
  const template = normalizeTemplate({
    name: 'Ontvangen', color: '#1a5fb4', border: 'rounded', borderWidth: 1.5, fillColor: '#fffbe6',
    image: { dataUrl: pngDataUrl(40, 20), width: 40, height: 20 },
    lines: [{ text: 'ONTVANGEN', fontSize: 16, bold: true }, { text: '{user} — {date:d MMMM yyyy}', fontSize: 8 }],
  }).template;
  const ann = stempel(template, {}, { rotation: 30 });
  const bytes = await opslaan(await leegBlad({ rotatie: 90 }), [ann]);
  const [regels] = await apTekst(bytes);
  assert.deepEqual(regels, ['ONTVANGEN', 'Oscar Ö — 28 oktober 2026']);
  const [terug] = await laadMetBeelden(bytes);
  assert.equal(terug.type, 'stamp');
  assert.ok(terug.dynamicStamp, 'the image in the appearance does not turn it into an image stamp');
  assert.equal(terug.imageData, undefined);
  assert.equal(terug.dynamicStamp.template.image.dataUrl, template.image.dataUrl);
  assert.equal(Math.round(terug.rotation), 30);
  for (const k of ['width', 'height']) assert.ok(Math.abs(terug[k] - ann[k]) < 0.5, `${k}: ${terug[k]} vs ${ann[k]}`);
});

test('a file without the app key (other reader rewrote it) loads as a plain text stamp', async () => {
  const ann = stempel(APPROVED_BY, { 'Approved by': 'J. Smit' });
  const bytes = await opslaan(await leegBlad(), [ann]);
  const doc = await PDFDocument.load(bytes);
  const dict = doc.context.lookup(doc.getPage(0).node.Annots().get(0));
  dict.delete(PDFName.of('OPS_DynStamp'));
  const [terug] = await laad(await doc.save());
  assert.equal(terug.type, 'stamp');
  assert.equal(terug.dynamicStamp, undefined);
  assert.equal(terug.stampText, ann.stampText, 'the text from /OPS_StampText');
});

test('a damaged app key is ignored, never a crash', async () => {
  const ann = stempel(APPROVED_BY);
  const bytes = await opslaan(await leegBlad(), [ann]);
  const doc = await PDFDocument.load(bytes);
  const dict = doc.context.lookup(doc.getPage(0).node.Annots().get(0));
  dict.set(PDFName.of('OPS_DynStamp'), doc.context.register(doc.context.flateStream('{"template": {"name": "x", "lines": "nope"}}')));
  const [terug] = await laad(await doc.save());
  assert.equal(terug.type, 'stamp');
  assert.equal(terug.dynamicStamp, undefined);
});
