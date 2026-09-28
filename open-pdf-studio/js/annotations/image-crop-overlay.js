// ============================================================================
// Interactieve bijsnij-overlay voor afbeeldingen.
//
// Geactiveerd vanuit de contextuele "Afbeelding"-ribbon (Croppen). Bijsnijden
// knipt een stuk van de afbeelding af: de rechthoek van de annotatie wordt
// LIVE kleiner terwijl je een greep sleept, de pixels blijven exact op hun
// plek en op dezelfde schaal. De weggesneden rand blijft zolang de modus
// actief is gedimd zichtbaar (het renderpad tekent dan de volledige bron),
// zodat je een greep ook weer naar buiten kunt slepen.
//
// De bijsnijding wordt bewaard als fracties per zijde van de BRON
// (cropLeft/Top/Right/Bottom — dezelfde velden als het eigenschappenpaneel en
// de opgeslagen AP-stream, issue #212) plus de verkleinde rechthoek. De
// geometrie zelf staat in crop-geometrie.js en is los getest.
//
// De overlay hangt eigen pointer-handlers aan het annotatiecanvas en blijft
// zo los van de gereedschaps-dispatcher; het tekenen gebeurt vanuit
// redrawAnnotations() via drawImageCropOverlay().
// ============================================================================

import { state, getActiveDocument } from '../core/state.js';
import { annotationCanvas } from '../ui/dom-elements.js';
import { resolvePointerCoords } from '../tools/tool-context.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { recordPropertyChange } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { fracties, volledigVak, vensterOpVak, fractiesNaSleep, rectNaBijsnijden } from './crop-geometrie.js';
import { weergaveRotatie } from '../pdf/weergave-ruimte.js';

// De annotatie die bijgesneden wordt (null = inactief).
let _cropAnn = null;
// Toestand bij activering (rechthoek + fracties): Escape zet dit terug.
let _snapshot = null;
// Lopende sleep.
let _dragHandle = null; // 'l' | 'r' | 't' | 'b' | 'tl' | 'tr' | 'bl' | 'br'
let _installed = false;

const GREPEN = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function effScale() {
  const doc = getActiveDocument();
  const dpr = window.devicePixelRatio || 1;
  const vp = window.__pdfViewport;
  if (vp && vp.active && doc?.filePath) return vp.zoom;
  return (doc?.scale || 1.5) * dpr;
}

function maakSnapshot(ann) {
  return {
    x: ann.x, y: ann.y, width: ann.width, height: ann.height,
    cropLeft: ann.cropLeft || 0, cropTop: ann.cropTop || 0,
    cropRight: ann.cropRight || 0, cropBottom: ann.cropBottom || 0,
  };
}

const rectVan = (ann) => ({ x: ann.x, y: ann.y, width: ann.width, height: ann.height });

// Greep-middelpunten in app-ruimte (lokaal, ongedraaid frame): de grepen
// liggen op de rechthoek zelf — dat ís het venster.
function handlePoints(ann) {
  const r = rectVan(ann);
  const mx = r.x + r.width / 2, my = r.y + r.height / 2;
  return {
    tl: { x: r.x, y: r.y }, tr: { x: r.x + r.width, y: r.y },
    bl: { x: r.x, y: r.y + r.height }, br: { x: r.x + r.width, y: r.y + r.height },
    t: { x: mx, y: r.y }, b: { x: mx, y: r.y + r.height },
    l: { x: r.x, y: my }, r: { x: r.x + r.width, y: my },
  };
}

// Scherm-PointerEvent → het ongedraaide lokale frame van de annotatie
// (rotatie om het middelpunt van de HUIDIGE rechthoek, net als het renderpad).
function toLocal(e, ann) {
  const c = resolvePointerCoords(e);
  let px = c.x, py = c.y;
  if (ann.rotation) {
    const cx = ann.x + ann.width / 2, cy = ann.y + ann.height / 2;
    const a = -ann.rotation * Math.PI / 180;
    const dx = px - cx, dy = py - cy;
    px = cx + dx * Math.cos(a) - dy * Math.sin(a);
    py = cy + dx * Math.sin(a) + dy * Math.cos(a);
  }
  return { x: px, y: py };
}

