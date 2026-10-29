// Gesplitste weergave (#715): twee panelen op hetzelfde document.
//
// Zie split-staat.js voor het ontwerp. Hier de DOM-kant:
// - de lay-out (#split-host met #pdf-container, de scheidingslijn en het
//   tweede paneel #split-pane), met CSS order om de echte viewer in het
//   actieve paneel te zetten;
// - het tekenen van het tweede paneel (paginalaag + annotatielaag) uit zijn
//   eigen stand, met dezelfde paginabitmaps (page-bitmap-cache) en dezelfde
//   annotatietekenaar (renderAnnotationsForPage) als de echte viewer;
// - het wisselen van actief paneel, synchroon scrollen/zoomen, de
//   scheidingslijn, en bijwerken na annotatie- en paginawijzigingen.
//
// Zonder gesplitste weergave doet deze module niets: de haken in de viewer
// melden, maar de lay-out blijft `display: contents` en er wordt niets
// getekend.

import { state, getActiveDocument } from '../../core/state.js';
import { heeftRustRenderer } from '../../core/platform.js';
import { nextScaleStep } from '../../core/zoom-display.js';
import { op } from './split-haken.js';
import * as S from './split-staat.js';
import {
  viewport, volgViewport, leesAnkers, viewportCanvasMaat, pasViewportMaatAan,
  zetViewportStand, stopPanMomentum, wielPanViewport, zoomStepAtPoint,
  bewaarStandVoorLayoutwissel, markAnchored,
} from '../pdf-viewport.js';
import { renderPage, renderContinuous, setViewMode, continuousZoomBy } from '../renderer.js';
import { renderAnnotationsForPage } from '../../annotations/rendering.js';
import { paneelBitmaps, paneelPdfjsBeelden, laatPaneelBitmapsLos, vergeetPaneelBeelden } from './paneel-bitmaps.js';
import { metPaneelStand } from './paneel-weergave.js';
import { viewportGeometrie, weergaveMatrix, weergaveMaat, vermenigvuldig } from '../weergave-rotatie.js';
import { paginaMaat } from '../weergave-ruimte.js';
import { thinLinesOn } from '../thin-lines.js';
import { compareFocused } from '../../compare/compare-store.js';
import { WEERGAVE_GEDRAAID } from '../weergave-draaien.js';
import { splitOpdrachtActie } from './split-sneltoets.js';
import { achtergrondKleur, eigenAchtergrond, ACHTERGROND_GEWIJZIGD } from '../pagina-achtergrond.js';

// doc.id → staat (split-staat.js). Bewust buiten de reactieve store: een
// stand bevat canvassen en bitmaps. Wat de interface nodig heeft staat op
// doc.splitView (zie spiegelUi).
const _staten = new Map();
let _zichtbaar = false;
let _gepland = 0;
let _tekenBezig = false;
let _wisselBezig = false;
let _laatsteKenmerk = null;
let _syncBasis = null;
let _geinit = false;
let _layoutSleutel = '';
const _matenAanvragen = new Set();

const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

// ── Publiek ───────────────────────────────────────────────────────────────

/** De gesplitste weergave van een document (of null). */
export function splitStaatVan(doc = getActiveDocument()) {
  return doc ? _staten.get(doc.id) || null : null;
}

/** Is het actieve document nu gesplitst? */
export function isGesplitst(doc = getActiveDocument()) {
  return !!splitStaatVan(doc);
}

/**
 * View > Split > Split Vertical/Horizontal. Splitst het actieve document (het
 * tweede paneel begint op de huidige pagina en zoom) of wisselt de richting.
 */
export function splitsWeergave(richting = 'vertical') {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return false;
  const bestaand = _staten.get(doc.id);
  if (bestaand) {
    if (bestaand.richting !== richting) {
      // Richting wisselen (#858): elk paneel houdt zijn pagina en zoom, ook
      // een passende pagina (die zou bij de nieuwe paneelmaat anders opnieuw
      // passend worden en van zoom veranderen).
      if (liveViewportToont(doc)) markAnchored();
      zetStaat(doc, { ...bestaand, stand: S.zetVerankerd(bestaand.stand), richting: S.RICHTINGEN.includes(richting) ? richting : 'vertical' });
      pasSplitLayoutToe();
      planTekenen();
    }
    return true;
  }
  const live = leesLiveStand(doc, { metBeeld: false });
  zetStaat(doc, S.maakSplitStaat(richting, live));
  pasSplitLayoutToe();
  _syncBasis = waarnemingLive(doc);
  planTekenen();
  return true;
}

/** View > Split > Unsplit: het actieve paneel houdt zijn pagina en zoom. */
export function hefSplitsingOp() {
  const doc = getActiveDocument();
  if (!doc || !_staten.has(doc.id)) return false;
  zetStaat(doc, null);
  pasSplitLayoutToe();
  // Wat het tweede paneel vasthield (PDF.js-canvassen, bitmapclaims) weg.
  vergeetPaneelBeelden(doc);
  return true;
}

/** Sync aan/uit: scrollen en zoomen in het ene paneel beweegt het andere mee. */
export function zetSplitSync(aan) {
  const doc = getActiveDocument();
  const st = splitStaatVan(doc);
  if (!st) return;
  zetStaat(doc, { ...st, sync: !!aan });
  _syncBasis = waarnemingLive(doc);
}

/** Verhouding van paneel 0 (links/boven), 0.15–0.85. */
export function zetSplitVerhouding(v) {
  const doc = getActiveDocument();
  const st = splitStaatVan(doc);
  if (!st) return;
  zetStaat(doc, { ...st, verhouding: S.klemVerhouding(v) });
  pasSplitLayoutToe();
}

/**
 * Een splitsopdracht van het toetsenbord (#858): Split Vertical/Horizontal
 * (die van de splitsing die er al staat heft hem op), Unsplit, en het actieve
 * paneel 5% groter of kleiner.
 */
