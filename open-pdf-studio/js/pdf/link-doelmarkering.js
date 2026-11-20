// After following a link to another place in the document, mark where it
// landed, and offer the other pages the same mark is on.
//
// The words under the clicked link (a mark such as "FD01" or "3" over
// "S3.01") are looked up in the document: a place is one of those words
// stacked with the sheet number of the page the link was clicked on, so it
// points back at it (the number and the sheet together: "3" over "S1.01"
// matches, another "3" does not). The sheet number comes from the page name
// ("S3.01 - DETAILS"), else the largest sheet-like text on the page. Text of
// a clearly different size (a title block) is not the same words.
//
// One page: jump to it and mark every place in red. More pages: a small list
// at the pointer picks the page first. The marks clear on the next click.

import { matchBoxInPageFrame, boxToLayerPercent } from '../search/match-rect.js';
import { labelVan, heeftEigenLabel } from './pagina-labels.js';

const KLASSE = 'link-doel-markering';
const MAX_PER_PAGINA = 40;

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
export function gestapeld(v, vakken) {
  const cx = v.x + v.w / 2;
  return vakken.filter((o) => o !== v
    && Math.abs(o.h - v.h) <= 0.35 * v.h
    && Math.abs(o.x + o.w / 2 - cx) <= Math.max(v.w, o.w) / 2
    && Math.abs(o.y - v.y) <= 1.8 * v.h);
}

const zelfde = (w) => (v) => v.str === w.str && Math.abs(v.h - w.h) <= 0.35 * w.h;

/** The sheet number in a page name: "S3.01 - DETAILS" -> "S3.01"; no name: null. */
export function bladVanLabel(label) {
  const s = String(label ?? '').trim();
  if (!s || /^\d+$/.test(s)) return null;
  return s.split(/\s+[-–—]\s+|\s+/)[0] || null;
}

const BLAD_RE = /^[A-Z]{0,3}-?\d{1,3}(?:\.\d{1,3})?[A-Z]?$/;

/** The sheet number of a page without a name: its largest sheet-like text. */
export function bladVanPagina(vakken) {
  let beste = null;
  for (const v of vakken) if (BLAD_RE.test(v.str) && /[A-Z]/.test(v.str) && (!beste || v.h > beste.h)) beste = v;
  return beste?.str || null;
}

/**
 * The places to offer. `paginas`: Map page -> boxes; `bron`: { page, woorden,
 * blad } (blad: the sheet number of the page clicked on, or null);
 * `doelPagina`: where the link goes. A place is a word from under the link
 * stacked with `blad`: the number and the sheet together, so "3" over
 * "S1.01" matches and another "3" does not. Without a sheet number: the
 * rarest word under the link, on the link's own page. Returns
 * [{ page, aantal, vakken }] with the link's own page first.
 */
export function kiesPlekken(paginas, bron, doelPagina) {
  const woorden = bron.woorden;
  const plekken = [];
  if (bron.blad) {
    for (const [p, vakken] of paginas) {
      if (p === bron.page) continue;
      const treffers = vakken.filter((v) => v.str !== bron.blad && woorden.some((w) => zelfde(w)(v))
        && gestapeld(v, vakken).some((g) => g.str === bron.blad));
      if (!treffers.length || treffers.length > MAX_PER_PAGINA) continue;
      const uit = new Set();
      for (const t of treffers) { uit.add(t); for (const g of gestapeld(t, vakken)) uit.add(g); }
      plekken.push({ page: p, aantal: treffers.length, vakken: [...uit] });
    }
  }
  if (!plekken.length) {
    // No sheet number, or none pointing back: the rarest word, on the link's page.
    const vakken = paginas.get(doelPagina) || [];
    let sleutel = null, minst = Infinity;
    for (const w of woorden.filter((x) => x.str.length >= 2)) {
      const n = vakken.filter(zelfde(w)).length;
      if (n > 0 && n < minst) { minst = n; sleutel = w; }
    }
    if (!sleutel || minst > 12) return [];
    const treffers = vakken.filter(zelfde(sleutel));
    const uit = new Set();
    for (const t of treffers) { uit.add(t); for (const g of gestapeld(t, vakken)) uit.add(g); }
    return [{ page: doelPagina, aantal: treffers.length, vakken: [...uit] }];
  }
  plekken.sort((a, b) => (a.page === doelPagina ? -1 : b.page === doelPagina ? 1 : a.page - b.page));
  return plekken;
}

// ── Text of the document, once per document ─────────────────────────────────

