// Snelle rasterexport (#701): de paginabeelden komen uit de PDFium-workerpool
// (aparte processen, meerdere pagina's tegelijk) in plaats van uit PDF.js op
// de hoofdthread, en de JPEG-codering gebeurt in een Web Worker. De
// markeringslaag blijft uit dezelfde JS-tekening komen als altijd
// (renderMarkeringenOffscreen in exporter.js); de samenstelling en de
// volgorde staan in exporter.js (exportAsRasterPdf).

import { heeftRustRenderer, invoke } from '../core/platform.js';
import { pageContentBytes, isHeavyBytes } from './progressive-render.js';
import { tegelRaster, draaiMatrix, spreidOverWorkers, tegelsVoorDeel } from './raster-export-plan.js';

/**
 * Kan deze export de PDFium-workers gebruiken? Alleen in de desktop-app, met
 * het document op schijf (de workers lezen het bestand; na paginabewerkingen
 * is dat een tijdelijke kopie, zie page-manager.js) en een opgestarte pool.
 * Anders blijft het oude PDF.js-pad.
 */
export async function pdfiumRasterBeschikbaar(doc) {
  if (!doc?.filePath || !heeftRustRenderer()) return false;
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return false;
  try {
    return (await invoke('worker_pool_ready')) === true;
  } catch {
    return false;
  }
}

/**
 * Welke motor rendert deze pagina? Een zware pagina (een content-stream van
 * meer dan 1 MB, dezelfde grens als de weergave) via de PDFium-workers: daar
 * is PDF.js op de hoofdthread het traagst en de workers het snelst. Een
 * lichte pagina via PDF.js: het beeld ontstaat dan in de WebView zelf,
 * terwijl een PDFium-beeld als ruwe pixels over de IPC moet (~0,3 s voor
 * een A4 op 300 dpi) en dat bij lichte pagina's langer duurt dan het
 * renderen zelf.
 * @returns {Promise<'pdfium'|'pdfjs'>}
 */
export async function kiesRasterMotor(doc, pageNum, poolKlaar) {
  if (!poolKlaar) return 'pdfjs';
  return isHeavyBytes(await pageContentBytes(doc.filePath, pageNum)) ? 'pdfium' : 'pdfjs';
}

// Eén tegel uit de pool: [w u32 LE][h u32 LE][rgba]. Fouten gaan door naar
// de aanroeper, die de pagina dan via PDF.js rendert.
async function renderTegel(args) {
  const res = await invoke('render_pdf_page_region', args);
  const bytes = res instanceof Uint8Array ? res : new Uint8Array(res);
  if (!bytes || bytes.length <= 8) throw new Error('render_pdf_page_region: empty response');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const w = dv.getUint32(0, true);
  const h = dv.getUint32(4, true);
  if (!w || !h || w * h * 4 !== bytes.length - 8) {
    throw new Error(`render_pdf_page_region: bad bitmap ${w}x${h} (${bytes.length} bytes)`);
  }
  const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, w * h * 4);
  return createImageBitmap(new ImageData(rgba, w, h));
}

/**
 * De pagina zonder markeringslaag op een OffscreenCanvas van breedte×hoogte
 * pixels: dezelfde maat als het PDF.js-canvas van de oude export (de
 * viewport op `scale` met de paginarotatie plus de extra rotatie). De
 * tegels komen ongedraaid uit de workers (die kennen alleen de eigen
 * /Rotate van de pagina) en worden hier op hun plek gedraaid.
 * Met `signal` stopt hij na een afgebroken export bij de volgende tegel.
 * Met `deel` (pixels van de gedraaide pagina: {x, y, breedte, hoogte}) komt
 * alleen dat deel op een canvas van die maat, en worden alleen de tegels
 * opgehaald die het raken (afdrukken, zie print-plaatsing.js). `doel` is een
 * eigen canvas om op te tekenen (een HTMLCanvasElement voor code die er een
 * verwacht); het krijgt de juiste maat.
 * @param {{ doc: object, pageNum: number, scale: number, extraRot: number,
 *           breedte: number, hoogte: number, signal?: AbortSignal,
 *           deel?: {x:number, y:number, breedte:number, hoogte:number}|null,
 *           doel?: HTMLCanvasElement|OffscreenCanvas|null }} o
 * @returns {Promise<OffscreenCanvas|HTMLCanvasElement>}
 */
