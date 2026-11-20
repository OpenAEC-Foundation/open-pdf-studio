// After following a link to another place in the document, mark where it
// landed: the text on the destination page that matches the words under the
// link that was clicked, plus the text stacked right on it, in red, until the
// next click on the page.
//
// Many exported links only name the destination page (/Fit). Matching the
// link's own words finds the spot anyway: a link over "FD01" "S3.01" marks the
// "FD01" on the destination page and the line stacked with it. Text of a
// clearly different size (a title block) does not count as the same words.
// With a destination point (/XYZ) only the match nearest that point is marked.

import { matchBoxInPageFrame, boxToLayerPercent } from '../search/match-rect.js';

const KLASSE = 'link-doel-markering';

/** Text items as boxes in the unrotated page frame (y down from the top). */
export function tekstVakken(items, view) {
  const uit = [];
  for (const it of items || []) {
    const str = String(it?.str ?? '').trim();
    if (!str || !Array.isArray(it.transform)) continue;
    const b = matchBoxInPageFrame(it.transform, it.width, it.height, 0, 1, view);
    if (!b || !(b.h > 0)) continue;
    uit.push({ str, x: b.x, y: b.y, w: b.w, h: b.h, angle: b.angle || 0 });
  }
  return uit;
}

/** The words under a link rectangle ([x1, y1, x2, y2], PDF space). */
export function woordenOnder(vakken, rect, view) {
  const [x0, , , y1] = view.map(Number);
  const l = Math.min(rect[0], rect[2]) - x0, r = Math.max(rect[0], rect[2]) - x0;
  const t = y1 - Math.max(rect[1], rect[3]), b = y1 - Math.min(rect[1], rect[3]);
  return vakken.filter((v) => {
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    return cx >= l && cx <= r && cy >= t && cy <= b;
  });
}

/** Text stacked right on `v`: centred over or under it, about a line away. */
function gestapeld(v, vakken) {
  const cx = v.x + v.w / 2;
  return vakken.filter((o) => o !== v
    && Math.abs(o.h - v.h) <= 0.35 * v.h
    && Math.abs(o.x + o.w / 2 - cx) <= Math.max(v.w, o.w) / 2
    && Math.abs(o.y - v.y) <= 1.8 * v.h);
}

/**
 * The boxes to mark on the destination page. `woorden`: the words under the
 * link; `punt`: { x, y } in the page frame, or null.
 */
export function kiesDoelVakken(doelVakken, woorden, punt = null) {
  const bron = woorden.filter((w) => w.str.length >= 2);
  let treffers = doelVakken.filter((v) => bron.some((w) => w.str === v.str && Math.abs(v.h - w.h) <= 0.35 * w.h));
  if (!treffers.length) return [];
  if (punt) {
    const afstand = (v) => Math.hypot(v.x + v.w / 2 - punt.x, v.y + v.h / 2 - punt.y);
    const dichtst = treffers.reduce((a, b) => (afstand(b) < afstand(a) ? b : a));
    treffers = [dichtst];
  } else if (treffers.length > 12) {
    return [];   // a common word, not a mark
  }
  const uit = new Set();
  for (const t of treffers) {
    uit.add(t);
    for (const g of gestapeld(t, doelVakken)) uit.add(g);
  }
  return [...uit];
}

let opruimen = null;

export function wisLinkDoelMarkering() {
  opruimen?.();
  opruimen = null;
}

/** Draw the boxes in the page's text layer (percent of the page box). */
function teken(laag, vakken, view) {
  const els = vakken.map((v) => {
    const pct = boxToLayerPercent(v, view);
    const el = document.createElement('div');
    el.className = KLASSE;
    el.style.left = `${pct.left}%`;
    el.style.top = `${pct.top}%`;
    el.style.width = `${pct.width}%`;
    el.style.height = `${pct.height}%`;
    el.style.transformOrigin = '0 0';
    el.style.transform = pct.angle ? `rotate(${pct.angle}rad)` : 'none';
    laag.appendChild(el);
    return el;
  });
  const weg = () => wisLinkDoelMarkering();
  // The next click on the page clears it (after this one has finished).
  setTimeout(() => document.addEventListener('pointerdown', weg, { capture: true, once: true }), 0);
  opruimen = () => {
    for (const el of els) el.remove();
    document.removeEventListener('pointerdown', weg, { capture: true });
  };
}

/**
 * Mark the destination of a followed link. `bron`: { page, rect } of the link
 * that was clicked (PDF space); `destInfo` from parseDestinationArray.
 */
export async function markeerLinkDoel(doc, bron, doelPagina, destInfo, { tekstlaag, geldig = () => true } = {}) {
  wisLinkDoelMarkering();
  if (!bron || !Array.isArray(bron.rect) || !doc?.pdfDoc) return;
  const [bp, dp] = await Promise.all([doc.pdfDoc.getPage(bron.page), doc.pdfDoc.getPage(doelPagina)]);
  const [bt, dt] = await Promise.all([bp.getTextContent(), dp.getTextContent()]);
  if (!geldig()) return;
  const woorden = woordenOnder(tekstVakken(bt.items, bp.view), bron.rect, bp.view);
  if (!woorden.length) return;
  const view = Array.from(dp.view);
  const punt = Number.isFinite(destInfo?.left) && Number.isFinite(destInfo?.top)
    ? { x: destInfo.left - view[0], y: view[3] - destInfo.top } : null;
  const vakken = kiesDoelVakken(tekstVakken(dt.items, view), woorden, punt);
  if (!vakken.length) return;
  // The text layer of the destination page appears once it has rendered.
  for (let i = 0; i < 40; i++) {
    if (!geldig()) return;
    const laag = tekstlaag(doelPagina);
    if (laag) { teken(laag, vakken, view); return; }
    await new Promise((r) => setTimeout(r, 75));
  }
}