export function voerSplitOpdrachtUit(id) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || vergelijkingVoor()) return false;
  const actie = splitOpdrachtActie(id, splitStaatVan(doc));
  if (!actie) return false;
  if (actie.soort === 'opheffen') return hefSplitsingOp();
  if (actie.soort === 'splitsen') return splitsWeergave(actie.richting);
  if (actie.soort === 'verhouding') { zetSplitVerhouding(actie.verhouding); return true; }
  return false;
}

/** Maak het andere paneel actief (zoals een klik erin). */
export async function activeerAnderPaneel() {
  if (_wisselBezig) return false;
  const doc = getActiveDocument();
  const st = splitStaatVan(doc);
  if (!st || !_zichtbaar || !doc.pdfDoc) return false;
  if (gereedschapBezig()) return false;
  _wisselBezig = true;
  try {
    stopPanMomentum();
    const live = leesLiveStand(doc, { metBeeld: true });
    const { staat, aankomst } = S.wisselActiefPaneel(st, live);
    zetStaat(doc, staat);
    pasSplitLayoutToe();
    // Het tweede paneel zit nu waar de viewer zat en toont meteen wat de
    // viewer toonde (de beeldopname past precies: zelfde vak).
    tekenSpiegelNu();
    await zetLiveStand(doc, aankomst);
    _syncBasis = waarnemingLive(doc);
    _laatsteKenmerk = null;
    planTekenen();
    return true;
  } finally {
    _wisselBezig = false;
  }
}

/**
 * Lay-out van de gesplitste weergave voor het actieve document. Ook
 * aangeroepen als het vergelijkingstabblad voor komt of weggaat.
 */
export function pasSplitLayoutToe() {
  const host = byId('split-host');
  const live = byId('pdf-container');
  const pane = byId('split-pane');
  const scheiding = byId('split-divider');
  if (!host || !live || !pane || !scheiding) return;
  const doc = getActiveDocument();
  const st = splitStaatVan(doc);
  const zichtbaar = !!st && !!doc?.pdfDoc && !vergelijkingVoor();
  const was = _zichtbaar;
  const oudeRichting = host.classList.contains('split-horizontaal');
  host.classList.toggle('split-aan', zichtbaar);
  host.classList.toggle('split-horizontaal', zichtbaar && st.richting === 'horizontal');
  if (zichtbaar) {
    const v = S.klemVerhouding(st.verhouding);
    const liveDeel = st.actief === 0 ? v : 1 - v;
    live.style.order = st.actief === 0 ? '0' : '2';
    pane.style.order = st.actief === 0 ? '2' : '0';
    scheiding.style.order = '1';
    live.style.flexGrow = String(liveDeel);
    pane.style.flexGrow = String(1 - liveDeel);
    host.dataset.actief = String(st.actief);
  } else {
    live.style.order = '';
    live.style.flexGrow = '';
    pane.style.order = '';
    pane.style.flexGrow = '';
    scheiding.style.order = '';
    delete host.dataset.actief;
  }
  _zichtbaar = zichtbaar;
  // Verborgen tweede paneel: het houdt geen paginabitmaps meer vast.
  if (!zichtbaar) laatPaneelBitmapsLos();
  // De viewer krijgt meteen zijn nieuwe maat (de ResizeObserver komt pas een
  // frame later): wie hierna een stand terugzet, rekent met het juiste vak.
  // Alleen als de lay-out echt veranderde; zonder splitsing blijft alles bij
  // het oude (de ResizeObserver van de viewer doet dan wat hij altijd deed).
  const sleutel = zichtbaar ? `${st.richting}|${st.actief}|${S.klemVerhouding(st.verhouding)}` : '';
  if (sleutel !== _layoutSleutel) {
    _layoutSleutel = sleutel;
    // Tabwissel tussen een gesplitst en een niet-gesplitst document: de
    // viewport toont nog het vertrekkende document. Zijn stand (#539) eerst
    // bewaren met de oude maat, anders keert hij niet exact terug.
    try { bewaarStandVoorLayoutwissel(doc?.filePath); } catch { /* geen viewport */ }
    try { pasViewportMaatAan(); } catch { /* geen viewport */ }
  }
  plaatsKader();
  if (zichtbaar && (!was || oudeRichting !== (st.richting === 'horizontal'))) planTekenen();
}

// ── Initialisatie ─────────────────────────────────────────────────────────

export function initSplitView() {
  if (_geinit) return;
  const pane = byId('split-pane');
  const scheiding = byId('split-divider');
  const live = byId('pdf-container');
  if (!pane || !scheiding || !live) return;
  _geinit = true;

  op('annotatiesHertekend', () => {
    if (_tekenBezig || !_zichtbaar) return;
    const k = kenmerkNu();
    if (S.moetSpiegelHertekenen(_laatsteKenmerk, k)) planTekenen();
    _laatsteKenmerk = k;
  });
  op('weergaveGerenderd', () => { if (_zichtbaar) { syncVanLive(); planTekenen(); } });
  op('actiefDocument', () => {
    _laatsteKenmerk = null;
    pasSplitLayoutToe();
    _syncBasis = waarnemingLive(getActiveDocument());
  });
  op('documentGesloten', (doc) => {
    if (doc) {
      _staten.delete(doc.id);
      vergeetPaneelBeelden(doc);
    }
    pasSplitLayoutToe();
  });
  op('paginaStructuur', ({ doc, pageMapping, numPages } = {}) => naPaginaStructuur(doc, pageMapping, numPages));
  op('spiegelKlik', () => {
    // Na de huidige gebeurtenis: een open tekstbewerker krijgt eerst zijn
    // blur en legt de tekst vast.
    setTimeout(() => { activeerAnderPaneel(); }, 0);
  });

  pane.addEventListener('wheel', opWiel, { passive: false });
  live.addEventListener('scroll', () => { if (_zichtbaar) syncVanLive(); }, { passive: true });
  volgViewport(() => { if (_zichtbaar && !_tekenBezig) syncVanLive(); });
  if (typeof window !== 'undefined') {
    window.addEventListener(WEERGAVE_GEDRAAID, () => planTekenen());
    // Een andere achtergrondkleur rond de pagina (#859).
    window.addEventListener(ACHTERGROND_GEWIJZIGD, () => planTekenen());
  }

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => { if (_zichtbaar) { plaatsKader(); planTekenen(); } });
    ro.observe(pane);
    ro.observe(live);
  }
  koppelScheiding(scheiding);
}

