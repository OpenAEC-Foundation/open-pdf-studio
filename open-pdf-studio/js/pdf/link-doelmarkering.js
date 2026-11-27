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

// A view title draws its number in a larger, different font than the cut
// bubble does (11.5 pt against 8.5 pt), so a bubble and its title are
// matched with room on the size, both ways; the label and sheet together
// keep the match exact.
const ruim = (a, b) => a.str === b.str && b.h >= 0.55 * a.h && b.h <= 1.8 * a.h;
const boven = (v, lijst) => lijst.filter((o) => o !== v
  && o.h >= 0.45 * v.h && o.h <= 2.2 * v.h
  && Math.abs(o.x + o.w / 2 - (v.x + v.w / 2)) <= Math.max(v.w, o.w) / 2 + 1
  && Math.abs(o.y - v.y) <= 1.8 * Math.max(v.h, o.h));

/** The sheet number in a page name: "S3.01 - DETAILS" -> "S3.01"; no name: null. */
export function bladVanLabel(label) {
  const s = String(label ?? '').replace(/[\x00-\x1f]/g, '').trim();
  if (!s || /^\d+$/.test(s)) return null;
  const token = s.split(/\s+[-–—]\s+|\s+/)[0];
  return BLAD_RE.test(token) && /[A-Z]/.test(token) ? token : null;
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
  if (!woorden?.length) return [];
  const plekken = [];
  if (bron.blad) {
    for (const [p, vakken] of paginas) {
      if (p === bron.page) continue;
      const treffers = vakken.filter((v) => v.str !== bron.blad && woorden.some((w) => ruim(w, v))
        && boven(v, vakken).some((g) => g.str === bron.blad));
      if (!treffers.length) continue;
      const uit = new Set();
      for (const t of treffers) { uit.add(t); for (const g of boven(t, vakken)) if (g.str === bron.blad) uit.add(g); }
      plekken.push({ page: p, aantal: treffers.length, vakken: [...uit] });
    }
  }
  if (!plekken.length) {
    // The words under the link as a stacked pair ("A" over "S4.01"): the
    // same pair on the link's page, not the clicked one itself (a link to a
    // view on the same sheet), and not a lone "S4.01" of another bubble.
    const vakken = paginas.get(doelPagina) || [];
    const kandidaten = vakken.filter(v => bron.page !== doelPagina || !woorden.includes(v));
    for (const w of woorden) {
      for (const g of boven(w, woorden)) {
        const treffers = kandidaten.filter((v) => !woorden.includes(v) && ruim(w, v)
          && boven(v, vakken).some((o) => !woorden.includes(o) && ruim(g, o)));
        if (!treffers.length) continue;
        const uit = new Set();
        for (const t of treffers) { uit.add(t); for (const o of boven(t, vakken)) if (ruim(g, o)) uit.add(o); }
        return [{ page: doelPagina, aantal: treffers.length, vakken: [...uit] }];
      }
    }
    // No pair: the rarest word, on the link's page.
    let sleutel = null, minst = Infinity;
    for (const w of woorden.filter((x) => x.str.length > 0)) {
      const n = kandidaten.filter(zelfde(w)).length;
      if (n > 0 && n < minst) { minst = n; sleutel = w; }
    }
    if (!sleutel) return [];
    const treffers = kandidaten.filter(zelfde(sleutel));
    const uit = new Set();
    for (const t of treffers) { uit.add(t); for (const g of gestapeld(t, vakken)) uit.add(g); }
    return [{ page: doelPagina, aantal: treffers.length, vakken: [...uit] }];
  }
  plekken.sort((a, b) => (a.page === doelPagina ? -1 : b.page === doelPagina ? 1 : a.page - b.page));
  return plekken;
}

// Each PDF proxy owns its text cache, including in-flight page reads.
const caches = new WeakMap();
export async function leesLinkTekst(pdf, geldig = () => true) {
  let cache = caches.get(pdf);
  if (!cache) { cache = new Map(); caches.set(pdf, cache); }
  const result = new Map();
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (!geldig()) return null;
    let read = cache.get(pageNum);
    if (!read) {
      read = (async () => {
        const page = await pdf.getPage(pageNum);
        const text = await page.getTextContent();
        return { view: Array.from(page.view), vakken: tekstVakken(text.items, page.view) };
      })();
      cache.set(pageNum, read);
    }
    let text;
    try { text = await read; }
    catch (error) { if (cache.get(pageNum) === read) cache.delete(pageNum); throw error; }
    if (!geldig()) return null;
    result.set(pageNum, text);
  }
  return result;
}

let active = null;
export function wisLinkDoelMarkering() {
  const previous = active;
  active = null;
  previous?.dispose();
}

