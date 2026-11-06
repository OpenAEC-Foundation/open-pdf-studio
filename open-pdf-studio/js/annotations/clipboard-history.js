// Klembordgeschiedenis (#929): elke markeringskopie van deze sessie, getoond
// in het Klembord-venster naast de gereedschapspalet (ClipboardHistory.jsx).
// Een item aanklikken maakt het het huidige interne klembord, zodat de
// volgende Ctrl+V (bij de muis, clipboard.js) het plakt. Alleen deze sessie:
// er wordt niets opgeslagen.
import { createSignal } from 'solid-js';
import { state } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { annotationBounds } from './spatial-index.js';
import { drawAnnotation } from './rendering.js';
import { omhullendKader } from './plak-bij-muis.js';
import { voegToe, verwijder, omschrijving } from './klembord-lijst.js';

const [items, setItems] = createSignal([]);
const [activeId, setActiveId] = createSignal(null);
let _volg = 0;

export { items as clipboardHistory, activeId as clipboardHistoryActive };

// Kleine afbeelding van de gekopieerde markeringen: getekend uit de
// markeringen zelf, geen schermafdruk, dus zonder selectiegrepen.
const MINI_B = 112, MINI_H = 72, MINI_RAND = 6;
function miniatuur(annotaties) {
  if (typeof document === 'undefined') return null;
  try {
    const kader = omhullendKader(annotaties.map(a => annotationBounds(a)));
    if (!kader) return null;
    const w = Math.max(1, kader.width), h = Math.max(1, kader.height);
    const k = Math.min((MINI_B - MINI_RAND * 2) / w, (MINI_H - MINI_RAND * 2) / h);
    const c = document.createElement('canvas');
    c.width = MINI_B * 2; c.height = MINI_H * 2;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.scale(2, 2);
    ctx.translate(MINI_B / 2 - (kader.x + w / 2) * k, MINI_H / 2 - (kader.y + h / 2) * k);
    ctx.scale(k, k);
    for (const a of annotaties) {
      ctx.save();
      try { drawAnnotation(ctx, { ...a, _ignoreViewFilters: true }); } catch { /* soort zonder tekenroute */ }
      ctx.restore();
    }
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Door copyAnnotation(s) aangeroepen: deze kopie aan de geschiedenis toevoegen. */
export function addToClipboardHistory(annotaties) {
  const kopie = (annotaties || []).filter(Boolean).map(a => cloneAnnotation(a));
  if (!kopie.length) return;
  const id = `clip${++_volg}`;
  const item = {
    id,
    annotations: kopie,
    count: kopie.length,
    label: omschrijving(kopie),
    thumb: miniatuur(kopie),
    at: Date.now(),
  };
  setItems(prev => voegToe(prev, item));
  setActiveId(id);
}

/** Maak een item het huidige klembord; de volgende Ctrl+V plakt het. */
export function useClipboardHistoryItem(id) {
  const item = items().find(i => i.id === id);
  if (!item) return false;
  const kopie = item.annotations.map(a => cloneAnnotation(a));
  if (kopie.length === 1) {
    // Zelfde vorm als copyAnnotation: een enkele markering.
    state.clipboardAnnotation = kopie[0];
    state.clipboardAnnotations = null;
  } else {
    state.clipboardAnnotations = kopie;
    state.clipboardAnnotation = kopie[0];
  }
  // Verser dan het systeemklembord, zodat Ctrl+V dit pakt (keyboard-handlers).
  state._internalCopyAt = Date.now();
  state._pasteSeq = 0;
  setActiveId(id);
  return true;
}

export function removeClipboardHistoryItem(id) {
  setItems(prev => verwijder(prev, id));
  if (activeId() === id) setActiveId(null);
}

export function clearClipboardHistory() {
  setItems([]);
  setActiveId(null);
}
