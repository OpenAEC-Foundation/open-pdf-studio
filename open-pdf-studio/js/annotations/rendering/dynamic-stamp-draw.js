// Canvas drawing of a dynamic stamp (#629). Same layout as the PDF
// appearance (dynamic-stamp-layout.js): border on the full box, content
// scaled uniformly and centred.

import { layoutDynamicStamp, fitLayout } from '../dynamic-stamp-layout.js';

// Decoded template images, by data URL (shared by all stamps of a template).
const images = new Map();

function imageFor(dataUrl, onLoad) {
  let img = images.get(dataUrl);
  if (!img && typeof Image !== 'undefined') {
    img = new Image();
    img.addEventListener('load', () => { try { onLoad?.(); } catch (_) { /* redraw is best effort */ } }, { once: true });
    img.src = dataUrl;
    images.set(dataUrl, img);
    if (images.size > 64) images.delete(images.keys().next().value);
  }
  return img || null;
}

function boxPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/**
 * Draw `ann` (type 'stamp' with ann.dynamicStamp) on a canvas in annotation
 * coordinates.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} ann
 * @param {{onImageLoad?: () => void}} [opts]
 */
export function drawDynamicStamp(ctx, ann, { onImageLoad } = {}) {
  const ds = ann.dynamicStamp;
  if (!ds?.template) return;
  const t = ds.template;
  const layout = layoutDynamicStamp(t, ds.values || {});
  const w = ann.width, h = ann.height;
  const { scale, dx, dy } = fitLayout(layout, w, h);
  const color = t.color || ann.color || '#c00000';

  ctx.save();
  ctx.translate(ann.x + w / 2, ann.y + h / 2);
  ctx.rotate((ann.rotation || 0) * Math.PI / 180);
  if (ann.flipX || ann.flipY) ctx.scale(ann.flipX ? -1 : 1, ann.flipY ? -1 : 1);
  ctx.translate(-w / 2, -h / 2);

  const bw = layout.borderWidth * scale;
  const r = layout.radius * scale;
  if (t.fillColor) {
    ctx.fillStyle = t.fillColor;
    boxPath(ctx, bw / 2, bw / 2, w - bw, h - bw, r);
    ctx.fill();
  }
  if (bw > 0) {
    ctx.strokeStyle = color;
    ctx.lineWidth = bw;
    boxPath(ctx, bw / 2, bw / 2, w - bw, h - bw, r);
    ctx.stroke();
  }

  if (layout.image && t.image?.dataUrl) {
    const img = imageFor(t.image.dataUrl, onImageLoad);
    if (img && img.complete && img.naturalWidth) {
      const b = layout.image;
      ctx.drawImage(img, dx + b.x * scale, dy + b.y * scale, b.width * scale, b.height * scale);
    }
  }

  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const line of layout.lines) {
    if (!line.text) continue;
    ctx.font = `${line.bold ? 'bold ' : ''}${line.fontSize * scale}px Helvetica, Arial, sans-serif`;
    ctx.fillText(line.text, dx + line.x * scale, dy + line.baseline * scale);
  }
  ctx.restore();
}
