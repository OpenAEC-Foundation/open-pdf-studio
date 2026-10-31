// Woordafstanden in de selectiemarkering (#506): een spatie-run tussen twee
// woord-runs op dezelfde regel krijgt zijn selectievlak terug; kantlijnen,
// inspringingen, regeleindes en kolomgaten niet (spook-selectie).
// Geometrie op een gegenereerde brief via PDF.js' getTextContent, dezelfde
// items waaruit de tekstlaag zijn spans bouwt. De pixels zelf (geen gaten,
// geen donkere banden, niets boven of onder de regel) controleert
// scripts/test-tekstselectie-browser.mjs in Chromium.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { isWoordafstand } from './tekstselectie-woordafstand.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Een brief met elk woord als eigen run (regulier en vet door elkaar), plus
// wat spook-selectie gaf: een losse spatie-run in de kantlijn, spaties ver na
// het regeleinde, een label met een waarde op afstand en twee kolommen.
// PDF.js laat losse spatie-runs weg en zet voor een sprong op de regel een
// spatie-item zo breed als de sprong.
async function briefItems() {
  const doc = await PDFDocument.create();
  const p = doc.addPage([595, 842]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const vet = await doc.embedFont(StandardFonts.HelveticaBold);
  const woorden = (tekst, x, y, size = 11) => {
    tekst.split(' ').forEach((w, i, alle) => {
      const font = i % 2 ? vet : helv;
      const run = i < alle.length - 1 ? `${w} ` : w;
      p.drawText(run, { x, y, size, font });
      x += font.widthOfTextAtSize(run, size);
    });
  };
  woorden('Dear Sir or Madam, thank you', 72, 700);
  p.drawText('   ', { x: 20, y: 680, size: 11, font: helv });
  p.drawText('End', { x: 72, y: 660, size: 11, font: helv });
  p.drawText('  ', { x: 200, y: 660, size: 11, font: helv });
  p.drawText('Name', { x: 72, y: 620, size: 11, font: helv });
  p.drawText('Value', { x: 130, y: 620, size: 11, font: helv });
  p.drawText('Left column', { x: 72, y: 640, size: 11, font: helv });
  p.drawText('Right column', { x: 360, y: 640, size: 11, font: helv });
  const bytes = await doc.save();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const inhoud = await (await pdf.getPage(1)).getTextContent();
  return inhoud.items.filter((it) => it.str !== undefined && it.str !== '');
}

// De spatie-items met hun buren, in de volgorde van de tekstlaag.
function spaties(items) {
  const uit = [];
  items.forEach((it, i) => {
    if (it.str.trim() === '') uit.push({ vorige: items[i - 1], spatie: it, volgende: items[i + 1] });
  });
  return uit;
}

test('a space run between two word runs on one line is a word space', async () => {
  const items = await briefItems();
  const regel = items.filter((it) => Math.abs(it.transform[5] - 700) < 1);
  const tussen = spaties(regel).filter((s) => s.vorige && s.volgende);
  assert.ok(tussen.length >= 4, `expected the word spaces as separate items, got ${tussen.length}`);
  for (const { vorige, spatie, volgende } of tussen) {
    assert.equal(isWoordafstand(vorige, spatie, volgende), true, `"${vorige.str}" · "${volgende.str}"`);
    // De spatie vult de afstand tussen de woorden: aansluitend aan beide kanten.
    assert.ok(Math.abs(vorige.transform[4] + vorige.width - spatie.transform[4]) < 0.5);
    assert.ok(Math.abs(spatie.transform[4] + spatie.width - volgende.transform[4]) < 0.5);
  }
});

test('margins, line ends, label gaps and column gaps stay without a highlight', async () => {
  const items = await briefItems();
  const elders = spaties(items).filter((s) => Math.abs(s.spatie.transform[5] - 700) >= 1);
  // De sprong naar de waarde en het kolomgat.
  assert.ok(elders.length >= 2, `the test PDF should produce whitespace items outside the letter line, got ${elders.length}`);
  for (const { vorige, spatie, volgende } of elders) {
    assert.equal(isWoordafstand(vorige, spatie, volgende), false,
      `whitespace ${JSON.stringify(spatie.str)} at x=${spatie.transform[4].toFixed(1)}, y=${spatie.transform[5]}`);
  }
});

test('word space rules on synthetic items', () => {
  const item = (str, x, w, { y = 700, h = 11, rot = false } = {}) => ({
    str, width: w, transform: rot ? [0, h, -h, 0, x, y] : [h, 0, 0, h, x, y],
  });
  const a = item('Dear', 72, 25);
  const s = item(' ', 97, 3);
  const b = item('Sir', 100, 15);
  assert.equal(isWoordafstand(a, s, b), true);
  // Rechts-naar-links in de inhoud: de woorden aan de andere kant.
  assert.equal(isWoordafstand(b, s, a), true);
  // Zonder buur of met een lege buur: nee.
  assert.equal(isWoordafstand(null, s, b), false);
  assert.equal(isWoordafstand(item(' ', 60, 12), s, b), false);
  // Nulbreedte- en opmaaktekens tekenen niets.
  assert.equal(isWoordafstand(a, item('\u200b', 97, 3), b), false);
  // Een kolomgat: te breed.
  assert.equal(isWoordafstand(a, item('      ', 97, 40), item('Col', 137, 15)), false);
  // Een sprong tussen spatie en woord.
  assert.equal(isWoordafstand(a, s, item('Sir', 120, 15)), false);
  // Een andere regel.
  assert.equal(isWoordafstand(a, s, item('Sir', 100, 15, { y: 686 })), false);
  // Gedraaide tekst houdt het oude gedrag.
  assert.equal(isWoordafstand(item('Dear', 72, 25, { rot: true }), item(' ', 97, 3, { rot: true }), item('Sir', 100, 15, { rot: true })), false);
});

test('createTextLayer marks word spaces right after tagging whitespace', () => {
  const tl = bron('./text-layer.js');
  assert.match(tl, /import \{ markeerWoordafstanden \} from '\.\/tekstselectie-woordafstand\.js';/);
  const blok = tl.slice(tl.indexOf('export async function createTextLayer('), tl.indexOf('export function injectSyntheticTextSpans('));
  assert.match(blok, /tagWhitespaceSpans\(textLayerDiv\);\s*(\/\/[^\n]*\n\s*)*markeerWoordafstanden\(textLayerDiv\);/);
});

test('markeerWoordafstanden gives the span its highlight back and stretches it to the PDF width', () => {
  const m = bron('./tekstselectie-woordafstand.js');
  const f = m.slice(m.indexOf('export function markeerWoordafstanden'));
  assert.match(f, /delete span\.dataset\.ws;/);
  assert.match(f, /span\.style\.setProperty\('--scale-x', String\(\(spatie\.width \* fontPx\) \/ \(h \* breedte\)\)\)/);
});
