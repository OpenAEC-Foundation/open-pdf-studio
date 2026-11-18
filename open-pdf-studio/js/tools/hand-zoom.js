// Zoomen met het hand-gereedschap (#1161): bedrading.
//
// Het gedrag staat in hand-zoom-beleid.js. Hier de luisteraars (capture-fase
// op window, zodat ze het gebaar zien vóór de pan van de hand), het echte
// zoomen in de drie weergaven en de zoomrechthoek op het scherm.
//
// Het pannen zelf blijft waar het was (pan-handler.js en pdf-viewport.js):
// deze module kijkt alleen mee. Een klik zoomt pas bij het loslaten, en een
// Ctrl + sleep neemt de pan over die de hand net begon.

import { state, getActiveDocument } from '../core/state.js';
import { interactionState } from '../core/stores/interaction-store.js';
import { nextScaleStep } from '../core/zoom-display.js';
import { getDialogs } from '../bridge.js';
import { isModalOpen } from './tool-context.js';
import { breekPanAf } from './pan-handler.js';
import {
  viewport, breekViewportPanAf, zoomStepAtPoint, zetViewportStand,
  viewportCanvasMaat, stopPanMomentum, ZOOM_STEPS,
} from '../pdf/pdf-viewport.js';
import { isPresentatie } from '../ui/chrome/presentatie.js';
import {
  maakHandZoomHandlers, zoomVoorRechthoek, viewportStandVoorRechthoek,
} from './hand-zoom-beleid.js';

// Zoomgrenzen van de scrollende weergaven (zelfde als continuousZoomBy).
const SCROLL_ZOOM_MIN = 0.05;
const SCROLL_ZOOM_MAX = 24;

const RECHTHOEK_ID = 'hand-zoom-rechthoek';

const isMac = () => typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

// De vector-viewport tekent dit document (zelfde toets als het muiswiel).
const viewportActief = (doc) => !!(viewport.active && doc?.filePath);

function zoomStap(x, y, richting) {
  const doc = getActiveDocument();
  if (!doc) return;
  stopPanMomentum();
  if (viewportActief(doc)) {
    const r = document.getElementById('pdf-canvas')?.getBoundingClientRect();
    if (r) zoomStepAtPoint(x - r.left, y - r.top, richting);
    return;
  }
  // Dynamisch: renderer.js trekt de hele render-keten mee.
  import('../pdf/renderer.js').then(async (m) => {
    if (getActiveDocument() !== doc) return;
    if (doc.viewMode === 'continuous') {
      const c = document.getElementById('pdf-container')?.getBoundingClientRect();
      if (!c) return;
      m.continuousZoomBy(nextScaleStep(doc.scale, richting) / doc.scale, y - c.top, x - c.left);
      return;
    }
    if (richting > 0) await m.zoomIn({ x, y }); else await m.zoomOut({ x, y });
  }).catch((err) => console.warn('[hand-zoom] zoomen mislukt:', err));
}

function zoomRechthoek(r) {
  const doc = getActiveDocument();
  if (!doc) return;
  stopPanMomentum();
  if (viewportActief(doc)) {
    const c = document.getElementById('pdf-canvas')?.getBoundingClientRect();
    if (!c) return;
    const { cssW, cssH } = viewportCanvasMaat();
    const stand = viewportStandVoorRechthoek({
      rechthoek: { x: r.x - c.left, y: r.y - c.top, w: r.w, h: r.h },
      canvasW: cssW,
      canvasH: cssH,
      zoom: viewport.zoom,
      offsetX: viewport.offsetX,
      offsetY: viewport.offsetY,
      min: ZOOM_STEPS[0],
      max: ZOOM_STEPS[ZOOM_STEPS.length - 1],
    });
    if (stand) zetViewportStand({ ...stand, verankerd: true });
    return;
  }
  const container = document.getElementById('pdf-container');
  if (!container) return;
  const c = container.getBoundingClientRect();
  const links = c.left + container.clientLeft;
  const boven = c.top + container.clientTop;
  const z = zoomVoorRechthoek({
    rechthoek: { x: r.x - links, y: r.y - boven, w: r.w, h: r.h },
    beeldW: container.clientWidth,
    beeldH: container.clientHeight,
    zoom: doc.scale,
    min: SCROLL_ZOOM_MIN,
    max: SCROLL_ZOOM_MAX,
  });
  if (!z) return;
  import('../pdf/renderer.js').then(async (m) => {
    if (getActiveDocument() !== doc) return;
    if (doc.viewMode === 'continuous') {
      m.continuousZoomBy(z.factor, z.ankerY + container.clientTop, z.ankerX + container.clientLeft);
    } else {
      await m.zoomEnkelePaginaNaar(z.zoom, { x: links + z.ankerX, y: boven + z.ankerY });
      if (getActiveDocument() !== doc) return;
    }
    // Het midden van de rechthoek staat nog op zijn plek; naar het midden
    // van het beeld schuiven (de browser begrenst op de scrollranden).
    container.scrollLeft += z.schuifX;
    container.scrollTop += z.schuifY;
  }).catch((err) => console.warn('[hand-zoom] zoomrechthoek mislukt:', err));
}

// De rechthoek is een los element boven de weergave: vaste positie in
// client-coördinaten, laat alle muisgebeurtenissen door en verandert de
// cursor niet. Kleuren uit het thema (styles/layout.css).
function toonRechthoek(r) {
  let el = document.getElementById(RECHTHOEK_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = RECHTHOEK_ID;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
  el.style.display = 'block';
}

function verbergRechthoek() {
  const el = document.getElementById(RECHTHOEK_ID);
  if (el) el.style.display = 'none';
}

function breekHandPanAf() {
  breekViewportPanAf();
  breekPanAf();
}

let _geinstalleerd = false;

export function installeerHandZoom() {
  if (_geinstalleerd) return;
  _geinstalleerd = true;
  const h = maakHandZoomHandlers({
    actief: () => state.currentTool === 'hand'
      && !!getActiveDocument()?.pdfDoc
      && !interactionState.spacePanHeld
      && !isPresentatie()
      && !isModalOpen() && getDialogs().length === 0
      && !state.isEditingText && !state.pdfTextEditState,
    handPanLoopt: () => !!state.isPanning && !state.isMiddleButtonPanning,
    breekPanAf: breekHandPanAf,
    klikZoomAan: () => state.preferences?.handClickZoom === true,
    ctrl: (e) => (isMac() ? !!e.metaKey : !!e.ctrlKey),
    zoomStap,
    zoomRechthoek,
    toonRechthoek,
    verbergRechthoek,
  });
  window.addEventListener('pointerdown', h.onPointerDown, { capture: true });
  window.addEventListener('pointermove', h.onPointerMove, { capture: true, passive: true });
  window.addEventListener('pointerup', h.onPointerUp, { capture: true });
  window.addEventListener('pointercancel', h.onPointerCancel, { capture: true });
  window.addEventListener('keydown', h.onKeyDown, { capture: true });
  // Venster kwijt of pagina verborgen: het gebaar is voorbij (zie #1013).
  window.addEventListener('blur', h.reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) h.reset(); });
}