// ── Staat en interface ────────────────────────────────────────────────────

function zetStaat(doc, staat) {
  if (!doc) return;
  if (staat) _staten.set(doc.id, staat);
  else _staten.delete(doc.id);
  spiegelUi(doc, staat);
}

// De ribbon (Solid) leest doc.splitView: alleen de vlaggen, geen standen.
function spiegelUi(doc, staat) {
  const nieuw = staat ? { richting: staat.richting, actief: staat.actief, verhouding: staat.verhouding, sync: !!staat.sync } : null;
  const oud = doc.splitView || null;
  if (!nieuw && !oud) return;
  if (nieuw && oud && nieuw.richting === oud.richting && nieuw.actief === oud.actief
    && nieuw.verhouding === oud.verhouding && nieuw.sync === oud.sync) return;
  doc.splitView = nieuw;
}

function vergelijkingVoor() {
  try { return !!compareFocused(); } catch { return false; }
}

function gereedschapBezig() {
  return !!(state.isDrawing || state.isDragging || state.isResizing || state.isRubberBanding
    || state.isDrawingPolyline || state.isDrawingCloudPolyline || state.isDrawingSpline
    || state.isDrawingSplineArrow || state.isDrawingDimension || state.gMoveMode || state.gRotateMode
    || state.isPanning || (Array.isArray(state.measurePoints) && state.measurePoints.length > 0));
}

function plaatsKader() {
  const kader = byId('split-active-frame');
  const live = byId('pdf-container');
  if (!kader || !live) return;
  if (!_zichtbaar) { kader.style.width = '0'; kader.style.height = '0'; return; }
  kader.style.left = `${live.offsetLeft}px`;
  kader.style.top = `${live.offsetTop}px`;
  kader.style.width = `${live.offsetWidth}px`;
  kader.style.height = `${live.offsetHeight}px`;
}

// ── De stand van de echte viewer ──────────────────────────────────────────

function liveViewportToont(doc) {
  return !!(doc?.filePath && viewport.active && viewport.filePath === doc.filePath && doc.viewMode !== 'continuous');
}

/** Momentopname van de echte viewer (het actieve paneel). */
function leesLiveStand(doc, { metBeeld = false } = {}) {
  const c = byId('pdf-container');
  const stand = {
    modus: S.modusVan(doc),
    page: doc.currentPage || 1,
    scale: doc.scale,
    viewRotation: S.normaliseerRotatie(doc.viewRotation),
    scrollLeft: c ? c.scrollLeft : 0,
    scrollTop: c ? c.scrollTop : 0,
    cssW: c ? c.offsetWidth : 0,
    cssH: c ? c.offsetHeight : 0,
    vp: null,
    layout: null,
    bevroren: null,
    achtergrond: achtergrondKleur(),
  };
  if (liveViewportToont(doc)) {
    const ankers = leesAnkers();
    const maat = viewportCanvasMaat();
    stand.cssW = maat.cssW || stand.cssW;
    stand.cssH = maat.cssH || stand.cssH;
    stand.page = viewport.pageNum || stand.page;
    stand.scale = viewport.zoom;
    stand.vp = {
      zoom: viewport.zoom,
      offsetX: viewport.offsetX,
      offsetY: viewport.offsetY,
      pageNum: viewport.pageNum,
      pageW: viewport.pageW,
      pageH: viewport.pageH,
      originX: viewport.originX,
      originY: viewport.originY,
      rotation: viewport.rotation || 0,
      viewRotation: S.normaliseerRotatie(viewport.viewRotation),
      pageType: viewport.pageType,
      verankerd: ankers.verankerd,
      strikt: ankers.strikt,
      tile: viewport.currentTile || null,
      tileMeta: viewport.currentTileMeta ? { ...viewport.currentTileMeta } : null,
      tileBestand: doc.filePath,
    };
  } else if (c) {
    stand.layout = meetLayout(c, doc);
    try {
      const kleur = getComputedStyle(c).backgroundColor;
      if (kleur && kleur !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(kleur)) stand.achtergrond = kleur;
    } catch { /* standaardkleur */ }
  }
  if (metBeeld && c) stand.bevroren = neemBeeldOp(c, stand, doc);
  return stand;
}

// Paginavlakken van de doorlopende (of webversie-)weergave, in CSS-px van
// de scrollinhoud van #pdf-container.
function meetLayout(c, doc) {
  const cr = c.getBoundingClientRect();
  const rects = [];
  const voeg = (page, el) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    rects.push({ page, x: r.left - cr.left + c.scrollLeft, y: r.top - cr.top + c.scrollTop, w: r.width, h: r.height });
  };
  if (doc.viewMode === 'continuous') {
    c.querySelectorAll('#continuous-container .page-wrapper').forEach((w) => {
      const page = parseInt(w.dataset.page, 10);
      const cc = w.querySelector('.canvas-container-cont');
      if (page && cc) voeg(page, cc);
    });
  } else {
    const pc = byId('pdf-canvas');
    if (pc) voeg(doc.currentPage || 1, pc);
  }
  if (!rects.length) return null;
  const onderkant = Math.max(...rects.map((r) => r.y + r.h));
  return {
    rects,
    scale: doc.scale,
    viewRotation: S.normaliseerRotatie(doc.viewRotation),
    breedte: c.scrollWidth,
    hoogte: c.scrollHeight,
    onder: Math.max(0, c.scrollHeight - onderkant),
    pad: rects.length ? Math.min(...rects.map((r) => r.y)) : 20,
    gemeten: true,
    rotaties: rotatieSig(doc),
  };
}

