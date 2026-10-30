import { state, getActiveDocument } from '../core/state.js';
import { parsePageRange } from '../pdf/exporter.js';
import {
  KOPVOET_VAKKEN, vakPositie, vulKopVoetIn, kopVoetWaarden, toegepastePaginas, kopVoetInWeergave,
} from './kopvoet-tekst.js';
import { watermarkPosition, watermarkTextPlacement, watermarkFont } from './watermark-layout.js';

const imageCache = new Map();

export function shouldRenderOnPage(watermark, pageNum, totalPages) {
  if (!watermark.enabled) return false;
  if (watermark.pageRange === 'all') return true;
  if (watermark.pageRange === 'first') return pageNum === 1;
  if (watermark.pageRange === 'custom' && watermark.customPages) {
    const pages = parsePageRange(watermark.customPages, totalPages);
    return pages.includes(pageNum);
  }
  return true;
}

// Same text, size, centre and baseline as the saved file (watermark-layout.js).
export function renderTextWatermark(ctx, wm, pageWidth, pageHeight) {
  const placed = watermarkTextPlacement(wm, pageWidth, pageHeight);
  ctx.save();
  ctx.globalAlpha = wm.opacity !== undefined ? wm.opacity : 0.3;
  ctx.translate(placed.x, placed.y);
  ctx.rotate((wm.rotation || 0) * Math.PI / 180);
  const family = watermarkFont(wm.fontFamily);
  ctx.font = `${placed.size}px ${family === 'Times-Roman' ? 'Times New Roman' : family}`;
  // The PDF draws a plain Tj without kerning; so does the screen.
  if ('fontKerning' in ctx) ctx.fontKerning = 'none';
  ctx.fillStyle = wm.color || '#ff0000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(placed.text, 0, placed.baseline);
  ctx.restore();
}

export function renderImageWatermark(ctx, wm, pageWidth, pageHeight, decodedImage = null) {
  if (!wm.imageData) return;

  let img = decodedImage || imageCache.get(wm.imageData);
  if (!img) {
    img = new Image();
    img.src = wm.imageData;
    imageCache.set(wm.imageData, img);
  }

  if (!img.complete) return;

  const scale = wm.scale ?? 1;
  const w = (wm.width || 200) * scale;
  const h = (wm.height || 200) * scale;
  const pos = watermarkPosition(wm, pageWidth, pageHeight, w, h);

  ctx.save();
  ctx.globalAlpha = wm.opacity !== undefined ? wm.opacity : 0.2;
  ctx.translate(pos.x, pos.y);
  ctx.rotate((wm.rotation || 0) * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// Dezelfde vakken, variabelen en basislijnen als in het bestand
// (pdf/saver/kopvoet.js), zodat het scherm toont wat er wordt opgeslagen.
export function renderHeaderFooter(ctx, wm, pageNum, totalPages, pageWidth, pageHeight) {
  const doc = getActiveDocument();
  const waarden = kopVoetWaarden(wm, {
    pagina: pageNum,
    paginas: totalPages,
    toegepast: toegepastePaginas(wm, totalPages, parsePageRange),
    bestandsnaam: doc ? doc.fileName : '',
    titel: doc?.pdfTitel || '',
  });
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.font = `${wm.fontSize || 10}px ${wm.fontFamily || 'Helvetica'}`;
  ctx.fillStyle = wm.color || '#000000';
  ctx.textBaseline = 'alphabetic';
  for (const vak of KOPVOET_VAKKEN) {
    const tekst = vulKopVoetIn(wm[vak.sleutel], waarden).replace(/[\r\n]+/g, ' ');
    if (!tekst.trim()) continue;
    const { x, basislijn } = vakPositie(wm, vak, pageWidth, pageHeight);
    ctx.textAlign = vak.uitlijning;
    ctx.fillText(tekst, x, basislijn);
  }
  ctx.restore();
}

function renderWatermarksForLayer(ctx, layer, pageNum, pageWidth, pageHeight) {
  const doc = getActiveDocument();
  const watermarks = doc?.watermarks;
  if (!watermarks || watermarks.length === 0) return;

  const totalPages = doc?.pdfDoc ? doc.pdfDoc.numPages : 1;

  for (const wm of watermarks) {
    if (!wm.enabled) continue;
    if ((wm.layer || 'behind') !== layer && wm.type !== 'headerFooter') continue;
    if (wm.type === 'headerFooter' && layer !== 'infront') continue;
    if (!shouldRenderOnPage(wm, pageNum, totalPages)) continue;
    // Al als pagina-inhoud in het weergegeven bestand: niet dubbel tekenen.
    if (kopVoetInWeergave(doc, wm)) continue;

    switch (wm.type) {
      case 'textWatermark':
        renderTextWatermark(ctx, wm, pageWidth, pageHeight);
        break;
      case 'imageWatermark':
        renderImageWatermark(ctx, wm, pageWidth, pageHeight);
        break;
      case 'headerFooter':
        renderHeaderFooter(ctx, wm, pageNum, totalPages, pageWidth, pageHeight);
        break;
    }
  }
}

export function renderWatermarksBehind(ctx, pageNum, pageWidth, pageHeight) {
  renderWatermarksForLayer(ctx, 'behind', pageNum, pageWidth, pageHeight);
}

export function renderWatermarksInFront(ctx, pageNum, pageWidth, pageHeight) {
  renderWatermarksForLayer(ctx, 'infront', pageNum, pageWidth, pageHeight);
}
