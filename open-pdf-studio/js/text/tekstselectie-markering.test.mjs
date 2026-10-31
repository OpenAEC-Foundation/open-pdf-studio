// Tekstselectie-markering (#506, deel 2): de markering was ongelijkmatig
// blauw, met donkere verticale banden op woordgrenzen en blokken die buiten
// de tekst uitstaken.
//
// Oorzaak 1 (geometrie): na het sluiten van het laatste tabblad past de
// viewport de zoom in op een verborgen 0×0-container (zoom = 1/paginahoogte).
// De tekstlaag van het daarna geopende document werd met die schaal gebouwd;
// PDF.js meet elke tekstrun op fontgrootte × schaal × DPR ≈ 0,02 px, waar
// Chromium ongeveer de halve breedte teruggeeft. --scale-x werd ≈ 2, elke span
// twee keer te breed, en in enkele-paginaweergave wordt de laag bij zoomen
// niet herbouwd. Gedrag (in node te testen): de meetviewport voor PDF.js.
//
// Oorzaak 2 (kleur): elke span tekent zijn eigen selectievlak. Een
// doorschijnende kleur telt op waar spans overlappen; de dekkende pastel die
// dat verving, verborg de PDF-glyphs en tekende ze opnieuw in een
// vervangend lettertype. Compositing kan node niet uitvoeren: bronwachters.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

import { MIN_MEETSCHAAL, meetViewportVoorTekstlaag } from './tekstlaag-meetschaal.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

async function pdfJsPagina(breedte = 595.28, hoogte = 841.89, rotatie = 0) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([breedte, hoogte]);
  if (rotatie) p.setRotation({ type: 'degrees', angle: rotatie });
  const bytes = await doc.save();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false }).promise;
  return pdf.getPage(1);
}

test('a degenerate layer scale is measured at scale 1, with the same page frame', async () => {
  const pagina = await pdfJsPagina();
  // De zoom die computeFitZoom geeft voor een 0×0-canvas: 1 px / paginahoogte.
  const ontaard = pagina.getViewport({ scale: 1 / 841.89 });
  const meet = meetViewportVoorTekstlaag(ontaard);
  assert.notEqual(meet, ontaard, 'een nieuwe viewport, de oude blijft ongemoeid');
  assert.equal(meet.scale, MIN_MEETSCHAAL);
  assert.equal(ontaard.scale, 1 / 841.89);
  assert.deepEqual(meet.rawDims, ontaard.rawDims, 'zelfde paginakader (bepaalt left/top van de spans)');
  assert.equal(meet.rotation, ontaard.rotation);
  // Zelfs een 1-pt-letter wordt dan op ruim 0,05 px gemeten (de grens waaronder
  // Chromium's measureText niet meer lineair is), ook bij DPR 1.
  assert.ok(1 * meet.scale * 1 >= 0.05);
});

test('the page rotation survives the measurement viewport', async () => {
  const pagina = await pdfJsPagina(595.28, 841.89, 90);
  const ontaard = pagina.getViewport({ scale: 0.001 });
  const meet = meetViewportVoorTekstlaag(ontaard);
  assert.equal(meet.rotation, 90);
  assert.deepEqual(meet.rawDims, ontaard.rawDims);
});

test('a normal scale keeps the viewport as it is', async () => {
  const pagina = await pdfJsPagina();
  for (const scale of [1, 1.5, 3]) {
    const vp = pagina.getViewport({ scale });
    assert.equal(meetViewportVoorTekstlaag(vp), vp);
  }
});

test('zoomed out below 1 is measured at 1 too (measurement is linear, layout runs via CSS variables)', async () => {
  const pagina = await pdfJsPagina();
  const vp = pagina.getViewport({ scale: 0.25 });
  assert.equal(meetViewportVoorTekstlaag(vp).scale, 1);
});

test('a viewport without clone() is passed through', () => {
  const kaal = { scale: 0.001 };
  assert.equal(meetViewportVoorTekstlaag(kaal), kaal);
  assert.equal(meetViewportVoorTekstlaag(null), null);
});

