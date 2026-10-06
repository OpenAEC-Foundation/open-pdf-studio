import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SB_SIZE, scrollbalkGeometrie } from './scrollbalk-geometrie.js';

// De canvas-scrollbalken (CanvasScrollbars.jsx) lazen de viewport vroeger elk
// animatieframe uit, ook met de balken uit en zonder document. Nu werken ze
// alleen bij na een render, bij een wissel van viewport.active en bij het
// omzetten van de voorkeur. De maatvoering is daarvoor uit de component
// gehaald; ze moet exact gelijk blijven aan wat de component altijd deed.

// Letterlijk de berekening uit de oude update() van CanvasScrollbars.jsx,
// met de stijlwaarden die hij schreef ('none' = balk verborgen).
function oudeStijlen(css, pageW, pageH, offsetX, offsetY) {
  const uit = { h: { display: 'none' }, v: { display: 'none' } };
  if (pageW > css.w + 0.5) {
    const overflow = pageW - css.w;
    const scrolled = -offsetX;
    const trackPx = css.w - SB_SIZE;
    const vVisible = pageH > css.h + 0.5;
    const usableTrack = vVisible ? trackPx : css.w;
    const ratio = css.w / pageW;
    const thumbPx = Math.max(20, usableTrack * ratio);
    const maxThumbStart = usableTrack - thumbPx;
    const thumbStart = overflow > 0 ? (scrolled / overflow) * maxThumbStart : 0;
    uit.h = {
      display: '',
      right: (vVisible ? SB_SIZE : 0) + 'px',
      width: thumbPx + 'px',
      transform: `translateX(${Math.max(0, Math.min(maxThumbStart, thumbStart))}px)`,
    };
  }
  if (pageH > css.h + 0.5) {
    const overflow = pageH - css.h;
    const scrolled = -offsetY;
    const hVisible = pageW > css.w + 0.5;
    const trackPx = css.h - (hVisible ? SB_SIZE : 0);
    const ratio = css.h / pageH;
    const thumbPx = Math.max(20, trackPx * ratio);
    const maxThumbStart = trackPx - thumbPx;
    const thumbStart = overflow > 0 ? (scrolled / overflow) * maxThumbStart : 0;
    uit.v = {
      display: '',
      bottom: (hVisible ? SB_SIZE : 0) + 'px',
      height: thumbPx + 'px',
      transform: `translateY(${Math.max(0, Math.min(maxThumbStart, thumbStart))}px)`,
    };
  }
  return uit;
}

// Dezelfde stijlwaarden uit de nieuwe geometrie, zoals de component ze schrijft.
function nieuweStijlen(css, pageW, pageH, offsetX, offsetY) {
  const g = scrollbalkGeometrie({ canvasW: css.w, canvasH: css.h, paginaW: pageW, paginaH: pageH, offsetX, offsetY });
  return {
    h: g.h ? {
      display: '',
      right: g.h.right + 'px',
      width: g.h.thumbPx + 'px',
      transform: `translateX(${g.h.thumbStart}px)`,
    } : { display: 'none' },
    v: g.v ? {
      display: '',
      bottom: g.v.bottom + 'px',
      height: g.v.thumbPx + 'px',
      transform: `translateY(${g.v.thumbStart}px)`,
    } : { display: 'none' },
  };
}

test('de balkbreedte is de Windows-standaard', () => {
  assert.equal(SB_SIZE, 14);
});

test('geometrie is exact gelijk aan de oude berekening (raster van gevallen)', () => {
  const canvassen = [{ w: 800, h: 600 }, { w: 1000.5, h: 700.25 }, { w: 30, h: 25 }, { w: 1920, h: 1080 }];
  const factoren = [0.5, 1, 1 + 0.4 / 800, 1 + 0.6 / 600, 1.01, 2, 7.3, 40];
  const offsets = [0.25, 0, -1, -0.5, -0.999, -1.0001, -2];
  let gevallen = 0;
  for (const css of canvassen) {
    for (const fw of factoren) {
      for (const fh of factoren) {
        const pageW = css.w * fw;
        const pageH = css.h * fh;
        for (const ox of offsets) {
          for (const oy of offsets) {
            // Verschuiving als fractie van de overloop (ook buiten het bereik).
            const offsetX = ox * Math.max(0, pageW - css.w);
            const offsetY = oy * Math.max(0, pageH - css.h);
            assert.deepEqual(
              nieuweStijlen(css, pageW, pageH, offsetX, offsetY),
              oudeStijlen(css, pageW, pageH, offsetX, offsetY),
              JSON.stringify({ css, pageW, pageH, offsetX, offsetY }),
            );
            gevallen++;
          }
        }
      }
    }
  }
  assert.ok(gevallen > 1000);
});

test('pagina past: geen balken; alleen te breed: horizontale balk tot de rechterrand', () => {
  assert.deepEqual(
    scrollbalkGeometrie({ canvasW: 800, canvasH: 600, paginaW: 800.5, paginaH: 600, offsetX: 0, offsetY: 0 }),
    { h: null, v: null },
  );
  const g = scrollbalkGeometrie({ canvasW: 800, canvasH: 600, paginaW: 1600, paginaH: 500, offsetX: -800, offsetY: 0 });
  assert.equal(g.v, null);
  assert.equal(g.h.right, 0);
  assert.equal(g.h.thumbPx, 400);
  assert.equal(g.h.thumbStart, 400, 'helemaal rechts');
});

test('beide assen te groot: elke balk laat de hoek vrij voor de andere', () => {
  const g = scrollbalkGeometrie({ canvasW: 800, canvasH: 600, paginaW: 1600, paginaH: 1200, offsetX: 0, offsetY: -600 });
  assert.equal(g.h.right, SB_SIZE);
  assert.equal(g.v.bottom, SB_SIZE);
  assert.equal(g.h.thumbStart, 0);
  assert.equal(g.v.thumbPx, (600 - SB_SIZE) / 2);
  assert.equal(g.v.thumbStart, (600 - SB_SIZE) / 2, 'helemaal onder');
});

// ─── De component pollt niet meer ───────────────────────────────────────────

test('CanvasScrollbars vraagt geen animatieframes en volgt de viewport', () => {
  const bron = readFileSync(new URL('../solid/components/CanvasScrollbars.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(bron, /requestAnimationFrame/, 'geen frame-lus');
  assert.match(bron, /volgViewport\(/, 'bijwerken na een render en bij een wissel van active');
  assert.match(bron, /scrollbalkGeometrie\(/, 'dezelfde maatvoering als hier getest');
  assert.match(bron, /createEffect\(on\(enabled,/, 'bijwerken als de voorkeur omgaat');
});