// Bevroren beeld van de paginalaag van de viewer (zonder annotaties): het
// tweede paneel toont na een wissel meteen precies wat er stond, tot de
// paginabitmaps uit de cache er zijn.
function neemBeeldOp(c, stand, doc) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(stand.cssW * dpr);
  const H = Math.round(stand.cssH * dpr);
  if (!(W > 0 && H > 0)) return null;
  try {
    const doek = document.createElement('canvas');
    doek.width = W;
    doek.height = H;
    const ctx = doek.getContext('2d');
    ctx.fillStyle = paneelAchtergrond(stand);
    ctx.fillRect(0, 0, W, H);
    const cr = c.getBoundingClientRect();
    const tekenEl = (el, wit) => {
      const r = el.getBoundingClientRect();
      if (r.right < cr.left || r.bottom < cr.top || r.left > cr.right || r.top > cr.bottom) return;
      const x = (r.left - cr.left) * dpr;
      const y = (r.top - cr.top) * dpr;
      if (wit) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, r.width * dpr, r.height * dpr); return; }
      if (el.width > 0 && el.height > 0) ctx.drawImage(el, x, y, r.width * dpr, r.height * dpr);
    };
    if (stand.vp) {
      const pc = byId('pdf-canvas');
      if (pc && pc.width > 0) ctx.drawImage(pc, 0, 0, W, H);
    } else {
      c.querySelectorAll('#continuous-container .canvas-container-cont').forEach((cc) => tekenEl(cc, true));
      c.querySelectorAll('#continuous-container .pdf-canvas, #canvas-container #pdf-canvas').forEach((el) => tekenEl(el, false));
    }
    return { beeld: doek, sleutel: S.beeldSleutel(stand, { filePath: doc.filePath, cssW: stand.cssW, cssH: stand.cssH, extra: beeldExtra(doc) }) };
  } catch (e) {
    console.warn('[split-view] beeldopname mislukt:', e);
    return null;
  }
}

// Wat het beeld van een pagina verder bepaalt: dunne lijnen (#595) en de
// paginarotaties van het document (pagina's draaien).
function beeldExtra(doc = getActiveDocument()) {
  let dun = '';
  try { dun = thinLinesOn() ? 'dun' : ''; } catch { /* standaard */ }
  return `${dun}|${rotatieSig(doc)}`;
}

function rotatieSig(doc) {
  const r = doc?.pageRotations || {};
  return Object.keys(r).filter((k) => r[k]).sort().map((k) => `${k}:${r[k]}`).join(',');
}

// ── De echte viewer een stand laten aannemen (paneelwissel) ───────────────

async function zetLiveStand(doc, s) {
  if (!s || getActiveDocument() !== doc) return;
  const c = byId('pdf-container');
  const n = doc.pdfDoc?.numPages || 1;
  const vanModus = S.modusVan(doc);
  const doelModus = s.modus || 'single';
  const oudeRotatie = S.normaliseerRotatie(doc.viewRotation);
  const rotatieAnders = oudeRotatie !== S.normaliseerRotatie(s.viewRotation);
  const schaalAnders = Math.abs((doc.scale || 0) - (s.scale || 0)) > 1e-6;
  doc.viewRotation = S.normaliseerRotatie(s.viewRotation);
  doc.currentPage = S.klemPagina(s.page, n);
  if (s.vp) {
    // Alvast de zoom en verschuiving: setPage() houdt die bij een
    // paginawissel binnen hetzelfde document vast, zodat er geen frame met
    // de zoom van het andere paneel te zien is.
    if (viewport.filePath === doc.filePath) {
      viewport.zoom = s.vp.zoom;
      viewport.offsetX = s.vp.offsetX;
      viewport.offsetY = s.vp.offsetY;
    }
  } else {
    doc.scale = s.scale;
  }

  if (doelModus !== vanModus) {
    await setViewMode(doelModus);
  } else if (doelModus === 'single') {
    await renderPage(doc.currentPage);
  } else if (doelModus === 'facing' || schaalAnders || rotatieAnders) {
    await renderContinuous(true);
  }
  if (getActiveDocument() !== doc) return;

  if (s.vp && liveViewportToont(doc)) {
    const nu = viewportCanvasMaat();
    const g = viewportGeometrie({ ...s.vp, viewRotation: doc.viewRotation });
    const w = S.pasViewportAanMaat(s.vp, { cssW: s.cssW, cssH: s.cssH }, nu, { w: g.schermBreedte, h: g.schermHoogte });
    zetViewportStand(w);
  } else if (c) {
    c.scrollLeft = s.scrollLeft || 0;
    c.scrollTop = s.scrollTop || 0;
  }
  if (rotatieAnders && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WEERGAVE_GEDRAAID));
  import('../../ui/panels/left-panel.js').then((m) => m.updateActiveThumbnail?.()).catch(() => {});
}

// ── Synchroon scrollen en zoomen ──────────────────────────────────────────

function waarnemingLive(doc) {
  if (!doc) return null;
  if (liveViewportToont(doc)) {
    return { soort: 'viewport', pagina: viewport.pageNum, zoom: viewport.zoom, x: viewport.offsetX, y: viewport.offsetY };
  }
  const c = byId('pdf-container');
  return { soort: 'layout', pagina: 0, zoom: doc.scale, x: c ? c.scrollLeft : 0, y: c ? c.scrollTop : 0 };
}

function syncVanLive() {
  if (_wisselBezig) return;
  const doc = getActiveDocument();
  const st = splitStaatVan(doc);
  const nu = waarnemingLive(doc);
  if (st?.sync && _zichtbaar) {
    const delta = S.syncDelta(_syncBasis, nu);
    if (delta) {
      const pane = byId('split-pane');
      const W = pane?.clientWidth || 0;
      const H = pane?.clientHeight || 0;
      if (W > 0 && H > 0) {
        const huidig = bijgewerkteStand(doc, st.stand, W, H);
        _staten.set(doc.id, { ...st, stand: S.pasSyncToe(huidig, delta, { cssW: W, cssH: H }) });
        planTekenen();
      }
    }
  }
  _syncBasis = nu;
}

// ── Wiel boven het tweede paneel ──────────────────────────────────────────

function wielDelta(e, H) {
  const f = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
  let dx = (e.deltaX || 0) * f;
  let dy = (e.deltaY || 0) * f;
  if (e.shiftKey && !dx) { dx = dy; dy = 0; }
  return { dx, dy, stap: e.deltaMode !== 0 || Math.abs(e.deltaY || 0) >= 50 };
}

