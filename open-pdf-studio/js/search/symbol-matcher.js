import { volgendeTaak } from '../core/volgende-taak.js';

/** Bounded binary template matching. No recognition model or remote service.
 *
 * The score is the share of the ink that the other image explains within one
 * pixel: (template ink with image ink next to it + image ink with template ink
 * next to it) / (template ink + image ink), over the template window. An exact
 * copy scores 1. One pixel of slack matters on line work: a symbol on a
 * fraction of a pixel, or drawn by another renderer, moves its thin lines by a
 * pixel, which halves a plain intersection/union. To keep unrelated dense ink
 * (text, hatching) out, the plain intersection/union must still reach
 * EXACT_SHARE of the threshold. Scores are not calibrated probabilities.
 * The Rust port (crate open-pdf-scan) follows this file line by line. */
export const EXACT_SHARE = .6;
/** Windows whose ink count is this far off the template's are skipped. */
export const COUNT_SHARE = .8;

/** Ink grown by one pixel in every direction (3 x 3). */
export function dilate({ width, height, pixels }) {
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!pixels[y * width + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx,
        yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) out[yy * width + xx] = 1;
    }
  }
  return { width, height, pixels: out };
}
export function binaryImage(image) {
  const { width, height, data } = image;
  if (!Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width * height > 2000000
    || data.length !== width * height * 4) throw new Error('INVALID_IMAGE');
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3 < 170 && data[i * 4 + 3] > 128 ? 1 : 0;
  return { width, height, pixels };
}

export function cropTemplate(image, rect) {
  const x = Math.floor(rect.x),
    y = Math.floor(rect.y),
    width = Math.ceil(rect.width),
    height = Math.ceil(rect.height);
  if (![x, y, width, height].every(Number.isFinite)
    || x < 0
    || y < 0
    || width < 6
    || height < 6
    || width > 160
    || height > 160
    || x + width > image.width
    || y + height > image.height) throw new Error('TEMPLATE_BOUNDS');
  const pixels = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) pixels.set(image.pixels.subarray((y + row) * image.width + x, (y + row) * image.width + x + width), row * width);
  const count = pixels.reduce((a, b) => a + b, 0);
  if (count < 8 || count > pixels.length * .75) throw new Error('TEMPLATE_NEEDS_CONTRAST');
  return { width, height, pixels };
}

export function transformTemplate(template, rotation, scale) {
  if (![0, 90, 180, 270].includes(rotation) || !Number.isFinite(scale) || scale < .5 || scale > 2) throw new Error('INVALID_TOLERANCE');
  const w = Math.max(1, Math.round(template.width * scale)),
    h = Math.max(1, Math.round(template.height * scale)),
    width = rotation % 180 ? h : w,
    height = rotation % 180 ? w : h;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let dx = x,
      dy = y;
    if (rotation === 90) {
      dx = h - y - 1;
      dy = x;
    } else if (rotation === 180) {
      dx = w - x - 1;
      dy = h - y - 1;
    } else if (rotation === 270) {
      dx = y;
      dy = w - x - 1;
    }
    pixels[dy * width + dx] = template.pixels[Math.min(template.height - 1, Math.floor(y / scale)) * template.width + Math.min(template.width - 1, Math.floor(x / scale))];
  }
  return { width, height, pixels, rotation, scale };
}
const intersection = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

export function suppressMatches(matches, limit = 1000) {
  const out = [];
  for (const m of [...matches].sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x)) {
    if (!out.some(p => intersection(p, m) / Math.min(p.width * p.height, m.width * m.height) > .4)) {
      out.push(m);
      if (out.length === limit) break;
    }
  }
  return out;
}

