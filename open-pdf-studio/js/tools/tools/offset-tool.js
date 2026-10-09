/**
 * Offset-gereedschap (AutoCAD OFFSET) — parallelle copy van een object.
 *
 * Werking:
 *   1. Selectie (of de ribbon-knop) bepaalt WELK object wordt geoffzet;
 *      zonder selectie pakt de eerste klikbare object de bron.
 *   2. Typ de afstand + Enter (CAD-invoer bij de cursor, in tekeneenheden).
 *   3. Klik de kant: buiten de omtrek = groeien, binnen = krimpen, bij lijnen
 *      = de kant waar je klikt. De bron blijft geselecteerd, dus klikken kan
 *      blijven doorgaan tot je Escape drukt. Klik op een ander object om dat
 *      als nieuwe bron te nemen.
 *
 * De geometrie zit in annotations/offset-geometry.js (puur, getest).
 */
import { state, getActiveDocument } from '../../core/state.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordAdd } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import { getMeasureScale } from '../../annotations/measurement.js';
import i18next from '../../i18n/config.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  typeLengthActive,
  clearTypeLengthBuffer,
} from '../type-length-input.js';
import { offsetProps, canOffset } from '../../annotations/offset-geometry.js';
import { verticesOf } from '../../annotations/stretch-geometry.js';

const _s = {
  sources: null,   // annotaties die worden geoffzet
  distance: null,  // in pagina-pixels
  anchor: null,    // invoeranker (voor de eenheden-omrekening)
  ownsCommit: false,
};

function _t(key, def) {
  return i18next.t(key, { ns: 'ribbon', defaultValue: def });
}

function _bericht(def, key) {
  updateStatusMessage(key ? _t(key, def) : def, 5000);
}

/** Reset de sessie; laat geen invoer of commit-hook achter. */
function _reset() {
  if (_s.ownsCommit) {
    if (typeLengthActive()) exitTypeLengthMode();
    if (state._typeLengthCommit) state._typeLengthCommit = null;
  }
  _s.sources = null;
  _s.distance = null;
  _s.anchor = null;
  _s.ownsCommit = false;
}

/** Bepaal het midden van de bronobjecten (invoeranker + hulptekst). */
function _midden(anns) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const a of anns) {
    for (const p of verticesOf(a)) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Vraag de afstand via de CAD-invoer bij de cursor. */
function _vraagAfstand() {
  const mid = _midden(_s.sources || []);
  _s.anchor = mid || { x: 0, y: 0 };
  enterTypeLengthMode(_s.anchor.x, _s.anchor.y);
  state._typeLengthCommit = _commitAfstand;
  _s.ownsCommit = true;
  _bericht('Offset: type the distance and press Enter (e.g. 100)', 'drawing.offsetDistance');
}

function _commitAfstand(length) {
  if (!length || length <= 0) {
    clearTypeLengthBuffer();
    _bericht('Offset: enter a positive distance, e.g. 100', 'drawing.offsetDistanceInvalid');
    return;
  }
  const page = (_s.sources && _s.sources[0] && _s.sources[0].page)
    || getActiveDocument()?.currentPage || 1;
  const ppu = getMeasureScale(page, _s.anchor.x, _s.anchor.y).pixelsPerUnit || 1;
  _s.distance = length * ppu;
  exitTypeLengthMode();
  state._typeLengthCommit = null;
  _s.ownsCommit = false;
  _bericht('Offset: click the side to place the copy', 'drawing.offsetSide');
}

/** Plaats de offset-copy(s) aan de kant van (x,y). */
function _plaats(ctx, x, y) {
  const doc = getActiveDocument();
  if (!doc || !_s.sources || _s.distance == null) return;
  let ok = 0;
  let nietOndersteund = 0;
  for (const src of _s.sources) {
    const props = offsetProps(src, _s.distance, { x, y });
    if (!props) { nietOndersteund++; continue; }
    const basis = { ...src, ...props };
    delete basis.id;
    delete basis.createdAt;
    const fresh = ctx.createAnnotation(basis);
    fresh.modifiedAt = new Date().toISOString();
    doc.annotations.push(fresh);
    ctx.recordAdd(fresh);
    ok++;
  }
  if (ok > 0) {
    ctx.redraw();
    _bericht('Offset copy created — click again for another copy', 'drawing.offsetPlaced');
  } else if (nietOndersteund > 0) {
    const teGroot = _s.sources.some((s) => !offsetProps(s, _s.distance, { x, y })
      && canOffset(s));
    _bericht(
      teGroot
        ? 'Offset distance is too large for this shape'
        : 'Offset is not supported for this object',
      teGroot ? 'drawing.offsetTooLarge' : 'drawing.offsetUnsupported',
    );
  }
}

/** Start het gereedschap met de huidige selectie als bron (ribbon-knop). */
export async function startOffsetTool() {
  const m = await import('../manager.js');
  m.setTool('offset');
  const sel = getActiveDocument()?.selectedAnnotations || [];
  if (sel.length > 0) {
    _s.sources = sel.slice();
    _vraagAfstand();
  } else {
    _bericht('Offset: click an object to offset', 'drawing.offsetPick');
  }
}

export const offsetTool = {
  name: 'offset',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button === 2) { _reset(); ctx.redraw(); return; }

    const doc = getActiveDocument();
    const hit = ctx.findAnnotationAt(ctx.x, ctx.y);

    // Klik op een ander object dan de bron → dat wordt de nieuwe bron.
    if (hit && !(_s.sources && _s.sources.includes(hit))) {
      const sel = doc?.selectedAnnotations || [];
      _s.sources = (sel.length > 1 && sel.includes(hit)) ? sel.slice() : [hit];
      if (doc) {
        doc.selectedAnnotations = _s.sources;
        doc.selectedAnnotation = _s.sources[0];
      }
      ctx.redraw();
      _s.distance = null;
    }

    if (!_s.sources || _s.sources.length === 0) {
      _bericht('Offset: click an object to offset', 'drawing.offsetPick');
      return;
    }
    if (_s.distance == null) {
      _vraagAfstand();
      return;
    }
    _plaats(ctx, ctx.x, ctx.y);
  },

  onEscape() { _reset(); },
  onDeactivate() { _reset(); },
};