function opWiel(e) {
  e.preventDefault();
  e.stopPropagation();
  const doc = getActiveDocument();
  const st = splitStaatVan(doc);
  const pane = byId('split-pane');
  if (!st || !_zichtbaar || !pane || !doc?.pdfDoc) return;
  const W = pane.clientWidth;
  const H = pane.clientHeight;
  const zoomen = e.ctrlKey || e.metaKey || !!state.preferences?.wheelZoomWithoutCtrl;
  const richting = (e.deltaY || 0) < 0 ? 1 : -1;
  const { dx, dy, stap } = wielDelta(e, H);

  if (st.sync) {
    // Met Sync beweegt de echte viewer; het tweede paneel volgt via
    // syncVanLive (één richting, dus geen terugkoppeling).
    stuurNaarLive(doc, { zoomen, richting, dx, dy, stap });
    return;
  }

  const r = pane.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  let s = bijgewerkteStand(doc, st.stand, W, H);
  if (zoomen) {
    if (!e.deltaY) return;
    const huidig = s.vp ? s.vp.zoom : s.scale;
    const doel = nextScaleStep(huidig, richting);
    if (!(doel > 0) || doel === huidig) return;
    const factor = doel / huidig;
    if (s.vp) s = { ...s, vp: S.zoomViewportRond(s.vp, factor, px, py), scale: doel };
    else s = S.zoomLayoutStand(s, factor, px, py, { breedte: W, cssW: W, cssH: H, maatVan: (p, schaal) => layoutMaat(doc, p, s.viewRotation, schaal) });
  } else if (s.vp) {
    // Zoals de viewer zelf: alleen schuiven op een as waar de pagina niet
    // in het paneel past.
    const g = viewportGeometrie(s.vp);
    const schuifX = g.schermBreedte * s.vp.zoom > W + 0.5 ? dx : 0;
    const schuifY = g.schermHoogte * s.vp.zoom > H + 0.5 ? dy : 0;
    if (!schuifX && !schuifY) return;
    s = { ...s, vp: S.verschuifViewport(s.vp, schuifX, schuifY) };
  } else {
    s = { ...s, ...S.klemScroll(s.layout, (s.scrollLeft || 0) + dx, (s.scrollTop || 0) + dy, W, H) };
  }
  _staten.set(doc.id, { ...st, stand: s });
  planTekenen();
}

function stuurNaarLive(doc, { zoomen, richting, dx, dy, stap }) {
  const c = byId('pdf-container');
  if (liveViewportToont(doc)) {
    if (zoomen) {
      const m = viewportCanvasMaat();
      zoomStepAtPoint(m.cssW / 2, m.cssH / 2, richting);
    } else {
      wielPanViewport(dx, dy, stap);
    }
    return;
  }
  if (!c) return;
  if (zoomen) {
    if (doc.viewMode === 'continuous' && doc.scale > 0) {
      const doel = nextScaleStep(doc.scale, richting);
      continuousZoomBy(doel / doc.scale, c.clientHeight / 2, c.clientWidth / 2);
    }
    return;
  }
  c.scrollLeft += dx;
  c.scrollTop += dy;
}

// ── Scheidingslijn ────────────────────────────────────────────────────────

function koppelScheiding(scheiding) {
  let slepen = false;
  let raf = 0;
  let laatste = null;
  const host = () => byId('split-host');
  scheiding.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !_zichtbaar) return;
    e.preventDefault();
    e.stopPropagation();
    slepen = true;
    // Blijft opgelicht zolang er gesleept wordt, ook buiten het grijpvlak.
    scheiding.classList.add('split-divider-slepen');
    try { scheiding.setPointerCapture(e.pointerId); } catch { /* oudere webview */ }
  });
  scheiding.addEventListener('pointermove', (e) => {
    if (!slepen) return;
    laatste = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const h = host();
      const st = splitStaatVan();
      if (!h || !st || !laatste) return;
      const r = h.getBoundingClientRect();
      const v = st.richting === 'horizontal'
        ? (laatste.clientY - r.top) / (r.height || 1)
        : (laatste.clientX - r.left) / (r.width || 1);
      zetSplitVerhouding(v);
    });
  });
  const stop = (e) => {
    if (!slepen) return;
    slepen = false;
    scheiding.classList.remove('split-divider-slepen');
    try { scheiding.releasePointerCapture(e.pointerId); } catch { /* al los */ }
  };
  scheiding.addEventListener('pointerup', stop);
  scheiding.addEventListener('pointercancel', stop);
  scheiding.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zetSplitVerhouding(0.5);
  });
}

// ── Na paginabewerkingen ──────────────────────────────────────────────────

function naPaginaStructuur(doc, pageMapping, numPages) {
  const st = doc ? _staten.get(doc.id) : null;
  if (!st?.stand) return;
  const s = S.kopieerStand(st.stand);
  const oud = s.page;
  const nieuw = S.paginaNaStructuur(oud, pageMapping, numPages);
  s.page = nieuw;
  s.bevroren = null;
  if (s.vp) {
    s.vp.tile = null;
    s.vp.tileMeta = null;
    // Bleef de pagina zelf bestaan (alleen een ander nummer), dan houdt het
    // paneel zijn zoom en uitsnede. De paginamaten onder de nieuwe nummers
    // zijn tot vernieuwPaginaMaten klaar is nog die van vóór de bewerking.
    if (pageMapping && pageMapping[oud] != null) s.vp.pageNum = nieuw;
    s.matenVerouderd = true;
  }
  if (s.layout) {
    s.ruimtes = S.meetRuimtes(s.layout.rects);
    s.onder = s.layout.onder;
    s.layout = null;
    s.naarPagina = nieuw;
  }
  _staten.set(doc.id, { ...st, stand: s });
  // Paginamaten van pagina's die van plaats wisselden zijn verouderd.
  const paginas = s.modus === 'single' ? [nieuw] : Array.from({ length: numPages || 0 }, (_, i) => i + 1);
  vernieuwPaginaMaten(doc, paginas);
  planTekenen();
}