function beginScope(geldig) {
  wisLinkDoelMarkering();
  const cleanup = [];
  const scope = { menu: null, add: fn => cleanup.push(fn),
    valid: () => active === scope && geldig(),
    dispose: () => { for (const fn of cleanup.splice(0)) fn(); },
  };
  active = scope;
  const outside = e => { if (!scope.menu?.contains(e.target)) wisLinkDoelMarkering(); };
  const escape = e => { if (e.key === 'Escape') wisLinkDoelMarkering(); };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('click', outside, true);
  document.addEventListener('keydown', escape, true);
  const timer = setInterval(() => { if (active === scope && !geldig()) wisLinkDoelMarkering(); }, 100);
  scope.add(() => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('click', outside, true);
    document.removeEventListener('keydown', escape, true);
    clearInterval(timer);
  });
  return scope;
}

function kiesPagina(plekken, doc, x, y, scope, pageLabel) {
  return new Promise(resolve => {
    const menu = document.createElement('div');
    menu.className = 'link-doel-keuze';
    menu.setAttribute('role', 'menu');
    const previousFocus = document.activeElement;
    let done = false;
    const close = page => {
      if (done) return;
      done = true;
      menu.remove(); scope.menu = null;
      menu.removeEventListener('keydown', keydown);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(page);
    };
    const keydown = e => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Tab') { wisLinkDoelMarkering(); return; }
      const buttons = [...menu.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
        : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    for (const plek of plekken) {
      const button = document.createElement('button');
      button.type = 'button'; button.setAttribute('role', 'menuitem');
      const label = heeftEigenLabel(doc.pageLabels, plek.page)
        ? labelVan(doc.pageLabels, plek.page).replace(/[\x00-\x1f]/g, '').trim() : pageLabel(plek.page);
      button.textContent = `${label}${plek.aantal > 1 ? ` (${plek.aantal})` : ''}`;
      button.addEventListener('click', e => { e.stopPropagation(); close(plek.page); });
      button.addEventListener('mouseenter', () => button.focus({ preventScroll: true }));
      menu.appendChild(button);
    }
    scope.menu = menu; scope.add(() => close(null));
    menu.addEventListener('keydown', keydown);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x + 6, innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y + 6, innerHeight - rect.height - 4))}px`;
    menu.querySelector('button')?.focus();
  });
}

/** Resolve a clicked link's partner, without allowing a stale jump to show UI. */
export async function kiesLinkDoel(doc, bron, doelPagina, {
  geldig = () => true, pageLabel = n => String(n),
} = {}) {
  if (!bron || !Array.isArray(bron.rect) || !doc?.pdfDoc) return undefined;
  const scope = beginScope(geldig);
  const canvas = document.getElementById('canvas-container');
  canvas?.classList.add('link-doel-bezig');
  scope.add(() => canvas?.classList.remove('link-doel-bezig'));
  let tekst;
  try { tekst = await leesLinkTekst(doc.pdfDoc, scope.valid); }
  catch (error) { if (active === scope) wisLinkDoelMarkering(); throw error; }
  finally { if (active === scope) canvas?.classList.remove('link-doel-bezig'); }
  if (!tekst || !scope.valid()) return null;
  const eigen = tekst.get(bron.page);
  if (!eigen) { wisLinkDoelMarkering(); return undefined; }
  const woorden = woordenOnder(eigen.vakken, bron.rect, eigen.view);
  const blad = (heeftEigenLabel(doc.pageLabels, bron.page) ? bladVanLabel(labelVan(doc.pageLabels, bron.page)) : null)
    || bladVanPagina(eigen.vakken);
  const paginas = new Map([...tekst].map(([n, t]) => [n, t.vakken]));
  const plekken = kiesPlekken(paginas, { page: bron.page, woorden, blad }, doelPagina);
  if (!plekken.length) { wisLinkDoelMarkering(); return undefined; }
  const page = plekken.length === 1 ? plekken[0].page
    : await kiesPagina(plekken, doc, bron.x ?? innerWidth / 2, bron.y ?? innerHeight / 2, scope, pageLabel);
  if (page == null || !scope.valid()) return null;
  const plek = plekken.find(p => p.page === page);
  return { page, vakken: plek.vakken, view: tekst.get(page).view, scope };
}

/** The text layer itself supplies page rotation/zoom; boxes stay in page coordinates. */
export async function markeerOpPagina(page, vakken, view, { tekstlaag, geldig = () => true, scope }) {
  for (let i = 0; i < 40; i++) {
    if (!geldig() || !scope?.valid()) return;
    const laag = tekstlaag(page);
    if (laag) {
      const elements = vakken.map(v => {
        const pct = boxToLayerPercent(v, view);
        const el = document.createElement('div'); el.className = KLASSE;
        Object.assign(el.style, { left: `${pct.left}%`, top: `${pct.top}%`, width: `${pct.width}%`,
          height: `${pct.height}%`, transformOrigin: '0 0', transform: pct.angle ? `rotate(${pct.angle}rad)` : 'none' });
        laag.appendChild(el); return el;
      });
      scope.add(() => elements.forEach(el => el.remove()));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  if (active === scope) wisLinkDoelMarkering();
}
