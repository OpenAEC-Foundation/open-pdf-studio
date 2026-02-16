import { state, getActiveDocument } from '../core/state.js';
import { parsePageRange } from '../pdf/exporter.js';

const imageCache = new Map();

function shouldRenderOnPage(watermark, pageNum, totalPages) {
  if (!watermark.enabled) return false;
  if (watermark.pageRange === 'all') return true;
  if (watermark.pageRange === 'first') return pageNum === 1;
  if (watermark.pageRange === 'custom' && watermark.customPages) {
    const pages = parsePageRange(watermark.customPages, totalPages);
    return pages.includes(pageNum);
  }
  return true;
}

function getPosition(position, customX, customY, pageWidth, pageHeight, objWidth, objHeight) {
  switch (position) {
    case 'center':
      return { x: pageWidth / 2, y: pageHeight / 2 };
    case 'top-left':
      return { x: objWidth / 2 + 40, y: objHeight / 2 + 40 };
    case 'top-right':
      return { x: pageWidth - objWidth / 2 - 40, y: objHeight / 2 + 40 };
    case 'bottom-left':
      return { x: objWidth / 2 + 40, y: pageHeight - objHeight / 2 - 40 };
    case 'bottom-right':
      return { x: pageWidth - objWidth / 2 - 40, y: pageHeight - objHeight / 2 - 40 };
    case 'custom':
      return { x: customX || pageWidth / 2, y: customY || pageHeight / 2 };
    default:
      return { x: pageWidth / 2, y: pageHeight / 2 };
  }
}

function substituteVariables(text, pageNum, totalPages) {
  if (!text) return '';
  const doc = getActiveDocument();
  const filename = doc ? doc.fileName : '';
  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const timeStr = now.toLocaleTimeString();
  return text
    .replace(/\{page\}/g, String(pageNum))
    .replace(/\{pages\}/g, String(totalPages))
    .replace(/\{date\}/g, dateStr)
    .replace(/\{time\}/g, timeStr)
    .replace(/\{filename\}/g, filename);
}

function renderTextWatermark(ctx, wm, pageWidth, pageHeight) {
  const pos = getPosition(wm.position, wm.customX, wm.customY, pageWidth, pageHeight, 0, 0);
  ctx.save();
  ctx.globalAlpha = wm.opacity !== undefined ? wm.opacity : 0.3;
  ctx.translate(pos.x, pos.y);
  ctx.rotate((wm.rotation || 0) * Math.PI / 180);
  ctx.font = `${wm.fontSize || 72}px ${wm.fontFamily || 'Helvetica'}`;
  ctx.fillStyle = wm.color || '#ff0000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(wm.text || '', 0, 0);
  ctx.restore();
}

function renderImageWatermark(ctx, wm, pageWidth, pageHeight) {
  if (!wm.imageData) return;

  let img = imageCache.get(wm.imageData);
  if (!img) {
    img = new Image();
    img.src = wm.imageData;
    imageCache.set(wm.imageData, img);
  }

  if (!img.complete) return;

  const scale = wm.scale || 1;
  const w = (wm.width || img.naturalWidth || 200) * scale;
  const h = (wm.height || img.naturalHeight || 200) * scale;
  const pos = getPosition(wm.position, wm.customX, wm.customY, pageWidth, pageHeight, w, h);

  ctx.save();
  ctx.globalAlpha = wm.opacity !== undefined ? wm.opacity : 0.2;
  ctx.translate(pos.x, pos.y);
  ctx.rotate((wm.rotation || 0) * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function renderHeaderFooter(ctx, wm, pageNum, totalPages, pageWidth, pageHeight) {
  ctx.save();
  ctx.globalAlpha = 1;
  const fontSize = wm.fontSize || 10;
  ctx.font = `${fontSize}px ${wm.fontFamily || 'Helvetica'}`;
  ctx.fillStyle = wm.color || '#000000';

  const mt = wm.marginTop || 30;
  const mb = wm.marginBottom || 30;
  const ml = wm.marginLeft || 40;
  const mr = wm.marginRight || 40;

  const headerY = mt;
  const footerY = pageHeight - mb + fontSize;

  const slots = [
    { text: wm.headerLeft, x: ml, y: headerY, align: 'left' },
    { text: wm.headerCenter, x: pageWidth / 2, y: headerY, align: 'center' },
    { text: wm.headerRight, x: pageWidth - mr, y: headerY, align: 'right' },
    { text: wm.footerLeft, x: ml, y: footerY, align: 'left' },
    { text: wm.footerCenter, x: pageWidth / 2, y: footerY, align: 'center' },
    { text: wm.footerRight, x: pageWidth - mr, y: footerY, align: 'right' },
  ];

  for (const slot of slots) {
    if (!slot.text) continue;
    const resolved = substituteVariables(slot.text, pageNum, totalPages);
    ctx.textAlign = slot.align;
    ctx.textBaseline = 'top';
    ctx.fillText(resolved, slot.x, slot.y);
  }

  ctx.restore();
}

function renderWatermarksForLayer(ctx, layer, pageNum, pageWidth, pageHeight) {
  const watermarks = state.watermarks;
  if (!watermarks || watermarks.length === 0) return;

  const totalPages = state.pdfDoc ? state.pdfDoc.numPages : 1;

  for (const wm of watermarks) {
    if (!wm.enabled) continue;
    if ((wm.layer || 'behind') !== layer && wm.type !== 'headerFooter') continue;
    if (wm.type === 'headerFooter' && layer !== 'infront') continue;
    if (!shouldRenderOnPage(wm, pageNum, totalPages)) continue;

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