export async function matchSymbols(image, template, {
  threshold = .75,
  rotations = [0],
  scales = [1],
  signal,
  onProgress,
  yieldTask = volgendeTaak
} = {}) {
  if (!Number.isFinite(threshold)
    || threshold < .5
    || threshold > 1
    || !Array.isArray(rotations)
    || !rotations.length
    || rotations.length > 4
    || !Array.isArray(scales)
    || !scales.length
    || scales.length > 3) throw new Error('INVALID_TOLERANCE');
  const variants = [];
  for (const rotation of new Set(rotations)) for (const scale of new Set(scales)) variants.push(transformTemplate(template, rotation, scale));
  const grown = dilate(image);
  // Integral foreground counts reject blank/dense windows before sampling.
  const stride = image.width + 1,
    integral = new Uint32Array(stride * (image.height + 1));
  for (let y = 0; y < image.height; y++) {
    let row = 0;
    for (let x = 0; x < image.width; x++) {
      row += image.pixels[y * image.width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const found = [];
  let truncated = false;
  for (const [v, t] of variants.entries()) {
    const foreground = [];
    for (let i = 0; i < t.pixels.length; i++) if (t.pixels[i]) foreground.push(i);
    if (!foreground.length) continue;
    const anchors = Array.from({ length: Math.min(16, foreground.length) }, (_, i) => foreground[Math.floor(i * foreground.length / Math.min(16, foreground.length))]);
    const offsets = anchors.map(i => Math.floor(i / t.width) * image.width + i % t.width);
    const grownT = dilate(t).pixels;
    for (let y = 0; y <= image.height - t.height; y++) {
      if (y % 16 === 0) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        onProgress?.((v + y / image.height) / variants.length);
        await yieldTask();
      }
      for (let x = 0; x <= image.width - t.width; x++) {
        const count = integral[(y + t.height) * stride + x + t.width] - integral[y * stride + x + t.width] - integral[(y + t.height) * stride + x] + integral[y * stride + x];
        if (Math.min(count, foreground.length) / Math.max(1, count, foreground.length) < threshold * COUNT_SHARE) continue;
        const start = y * image.width + x;
        let hits = 0;
        for (const offset of offsets) hits += grown.pixels[start + offset];
        if (hits < anchors.length * Math.max(.5, threshold * .75)) continue;
        let both = 0,
          nearImage = 0,
          nearTemplate = 0;
        for (let row = 0; row < t.height; row++) for (let col = 0; col < t.width; col++) {
          const k = row * t.width + col,
            q = start + row * image.width + col,
            a = t.pixels[k],
            b = image.pixels[q];
          both += a & b;
          nearImage += a & grown.pixels[q];
          nearTemplate += b & grownT[k];
        }
        const ink = foreground.length + count;
        if (both / Math.max(1, ink - both) < EXACT_SHARE * threshold) continue;
        const score = (nearImage + nearTemplate) / Math.max(1, ink);
        if (score >= threshold) found.push({ x, y, width: t.width, height: t.height, score, rotation: t.rotation, scale: t.scale });
        if (found.length >= 5000) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(1);
  const reduced = suppressMatches(found, 1001);
  return { matches: reduced.slice(0, 1000), truncated: truncated || reduced.length > 1000 };
}

/** Counts at the same category/location are not duplicated, including reloads. */
export function planSymbolCounts(matches, annotations, category) {
  if (!category
    || typeof category.id !== 'string'
    || !category.id
    || category.id.length > 200
    || category.name !== undefined && typeof category.name !== 'string'
    || category.color !== undefined && !/^#[0-9a-f]{6}$/i.test(category.color)) throw new Error('CATEGORY_REQUIRED');
  const existing = annotations.filter(a => a.type === 'count' && a.categoryId === category.id),
    out = [];
  let number = Math.max(0, ...existing.map(a => Number(a.number) || 0));
  for (const m of matches) {
    const x = m.bounds.x + m.bounds.width / 2,
      y = m.bounds.y + m.bounds.height / 2;
    if ([...existing, ...out].some(a => a.page === m.page && Math.hypot(a.x - x, a.y - y) < 3)) continue;
    out.push({
      id: `symbol-count-${m.id}`,
      type: 'count',
      page: m.page,
      x,
      y,
      categoryId: category.id,
      ...(category.name ? { categoryName: category.name } : {}),
      number: ++number,
      markerStyle: category.markerStyle || 'dot',
      ...(category.symbolId ? { symbolId: category.symbolId } : {}),
      color: category.color || '#e11d48',
      strokeColor: category.color || '#e11d48',
      subject: category.name || category.id
    });
  }
  return out;
}