test('createTextLayer gives PDF.js the measurement viewport, the layer keeps its real scale', () => {
  const tl = bron('./text-layer.js');
  assert.match(tl, /import \{ meetViewportVoorTekstlaag \} from '\.\/tekstlaag-meetschaal\.js';/);
  const blok = tl.slice(tl.indexOf('export async function createTextLayer('), tl.indexOf('export function injectSyntheticTextSpans('));
  assert.match(blok, /new pdfjsLib\.TextLayer\(\{\s*textContentSource: textContent,\s*container: textLayerDiv,\s*viewport: meetViewportVoorTekstlaag\(viewport\),?\s*\}\)/);
  assert.match(blok, /container\.style\.setProperty\('--total-scale-factor', viewport\.scale\)/, 'de echte schaal blijft de laagmaat bepalen');
});

// ── Kleur: één selectievlak voor de hele laag ─────────────────────────────

function regelBlok(css, selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `regel ${selector} ontbreekt`);
  return css.slice(i, css.indexOf('}', i));
}

test('the text layer multiplies with the page as one group', () => {
  const css = bron('../../styles/text-layer.css');
  const laag = regelBlok(css, '.textLayer');
  assert.match(laag, /mix-blend-mode:\s*multiply;/);
  assert.match(laag, /opacity:\s*1;/);
});

test('the selection is opaque and leaves the glyphs to the PDF canvas', () => {
  const css = bron('../../styles/text-layer.css');
  const sel = regelBlok(css, '.textLayer ::selection');
  const kleur = sel.match(/background:\s*([^;]+);/)?.[1].trim();
  assert.ok(kleur, 'selectiekleur ontbreekt');
  // Dekkend: alleen #rgb/#rrggbb; rgba(), transparantie of color-mix zouden
  // in overlappende spans weer optellen.
  assert.match(kleur, /^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  assert.match(sel, /color:\s*transparent;/, 'geen vervangende glyphs in de selectie');
  // Lege spans en regeleindes blijven zonder vlak.
  assert.match(css, /\.textLayer span\[data-ws\]::selection \{\s*background: transparent !important;/);
  assert.match(css, /\.textLayer br::selection \{\s*background: transparent !important;/);
});

test('no other stylesheet rule colours the selection differently', () => {
  const vp = bron('../pdf/pdf-viewport.js');
  assert.doesNotMatch(vp, /::selection/, 'pdf-viewport.js zet geen eigen selectiekleur meer');
  const css = bron('../../styles/text-layer.css');
  const regels = css.match(/::selection\s*\{[^}]*\}/g) || [];
  for (const r of regels) {
    assert.doesNotMatch(r, /rgba\(|hsla\(|color-mix|opacity/, `doorschijnende selectieregel: ${r}`);
    if (/color:/.test(r.replace(/background[^;]*;/g, ''))) assert.match(r, /color:\s*transparent/, `zichtbare glyphkleur: ${r}`);
  }
});

test('the blend stays inside the page in single page view', () => {
  const css = bron('../../styles/layout.css');
  const blok = regelBlok(css, '#canvas-container');
  assert.match(blok, /isolation:\s*isolate;/);
});

// ── Hoogte: het selectievlak blijft binnen de regel ──────────────────────

test('the selection does not stick out above or below the line', () => {
  const css = bron('../../styles/text-layer.css');
  // De span is één regel hoog (line-height 1); de browser tekent de selectie
  // over het hogere inhoudsvlak van het lettertype. Alleen verticaal clippen:
  // horizontaal moet het regeleinde-vlak naast de span blijven staan.
  assert.match(regelBlok(css, '.textLayer'), /line-height:\s*1;/);
  const span = regelBlok(css, '.textLayer > :not(.markedContent),\n.textLayer .markedContent span:not(.markedContent)');
  assert.match(span, /overflow-y:\s*clip;/);
  assert.match(span, /overflow-x:\s*visible;/);
  assert.doesNotMatch(span, /overflow:\s*(hidden|clip)/, 'no horizontal clip');
});