const _cache = new WeakMap();

async function alleTekst(doc) {
  let c = _cache.get(doc.pdfDoc);
  if (!c) { c = new Map(); _cache.set(doc.pdfDoc, c); }
  const n = doc.pdfDoc.numPages;
  for (let p = 1; p <= n; p++) {
    if (c.has(p)) continue;
    const page = await doc.pdfDoc.getPage(p);
    const tc = await page.getTextContent();
    c.set(p, { view: Array.from(page.view), vakken: tekstVakken(tc.items, page.view) });
  }
  return c;
}

// ── Marks and the page list ─────────────────────────────────────────────────

let opruimen = null;

export function wisLinkDoelMarkering() {
  opruimen?.();
  opruimen = null;
}

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
  setTimeout(() => document.addEventListener('pointerdown', weg, { capture: true, once: true }), 0);
  opruimen = () => {
    for (const el of els) el.remove();
    document.removeEventListener('pointerdown', weg, { capture: true });
  };
}

/** A small list at the pointer: pick the page. Resolves to a page or null. */
function kiesPagina(plekken, doc, x, y) {
  return new Promise((klaar) => {
    document.querySelector('.link-doel-keuze')?.remove();
    const menu = document.createElement('div');
    menu.className = 'link-doel-keuze';
    menu.setAttribute('role', 'menu');
    const sluit = (p) => {
      menu.remove();
      document.removeEventListener('pointerdown', buiten, true);
      document.removeEventListener('keydown', toets, true);
      klaar(p);
    };
    const buiten = (e) => { if (!menu.contains(e.target)) sluit(null); };
    const toets = (e) => {
      const knoppen = [...menu.querySelectorAll('button')];
      const i = knoppen.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sluit(null); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        knoppen[(i + (e.key === 'ArrowDown' ? 1 : -1) + knoppen.length) % knoppen.length]?.focus();
      }
    };
    for (const p of plekken) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      const naam = heeftEigenLabel(doc.pageLabels, p.page) ? labelVan(doc.pageLabels, p.page) : `Page ${p.page}`;
      b.textContent = `${naam}${p.aantal > 1 ? `  (${p.aantal})` : ''}`;
      b.addEventListener('click', (e) => { e.stopPropagation(); sluit(p.page); });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x + 6, innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y + 6, innerHeight - r.height - 4))}px`;
    menu.querySelector('button')?.focus();
    setTimeout(() => {
      document.addEventListener('pointerdown', buiten, true);
      document.addEventListener('keydown', toets, true);
    }, 0);
  });
}

/**
 * Before following a link: where to go. Returns { page, vakken, view } (the
 * link's own page, or the one picked from the list), null to stay put, or
 * undefined when nothing was found (follow the link as it is).
 * `bron`: { page, rect, x, y } of the clicked link (rect in PDF space,
 * x/y the pointer).
 */
export async function kiesLinkDoel(doc, bron, doelPagina) {
  wisLinkDoelMarkering();
  if (!bron || !Array.isArray(bron.rect) || !doc?.pdfDoc) return undefined;
  const tekst = await alleTekst(doc);
  const eigen = tekst.get(bron.page);
  const woorden = woordenOnder(eigen.vakken, bron.rect, eigen.view);
  if (!woorden.length) return undefined;
  const blad = (heeftEigenLabel(doc.pageLabels, bron.page) ? bladVanLabel(labelVan(doc.pageLabels, bron.page)) : null)
    || bladVanPagina(eigen.vakken);
  const paginas = new Map([...tekst].map(([p, t]) => [p, t.vakken]));
  const plekken = kiesPlekken(paginas, { page: bron.page, woorden, blad }, doelPagina);
  if (!plekken.length) return undefined;
  let page = plekken[0].page;
  if (plekken.length > 1) {
    page = await kiesPagina(plekken, doc, bron.x ?? innerWidth / 2, bron.y ?? innerHeight / 2);
    if (page == null) return null;
  }
  const plek = plekken.find((p) => p.page === page);
  return { page, vakken: plek.vakken, view: tekst.get(page).view };
}

/** Draw the marks once the page's text layer is there. */
export async function markeerOpPagina(page, vakken, view, { tekstlaag, geldig = () => true }) {
  for (let i = 0; i < 40; i++) {
    if (!geldig()) return;
    const laag = tekstlaag(page);
    if (laag) { teken(laag, vakken, view); return; }
    await new Promise((r) => setTimeout(r, 75));
  }
}
