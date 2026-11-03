// Huidige weergave afdrukken: één zichtbaar paginadeel, zonder achtergrond.
// Zuivere geometrie; voorbeeld en afdruk gebruiken dezelfde uitsnede.
import { rectNaarPagina, weergaveMaat, weergaveMatrix } from './weergave-rotatie.js';

export function firstVisiblePage(view, pages) {
  for (const page of [...pages].sort((a, b) => a.pageNum - b.pageNum)) {
    const r = page.rect;
    const x = Math.max(view.x, r.x), y = Math.max(view.y, r.y);
    const right = Math.min(view.x + view.width, r.x + r.width);
    const bottom = Math.min(view.y + view.height, r.y + r.height);
    if (right > x && bottom > y) return { pageNum: page.pageNum, rect: { x, y, width: right - x, height: bottom - y } };
  }
  return null;
}

export function currentViewSize(view) {
  const m = weergaveMaat(view.rect.width, view.rect.height, view.rotation);
  return { breedtePt: m.breedte, hoogtePt: m.hoogte };
}

// `part` is in pixels of the cropped, view-rotated page. Undo that rotation
// before asking the existing output renderer for document + annotations.
export function currentViewSource(view, scale, part) {
  const width = Math.ceil(view.rect.width * scale - 1e-6);
  const height = Math.ceil(view.rect.height * scale - 1e-6);
  const r = rectNaarPagina({ x: part.x, y: part.y, width: part.breedte, height: part.hoogte }, width, height, view.rotation);
  return { x: view.rect.x * scale + r.x, y: view.rect.y * scale + r.y, breedte: r.width, hoogte: r.height };
}

export function rotateViewCanvas(canvas, rotation, createCanvas = () => document.createElement('canvas')) {
  if (!rotation) return canvas;
  const out = createCanvas();
  const size = weergaveMaat(canvas.width, canvas.height, rotation);
  out.width = size.breedte; out.height = size.hoogte;
  const ctx = out.getContext('2d');
  ctx.setTransform(...weergaveMatrix(canvas.width, canvas.height, rotation));
  ctx.drawImage(canvas, 0, 0);
  return out;
}