function hitHandle(local, ann) {
  const tol = 10 / effScale(); // ~10 schermpixels
  const pts = handlePoints(ann);
  for (const key of GREPEN) {
    const p = pts[key];
    if (Math.abs(local.x - p.x) <= tol && Math.abs(local.y - p.y) <= tol) return key;
  }
  return null;
}

function onPointerDown(e) {
  if (!_cropAnn || e.button !== 0) return;
  const local = toLocal(e, _cropAnn);
  const h = hitHandle(local, _cropAnn);
  if (!h) return;
  e.preventDefault();
  e.stopPropagation();
  _dragHandle = h;
  try { annotationCanvas?.setPointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
}

function onPointerMove(e) {
  if (!_cropAnn) return;
  if (!_dragHandle) {
    const local = toLocal(e, _cropAnn);
    const h = hitHandle(local, _cropAnn);
    if (annotationCanvas) {
      // Bij een kwartslag gedraaide weergave (#200) staat een zijgreep op het
      // scherm andersom: horizontaal wordt verticaal en de diagonalen wisselen.
      const kwart = weergaveRotatie() % 180 !== 0;
      const zij = (h === 'l' || h === 'r') !== kwart ? 'ew-resize' : 'ns-resize';
      const diag = (h === 'tl' || h === 'br') !== kwart ? 'nwse-resize' : 'nesw-resize';
      annotationCanvas.style.cursor = h
        ? ((h === 'l' || h === 'r' || h === 't' || h === 'b') ? zij : diag)
        : 'default';
    }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const ann = _cropAnn;
  const local = toLocal(e, ann);
  // Nieuwe fracties t.o.v. het volledige vak, dan de rechthoek daarop
  // verkleinen/vergroten — pixels blijven staan, ook bij een gedraaide
  // afbeelding (het middelpunt draait mee).
  const f0 = fracties(ann);
  const vak = volledigVak(rectVan(ann), f0);
  const f1 = fractiesNaSleep(vak, f0, _dragHandle, local);
  const nieuw = rectNaBijsnijden(rectVan(ann), vensterOpVak(vak, f1), ann.rotation || 0);
  ann.cropLeft = f1.l; ann.cropTop = f1.t; ann.cropRight = f1.r; ann.cropBottom = f1.b;
  ann.x = nieuw.x; ann.y = nieuw.y; ann.width = nieuw.width; ann.height = nieuw.height;
  redraw();
}

function onPointerUp(e) {
  if (!_dragHandle) return;
  _dragHandle = null;
  try { annotationCanvas?.releasePointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
  const ann = _cropAnn;
  if (ann && _snapshot) {
    const nu = maakSnapshot(ann);
    const changed = Object.keys(nu).some(k => nu[k] !== _snapshot[k]);
    if (changed) {
      // Snapshot even terugzetten zodat recordPropertyChange de toestand van
      // vóór deze sleep vastlegt, en daarna de nieuwe toestand herstellen.
      Object.assign(ann, _snapshot);
      recordPropertyChange(ann);
      Object.assign(ann, nu);
      ann.modifiedAt = new Date().toISOString();
      _snapshot = nu;
      showProperties(ann);
      redraw();
    }
  }
}

function onKeyDown(e) {
  // Enter sluit de modus (de bijsnijding staat al in de annotatie); Escape
  // zet de toestand van bij activering terug. Beide verlaten de modus via de
  // ribbon-store, die terug in stopImageCrop() komt.
  if (e.key === 'Enter') {
    e.preventDefault();
    import('../solid/stores/imageEditStore.js').then(m => m.stopCropMode(true)).catch(() => {});
  } else if (e.key === 'Escape') {
    e.preventDefault();
    herstelSnapshot();
    import('../solid/stores/imageEditStore.js').then(m => m.stopCropMode(false)).catch(() => {});
  }
}

function herstelSnapshot() {
  if (!_cropAnn || !_snapshot) return;
  const ann = _cropAnn;
  const nu = maakSnapshot(ann);
  if (Object.keys(nu).some(k => nu[k] !== _snapshot[k])) {
    recordPropertyChange(ann);
    Object.assign(ann, _snapshot);
    ann.modifiedAt = new Date().toISOString();
    showProperties(ann);
  }
}

function install() {
  if (_installed || !annotationCanvas) return;
  annotationCanvas.addEventListener('pointerdown', onPointerDown, true);
  annotationCanvas.addEventListener('pointermove', onPointerMove, true);
  annotationCanvas.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  _installed = true;
}

function uninstall() {
  if (!_installed) return;
  annotationCanvas?.removeEventListener('pointerdown', onPointerDown, true);
  annotationCanvas?.removeEventListener('pointermove', onPointerMove, true);
  annotationCanvas?.removeEventListener('pointerup', onPointerUp, true);
  document.removeEventListener('keydown', onKeyDown, true);
  if (annotationCanvas) annotationCanvas.style.cursor = '';
  _installed = false;
}

// Publieke API ----------------------------------------------------------------

export function startImageCrop(ann) {
  if (!ann || ann.type !== 'image') return false;
  _cropAnn = ann;
  _snapshot = maakSnapshot(ann);
  state.imageCropMode = true;
  install();
  redraw();
  return true;
}

// De bijsnijding staat tijdens het slepen al in de annotatie; stoppen hoeft
// niets meer in te bakken. De parameter blijft voor de aanroepers bestaan
// (Escape heeft de toestand zelf al teruggezet vóór hij hier komt).
export function stopImageCrop(_commit = true) {
  uninstall();
  _cropAnn = null;
  _snapshot = null;
  _dragHandle = null;
  state.imageCropMode = false;
  redraw();
}

export function isImageCropActive() { return !!_cropAnn; }

/** De annotatie die nu bijgesneden wordt (voor het renderpad), of null. */
export function activeCropAnnotation() { return _cropAnn; }

// Tekent de overlay in de app-ruimte van het annotatiecanvas. Geen effect
// als de modus uit staat of de annotatie niet op de huidige pagina ligt.
export function drawImageCropOverlay(ctx, curPage) {
  const ann = _cropAnn;
  if (!ann) return;
  if (curPage !== undefined && ann.page !== curPage) return;

  const sc = effScale();
  ctx.save();
  if (ann.rotation) {
    const cx = ann.x + ann.width / 2, cy = ann.y + ann.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(ann.rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  const r = rectVan(ann);
  const vak = volledigVak(r, fracties(ann));

  // Weggesneden rand dimmen: alles van het volledige vak buiten de rechthoek.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.rect(vak.x, vak.y, vak.w, vak.h);
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.fill('evenodd');

  // Rand van het venster.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 / sc;
  ctx.setLineDash([]);
  ctx.strokeRect(r.x, r.y, r.width, r.height);

  // Derden-hulplijnen.
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  for (let i = 1; i <= 2; i++) {
    ctx.moveTo(r.x + (r.width * i) / 3, r.y);
    ctx.lineTo(r.x + (r.width * i) / 3, r.y + r.height);
    ctx.moveTo(r.x, r.y + (r.height * i) / 3);
    ctx.lineTo(r.x + r.width, r.y + (r.height * i) / 3);
  }
  ctx.stroke();

  // Grepen — zwarte vierkantjes (~8 schermpixels) met witte rand.
  const hs = 8 / sc;
  const pts = handlePoints(ann);
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 / sc;
  for (const key of GREPEN) {
    const p = pts[key];
    ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
  }

  ctx.restore();
}