function vernieuwPaginaMaten(doc, paginas) {
  const pdfDoc = doc?.pdfDoc;
  if (!pdfDoc || !paginas.length) return;
  (async () => {
    for (const p of paginas) {
      if (doc.pdfDoc !== pdfDoc) return;
      try {
        const page = await pdfDoc.getPage(p);
        const [x0, y0, x1, y1] = page.view;
        if (!doc.pageDims) doc.pageDims = {};
        doc.pageDims[p] = { widthPt: x1 - x0, heightPt: y1 - y0, offsetXPt: x0, offsetYPt: y0, rotation: page.rotate || 0 };
      } catch { /* pagina bestaat niet meer */ }
    }
    const st = _staten.get(doc.id);
    if (st?.stand?.matenVerouderd) _staten.set(doc.id, { ...st, stand: { ...st.stand, matenVerouderd: false } });
    planTekenen();
  })();
}

function vraagPaginaMaat(doc, page) {
  const sleutel = `${doc.id}|${page}`;
  if (_matenAanvragen.has(sleutel) || !doc.pdfDoc) return;
  _matenAanvragen.add(sleutel);
  doc.pdfDoc.getPage(page).then((pg) => {
    const [x0, y0, x1, y1] = pg.view;
    if (!doc.pageDims) doc.pageDims = {};
    doc.pageDims[page] = { widthPt: x1 - x0, heightPt: y1 - y0, offsetXPt: x0, offsetYPt: y0, rotation: pg.rotate || 0 };
    planTekenen();
  }).catch(() => {}).finally(() => { _matenAanvragen.delete(sleutel); });
}

// ── Het tweede paneel tekenen ─────────────────────────────────────────────

function planTekenen() {
  if (_gepland || typeof requestAnimationFrame === 'undefined') return;
  _gepland = requestAnimationFrame(() => { _gepland = 0; tekenSpiegelNu(); });
}

function kenmerkNu() {
  const doc = getActiveDocument();
  if (!doc) return { beeld: '', inhoud: '' };
  const c = byId('pdf-container');
  const beeld = liveViewportToont(doc)
    ? `${viewport.pageNum}|${viewport.zoom}|${viewport.offsetX}|${viewport.offsetY}`
    : `${doc.scale}|${c ? c.scrollLeft : 0}|${c ? c.scrollTop : 0}`;
  const sel = doc.selectedAnnotations || [];
  const inhoud = `${doc.annotations?.length || 0}|${sel.length}|${sel.map((a) => a?.id).join(',')}|${doc.undoStack?.length || 0}|${doc.redoStack?.length || 0}|${doc.textEdits?.length || 0}`;
  return { beeld, inhoud };
}

// Paginamaat van pagina p zoals hij in een doorlopende weergave op schaal
// `schaal` en weergaverotatie `rot` op het scherm staat (CSS-px).
function layoutMaat(doc, p, rot, schaal) {
  const m = paginaMaat(p, doc);
  if (!m) { vraagPaginaMaat(doc, p); return null; }
  const v = weergaveMaat(m.breedte, m.hoogte, rot);
  return { w: v.breedte * schaal, h: v.hoogte * schaal };
}

// Maat in de viewport-zin (na de eigen /Rotate, vóór de paginarotatie).
function vpMaat(doc, page) {
  const d = doc.pageDims?.[page];
  if (!(d?.widthPt > 0 && d?.heightPt > 0)) return null;
  const draai = ((d.rotation || 0) % 360 + 360) % 360;
  const wissel = draai === 90 || draai === 270;
  return {
    pageW: wissel ? d.heightPt : d.widthPt,
    pageH: wissel ? d.widthPt : d.heightPt,
    originX: d.offsetXPt || 0,
    originY: d.offsetYPt || 0,
  };
}

function verwachtePaginas(doc, s) {
  const n = doc.pdfDoc?.numPages || 1;
  if (s.modus === 'facing') return S.spreadPaginas(s.page, n);
  if (s.modus === 'continuous' || s.modus === 'book') return Array.from({ length: n }, (_, i) => i + 1);
  return [S.klemPagina(s.page, n)];
}

function zelfdePaginas(rects, paginas) {
  if (!rects || rects.length !== paginas.length) return false;
  const a = rects.map((r) => r.page).sort((x, y) => x - y);
  return a.every((p, i) => p === paginas[i]);
}