export async function renderPaginaPdfium({ doc, pageNum, scale, extraRot, breedte, hoogte, signal = null, deel = null, doel = null }) {
  const rot = ((Math.round(Number(extraRot) || 0) % 360) + 360) % 360;
  const gedraaid = rot === 90 || rot === 270;
  // Maat zonder extra rotatie (zelfde afronding als de uitvoermaat).
  const w0 = gedraaid ? hoogte : breedte;
  const h0 = gedraaid ? breedte : hoogte;
  const uitB = deel ? deel.breedte : breedte;
  const uitH = deel ? deel.hoogte : hoogte;
  const canvas = doel || new OffscreenCanvas(uitB, uitH);
  if (doel) { doel.width = uitB; doel.height = uitH; }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, uitB, uitH);
  const spread = spreidOverWorkers(await pageContentBytes(doc.filePath, pageNum));
  const draai = draaiMatrix(rot, w0, h0);
  const tegels = tegelsVoorDeel(tegelRaster(w0, h0), draai, deel);
  // Een deel begint op pixel (0, 0) van het canvas: de pagina schuift op.
  const [a, b, c, d] = draai;
  const e = draai[4] - (deel ? deel.x : 0);
  const f = draai[5] - (deel ? deel.y : 0);
  // Niet alle tegels tegelijk aanvragen: elke tegel komt als tot 64 MB ruwe
  // pixels binnen. Over de pool verspreid vier tegelijk; vastgepind op één
  // worker (zware inhoud) twee, zodat het overzetten van de ene tegel
  // overlapt met het renderen van de volgende.
  const rij = tegels.slice();
  const gelijktijdig = Math.min(rij.length, spread ? 4 : 2);
  await Promise.all(Array.from({ length: gelijktijdig }, async () => {
    for (let t = rij.shift(); t; t = rij.shift()) {
      signal?.throwIfAborted();
      await tekenTegel(t);
    }
  }));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;

  async function tekenTegel(t) {
    const bmp = await renderTegel({
      path: doc.filePath,
      pageIndex: pageNum - 1,
      scale,
      rotation: 0,
      regionXPt: t.px / scale,
      regionYPt: t.py / scale,
      regionWPt: t.pw / scale,
      regionHPt: t.ph / scale,
      spread,
      // Uitvoer: altijd de echte lijndiktes, nooit de dunne-lijnenweergave.
      thinLines: false,
    });
    try {
      ctx.setTransform(a, b, c, d, e, f);
      // De worker rondt de tegelmaat naar boven af: precies pw×ph overnemen.
      ctx.drawImage(bmp, 0, 0, t.pw, t.ph, t.px, t.py, t.pw, t.ph);
    } finally {
      bmp.close();
    }
  }
}

/**
 * JPEG-codering buiten de hoofdthread: een paar module-workers die elk een
 * beeld krijgen. Zonder Worker (of als hij faalt) codeert de hoofdthread,
 * zoals vroeger.
 * @param {{ aantal?: number }} [o]
 */
export function maakJpegEncoder({ aantal = 2 } = {}) {
  const workers = [];
  const wacht = new Map();
  let volgendeId = 1;
  let beurt = 0;
  let kapot = typeof Worker === 'undefined';

  const maakWorker = () => {
    const w = new Worker(new URL('./raster-jpeg.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, buf, fout } = e.data || {};
      const p = wacht.get(id);
      if (!p) return;
      wacht.delete(id);
      if (fout) p.reject(new Error(fout));
      else p.resolve(new Uint8Array(buf));
    };
    w.onerror = (e) => {
      kapot = true;
      for (const [id, p] of wacht) { wacht.delete(id); p.reject(new Error(e?.message || 'jpeg worker failed')); }
    };
    return w;
  };

  const opHoofdthread = async (beeld, quality) => {
    let canvas = beeld;
    if (typeof ImageBitmap !== 'undefined' && beeld instanceof ImageBitmap) {
      canvas = new OffscreenCanvas(beeld.width, beeld.height);
      canvas.getContext('2d').drawImage(beeld, 0, 0);
      beeld.close();
    }
    if (typeof canvas.convertToBlob === 'function') {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      return new Uint8Array(await blob.arrayBuffer());
    }
    const blob = await new Promise((ok, nee) => canvas.toBlob(
      (b) => (b ? ok(b) : nee(new Error('Failed to convert canvas to blob'))), 'image/jpeg', quality));
    return new Uint8Array(await blob.arrayBuffer());
  };

  return {
    /**
     * @param {OffscreenCanvas|HTMLCanvasElement} canvas  wordt niet meer gebruikt na deze aanroep
     * @param {number} quality
     * @returns {Promise<Uint8Array>}
     */
    async encodeer(canvas, quality) {
      if (kapot) return opHoofdthread(canvas, quality);
      let bitmap;
      try {
        if (!workers.length) for (let i = 0; i < aantal; i++) workers.push(maakWorker());
        // Een OffscreenCanvas geeft zijn beeld zonder kopie af.
        if (typeof canvas.transferToImageBitmap === 'function') {
          bitmap = canvas.transferToImageBitmap();
        } else {
          bitmap = await createImageBitmap(canvas);
          // Het canvas zelf is niet meer nodig: geheugen meteen vrij.
          canvas.width = 0;
          canvas.height = 0;
        }
      } catch {
        kapot = true;
        return opHoofdthread(canvas, quality);
      }
      const id = volgendeId++;
      const worker = workers[beurt++ % workers.length];
      // Faalt de worker zelf (laden, geheugen), dan is dit beeld weg: de
      // aanroeper rendert de pagina opnieuw via het oude pad.
      return new Promise((resolve, reject) => {
        wacht.set(id, { resolve, reject });
        worker.postMessage({ id, bitmap, quality }, [bitmap]);
      });
    },
    get viaWorker() { return !kapot; },
    sluit() {
      for (const w of workers) { try { w.terminate(); } catch { /* al weg */ } }
      workers.length = 0;
      for (const [id, p] of wacht) { wacht.delete(id); p.reject(new Error('jpeg encoder closed')); }
    },
  };
}
