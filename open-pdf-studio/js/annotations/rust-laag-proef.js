// Trial of annotation drawing in Rust: the Rust layer of a page next to the JS
// drawing of the same page, with the time of both and the pixel difference.
//
// Not part of the app's own drawing. From the developer console (desktop):
//   await window.__opdsAnnotRustProef({ pageNum: 1, scale: 2 })
// See rust-laag.js and docs/rust-stappen.md.

import { getActiveDocument } from '../core/state.js';
import { invoke } from '../core/platform.js';
import { schermSchaal } from '../pdf/split-view/paneel-weergave.js';
import { renderAnnotationsForPage } from './rendering.js';
import { isGladdeInkt } from './pressure-ink.js';
import { kaleLijst } from './kale-lijst.js';
import { verdeelVoorRust, tekenRustLaag } from './rust-laag.js';

const mediaan = (lijst) => [...lijst].sort((a, b) => a - b)[Math.floor(lijst.length / 2)];

/**
 * Both layers over white, compared per pixel on the largest channel difference.
 * @returns {{ pixels:number, boven8:number, boven32:number, max:number }}
 */
export function verschil(a, b) {
  let boven8 = 0, boven32 = 0, max = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 4) {
    const aa = a[i + 3] / 255, ba = b[i + 3] / 255;
    let d = 0;
    for (let k = 0; k < 3; k++) {
      const va = a[i + k] * aa + 255 * (1 - aa);
      const vb = b[i + k] * ba + 255 * (1 - ba);
      const dk = Math.abs(va - vb);
      if (dk > d) d = dk;
    }
    if (d > 8) boven8++;
    if (d > 32) boven32++;
    if (d > max) max = d;
  }
  return { pixels: n / 4, boven8, boven32, max: Math.round(max) };
}

/**
 * @param {{ pageNum?: number, scale?: number, herhaal?: number, beeld?: boolean }} [opties]
 *   `beeld`: also return both layers as PNG data URLs.
 */
export async function vergelijkRustLaag({ pageNum, scale = 2, herhaal = 5, beeld = false } = {}) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) throw new Error('No PDF document is open');
  const pagina = pageNum || doc.currentPage || 1;
  const vp = (await doc.pdfDoc.getPage(pagina)).getViewport({ scale: 1 });
  const width = Math.max(1, Math.round(vp.width * scale));
  const height = Math.max(1, Math.round(vp.height * scale));
  const { shapes, rest } = verdeelVoorRust(kaleLijst(doc.annotations), pagina, { isGladdeInkt });

  // JS: the page's annotations as output (real line widths, no editing state).
  const jsCanvas = document.createElement('canvas');
  jsCanvas.width = width;
  jsCanvas.height = height;
  const jsCtx = jsCanvas.getContext('2d', { willReadFrequently: true });
  const dpr = scale / (schermSchaal(doc) || 1);
  const jsTijden = [];
  for (let i = 0; i < herhaal; i++) {
    const t0 = performance.now();
    renderAnnotationsForPage(jsCtx, pagina, width, height, dpr, null, null, { uitvoer: true, watermerken: false });
    // Reading a pixel makes the canvas finish what was queued.
    jsCtx.getImageData(0, 0, 1, 1);
    jsTijden.push(performance.now() - t0);
  }

  // Rust: request, render, answer, and the pixels onto a canvas.
  const rustCanvas = document.createElement('canvas');
  rustCanvas.width = width;
  rustCanvas.height = height;
  const rustCtx = rustCanvas.getContext('2d', { willReadFrequently: true });
  const rustTijden = [];
  let laag = null;
  for (let i = 0; i < herhaal; i++) {
    const t0 = performance.now();
    laag = await tekenRustLaag(invoke, { width, height, scale }, shapes);
    rustCtx.putImageData(new ImageData(laag.rgba, width, height), 0, 0);
    rustTijden.push(performance.now() - t0);
  }

  const uit = {
    pagina, width, height, scale,
    vormen: shapes.length, getekend: laag.drawn, bijJs: rest.length,
    soortenBijJs: [...new Set(rest.map((a) => a.type))],
    jsMs: Math.round(mediaan(jsTijden) * 10) / 10,
    rustMs: Math.round(mediaan(rustTijden) * 10) / 10,
    verschil: verschil(jsCtx.getImageData(0, 0, width, height).data, laag.rgba),
  };
  if (beeld) {
    uit.js = jsCanvas.toDataURL('image/png');
    uit.rust = rustCanvas.toDataURL('image/png');
  }
  return uit;
}