/** De stand aangepast aan het paneel en aan het document zoals het nu is. */
function bijgewerkteStand(doc, stand, W, H) {
  const s = S.kopieerStand(stand);
  const n = doc.pdfDoc?.numPages || 1;
  s.page = S.klemPagina(s.page, n);
  if (s.vp) {
    const maat = s.matenVerouderd ? null : vpMaat(doc, s.page);
    const rot = ((doc.pageRotations?.[s.page] || 0) % 360 + 360) % 360;
    let refit = false;
    if (maat) {
      refit = s.vp.pageNum !== s.page || Math.abs(s.vp.pageW - maat.pageW) > 0.01
        || Math.abs(s.vp.pageH - maat.pageH) > 0.01 || (s.vp.rotation || 0) !== rot;
      s.vp = { ...s.vp, ...maat, pageNum: s.page, rotation: rot };
    } else if (!s.matenVerouderd) {
      vraagPaginaMaat(doc, s.page);
    }
    if (S.normaliseerRotatie(s.vp.viewRotation) !== S.normaliseerRotatie(s.viewRotation)) refit = true;
    s.vp.viewRotation = S.normaliseerRotatie(s.viewRotation);
    const g = viewportGeometrie(s.vp);
    if (refit) {
      // Zoals de viewer bij een paginawissel of -rotatie: opnieuw passend.
      const fit = S.passendInPaneel(g.schermBreedte, g.schermHoogte, W, H);
      if (fit) s.vp = { ...s.vp, ...fit, verankerd: false, strikt: false };
      s.vp.tile = null;
      s.vp.tileMeta = null;
    } else {
      s.vp = S.pasViewportAanMaat(s.vp, { cssW: s.cssW, cssH: s.cssH }, { cssW: W, cssH: H }, { w: g.schermBreedte, h: g.schermHoogte });
    }
    if (s.vp.tile && s.vp.tileBestand !== doc.filePath) { s.vp.tile = null; s.vp.tileMeta = null; }
    s.scale = s.vp.zoom;
  } else {
    const paginas = verwachtePaginas(doc, s);
    const maatVan = (p) => layoutMaat(doc, p, s.viewRotation, s.scale);
    const ongewijzigd = s.layout?.gemeten && zelfdePaginas(s.layout.rects, paginas)
      && Math.abs((s.layout.scale || 0) - s.scale) < 1e-6
      && s.layout.viewRotation === S.normaliseerRotatie(s.viewRotation)
      && s.layout.rotaties === rotatieSig(doc)
      && Math.abs((s.cssW || 0) - W) < 0.5;
    if (ongewijzigd) {
      // Precies zoals gemeten: de bevroren beeldopname en de annotaties
      // vallen dan exact samen.
    } else if (s.layout && zelfdePaginas(s.layout.rects, paginas)) {
      s.layout = { ...S.herschikLayout(s.layout, { schaal: s.scale, breedte: W, maatVan }), gemeten: false, viewRotation: S.normaliseerRotatie(s.viewRotation) };
    } else {
      const ruimtes = s.ruimtes || (s.layout ? S.meetRuimtes(s.layout.rects) : { pad: 20, gat: 40 });
      const lijst = paginas.map((p) => {
        const m = maatVan(p) || { w: 612 * s.scale, h: 792 * s.scale };
        return { page: p, ...m };
      });
      s.layout = {
        ...S.bouwKolomLayout(lijst, { schaal: s.scale, breedte: W, pad: ruimtes.pad, gat: ruimtes.gat, onder: s.onder ?? s.layout?.onder ?? 20 }),
        gemeten: false,
        viewRotation: S.normaliseerRotatie(s.viewRotation),
      };
      if (s.naarPagina) {
        Object.assign(s, S.scrollNaarPagina(s, s.naarPagina));
        s.naarPagina = null;
      }
    }
    Object.assign(s, S.klemScroll(s.layout, s.scrollLeft, s.scrollTop, W, H));
    if (s.modus !== 'single') s.page = S.paginaInBeeld(s.layout, s.scrollLeft, s.scrollTop, W, H) || s.page;
  }
  if (!(Math.abs((s.cssW || 0) - W) < 0.5 && Math.abs((s.cssH || 0) - H) < 0.5)) s.bevroren = null;
  s.cssW = W;
  s.cssH = H;
  return s;
}

// Waar de pagina's van een stand in het paneel liggen: per pagina de
// oorsprong (tx, ty) in CSS-px, de schaal z, de paginaruimte (pw×ph punten),
// de schermmaat (sw×sh punten) en de weergaverotatie als matrix.
function plaatsingenVan(doc, s, W, H) {
  if (s.vp) {
    const g = viewportGeometrie(s.vp);
    return [{
      page: s.vp.pageNum,
      tx: s.vp.offsetX,
      ty: s.vp.offsetY,
      z: s.vp.zoom,
      pw: g.paginaBreedte,
      ph: g.paginaHoogte,
      sw: g.schermBreedte,
      sh: g.schermHoogte,
      weergave: g.rotatie ? weergaveMatrix(g.paginaBreedte, g.paginaHoogte, g.rotatie) : null,
      rotatie: s.vp.rotation || 0,
    }];
  }
  const rot = S.normaliseerRotatie(s.viewRotation);
  return S.zichtbarePaginas(s.layout, s.scrollLeft, s.scrollTop, W, H).map((r) => {
    const m = paginaMaat(r.page, doc);
    const pw = m ? m.breedte : r.w / (s.scale || 1);
    const ph = m ? m.hoogte : r.h / (s.scale || 1);
    const v = weergaveMaat(pw, ph, rot);
    return {
      page: r.page,
      tx: r.x,
      ty: r.y,
      z: v.breedte > 0 ? r.w / v.breedte : s.scale,
      pw,
      ph,
      sw: v.breedte,
      sh: v.hoogte,
      weergave: rot ? weergaveMatrix(pw, ph, rot) : null,
      rotatie: ((doc.pageRotations?.[r.page] || 0) % 360 + 360) % 360,
    };
  });
}

function canvassenVan(pane, W, H, dpr) {
  let pdf = pane.querySelector('canvas.split-pane-pdf');
  let ann = pane.querySelector('canvas.split-pane-ann');
  if (!pdf || !ann) return null;
  const bw = Math.max(1, Math.round(W * dpr));
  const bh = Math.max(1, Math.round(H * dpr));
  for (const c of [pdf, ann]) {
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    const sw = `${W}px`;
    const sh = `${H}px`;
    if (c.style.width !== sw) c.style.width = sw;
    if (c.style.height !== sh) c.style.height = sh;
  }
  return { pdf, ann };
}

function tekenSpiegelNu() {
  if (!_zichtbaar) return;
  const doc = getActiveDocument();
  const st = splitStaatVan(doc);
  const pane = byId('split-pane');
  if (!st?.stand || !pane || !doc?.pdfDoc) return;
  const W = pane.clientWidth;
  const H = pane.clientHeight;
  if (!(W > 0 && H > 0)) return;
  const dpr = window.devicePixelRatio || 1;
  const doeken = canvassenVan(pane, W, H, dpr);
  if (!doeken) return;
  const stand = bijgewerkteStand(doc, st.stand, W, H);
  _staten.set(doc.id, { ...st, stand });
  const plaatsingen = plaatsingenVan(doc, stand, W, H);
  laadAnnotatiesVoor(doc, plaatsingen);
  _tekenBezig = true;
  try {
    tekenPaginaLaag(doc, stand, plaatsingen, doeken.pdf, W, H, dpr);
    tekenAnnotatieLaag(doc, stand, plaatsingen, doeken.ann, W, H, dpr);
  } catch (e) {
    console.warn('[split-view] tekenen van het tweede paneel mislukt:', e);
  } finally {
    _tekenBezig = false;
  }
}

// Annotaties worden per pagina geladen als die voor het eerst getekend
// wordt; het tweede paneel kan een pagina tonen die de viewer nog nooit had.
function laadAnnotatiesVoor(doc, plaatsingen) {
  const geladen = doc._loadedAnnotationPages;
  if (!geladen || typeof geladen.has !== 'function') return;
  const nodig = plaatsingen.map((p) => p.page).filter((p) => !geladen.has(p));
  if (!nodig.length) return;
  import('../loader.js').then(async (m) => {
    for (const p of nodig) {
      try { await m.ensureAnnotationsForPage(p, doc); } catch { /* volgende keer opnieuw */ }
    }
    planTekenen();
  }).catch(() => {});
}

// Per plaatsing het beste paginabeeld (zie paneel-bitmaps.js: budget en
// claims, zodat het paneel de bitmap van de viewer niet verdringt en niet in
// een renderlus komt).
function paginaBeelden(doc, plaatsingen, W, H, dpr) {
  if (heeftRustRenderer() && doc.filePath) {
    return paneelBitmaps(plaatsingen, { filePath: doc.filePath, dpr, W, H, opKlaar: planTekenen });
  }
  // Webversie en documenten zonder pad: PDF.js tekent de pagina.
  return paneelPdfjsBeelden(doc, plaatsingen, { dpr, W, H, opKlaar: planTekenen });
}

// De kleur rond de pagina's in het tweede paneel: de eigen kleur van de
// gebruiker (#859), anders wat de viewer toonde toen het paneel zijn stand
// kreeg (het lichtgrijs van het viewportcanvas, of het thema rond doorlopende
// pagina's).
function paneelAchtergrond(s) {
  return eigenAchtergrond() || (s?.vp ? achtergrondKleur() : (s?.achtergrond || achtergrondKleur()));
}

function tekenPaginaLaag(doc, s, plaatsingen, doek, W, H, dpr) {
  const ctx = doek.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Per pagina de beste bitmap; zolang die er niet allemaal scherp zijn,
  // toont het paneel de bevroren opname van de wissel (als die nog klopt).
  const beelden = paginaBeelden(doc, plaatsingen, W, H, dpr);
  const allesScherp = beelden.every((b) => b.exact);
  const sleutel = S.beeldSleutel(s, { filePath: doc.filePath, cssW: W, cssH: H, extra: beeldExtra(doc) });
  if (s.bevroren && s.bevroren.sleutel === sleutel && !allesScherp) {
    ctx.clearRect(0, 0, doek.width, doek.height);
    ctx.drawImage(s.bevroren.beeld, 0, 0, doek.width, doek.height);
    return;
  }
  ctx.fillStyle = paneelAchtergrond(s);
  ctx.fillRect(0, 0, doek.width, doek.height);
  plaatsingen.forEach((p, i) => {
    const m = vermenigvuldig([p.z, 0, 0, p.z, p.tx, p.ty], p.weergave || [1, 0, 0, 1, 0, 0]);
    ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, p.pw, p.ph);
    const b = beelden[i].beeld;
    if (b && b.width > 0) {
      try {
        const verkleinen = p.pw * p.z * dpr < b.width;
        if (verkleinen) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(b, 0, 0, p.pw, p.ph);
        ctx.imageSmoothingQuality = 'low';
      } catch { /* bitmap net uit de cache gehaald */ }
    }
    const vp = s.vp;
    if (vp && vp.tile && vp.tileMeta && vp.tile.width > 0) {
      const t = vp.tileMeta;
      try { ctx.drawImage(vp.tile, t.regionXpt, t.regionYpt, t.regionWpt, t.regionHpt); } catch { /* gesloten */ }
    }
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// De zoom en weergaverotatie van het tweede paneel voor de annotatietekenaar
// (die lijndiktes, grepen en arceringen op schermmaat uit de schermschaal en
// de rotatie van het document haalt), alleen tijdens deze synchrone
// tekenbeurt. Niet op het document zelf: dat is een Solid-store en elke
// tijdelijke wijziging liet afhankelijke berekeningen opnieuw draaien (zie
// paneel-weergave.js). viewport.zoom is geen reactieve waarde en staat terug
// voordat er iets anders draait.
function metPaneelWeergave(doc, zoom, rotatie, fn) {
  const oudeZoom = viewport.zoom;
  try {
    viewport.zoom = zoom;
    metPaneelStand(doc, { schaal: zoom, rotatie }, fn);
  } finally {
    viewport.zoom = oudeZoom;
  }
}

function tekenAnnotatieLaag(doc, s, plaatsingen, doek, W, H, dpr) {
  const ctx = doek.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, doek.width, doek.height);
  if (!plaatsingen.length) return;
  const rotatie = S.normaliseerRotatie(s.viewRotation);
  metPaneelWeergave(doc, plaatsingen[0].z, rotatie, () => {
    for (const p of plaatsingen) {
      const vak = S.zichtbaarVak(p.tx, p.ty, p.sw * p.z, p.sh * p.z, W, H);
      if (!vak) continue;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, Math.round(vak.x * dpr), Math.round(vak.y * dpr));
      try {
        renderAnnotationsForPage(
          ctx, p.page,
          Math.ceil(vak.w * dpr), Math.ceil(vak.h * dpr),
          dpr * (p.z / (plaatsingen[0].z || 1)),
          { x: (vak.x - p.tx) / p.z, y: (vak.y - p.ty) / p.z },
          { w: p.sw, h: p.sh },
          undefined,
          p.weergave,
        );
      } catch (e) {
        console.warn('[split-view] annotaties van pagina', p.page, 'niet getekend:', e);
      }
      ctx.restore();
    }
  });
}

// Voor tests en de MCP-brug: wat toont welk paneel?
export function splitOverzicht(doc = getActiveDocument()) {
  const st = splitStaatVan(doc);
  if (!st) return null;
  const live = doc ? { page: doc.currentPage, scale: doc.scale, modus: S.modusVan(doc) } : null;
  const ander = st.stand ? { page: st.stand.page, scale: st.stand.vp ? st.stand.vp.zoom : st.stand.scale, modus: st.stand.modus } : null;
  return {
    richting: st.richting,
    actief: st.actief,
    verhouding: st.verhouding,
    sync: st.sync,
    panelen: st.actief === 0 ? [live, ander] : [ander, live],
  };
}
