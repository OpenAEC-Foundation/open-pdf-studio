/**
 * Spot Coord. — klik op een punt en het labelt de X,Y-coördinaten daarvan
 * (AutoCAD's "spot coordinate"). Werkt als een leidraad-label: één pijl naar
 * het punt, tekst ernaast, in de meeteenheden van het document/schaalgebied.
 *
 * Hergebruikt het measureDistance-annotatietype (zelfde renderer, saver en
 * loader als Radius/Diameter — zie dimension-radius-tool.js), zodat er niets
 * nieuws nodig is in renderer of opslag.
 */
import { state, getActiveDocument } from '../../core/state.js';
import { getMeasureScale } from '../../annotations/measurement.js';
import { schermPxNaarPt } from '../../annotations/minimummaat.js';
import { getEffectiveScale } from '../effective-scale.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import i18next from '../../i18n/config.js';
import { applyToolTransform } from '../tool-context.js';

function _bericht(def, key) {
  updateStatusMessage(key ? i18next.t(key, { ns: 'ribbon', defaultValue: def }) : def, 5000);
}

/** X,Y in meeteenheden (schaalgebied-bewust), zes significante cijfers. */
function _coordinaten(page, x, y) {
  const ms = getMeasureScale(page, x, y);
  const k = ms.pixelsPerUnit || 1;
  const unit = ms.unit || 'mm';
  const num = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : '0');
  return { text: `X ${num(x / k)}, Y ${num(y / k)} ${unit}`, unit };
}

/** Vaste leidraadlengte in schermpixels → paginapunten (zoom-onafhankelijk). */
function _richting() {
  const off = schermPxNaarPt(70, getEffectiveScale());
  return { dx: Math.cos(-Math.PI / 6) * off, dy: Math.sin(-Math.PI / 6) * off };
}

export const spotCoordTool = {
  name: 'spotCoord',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button === 2) return;
    if (e.button !== 0) return;
    const snap = ctx.snap(ctx.x, ctx.y);
    const px = snap.snapped ? snap.x : ctx.x;
    const py = snap.snapped ? snap.y : ctx.y;

    const doc = getActiveDocument();
    const page = doc?.currentPage || 1;
    const { text } = _coordinaten(page, px, py);
    const off = _richting();
    const prefs = ctx.prefs || {};

    const ann = ctx.createAnnotation({
      type: 'measureDistance',
      page,
      startX: px, startY: py,
      endX: px + off.dx, endY: py + off.dy,
      startHead: 'closed',
      endHead: 'none',
      headSize: prefs.measureDistHeadSize || 12,
      color: prefs.measureDistStrokeColor,
      strokeColor: prefs.measureDistStrokeColor,
      lineWidth: prefs.measureDistLineWidth,
      fontSize: prefs.measureDistFontSize || undefined,
      dimExtension: false,
      opacity: (prefs.measureDistOpacity || 100) / 100,
      measureText: text,
      measureUnit: _coordinaten(page, px, py).unit,
    });
    if (doc) doc.annotations.push(ann);
    ctx.recordAdd(ann);
    ctx.redraw();
    _bericht('Spot Coord: click another point for a new label, or press Escape',
      'drawing.spotCoordDone');
    import('../../tools/manager.js')
      .then((m) => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onPointerMove(ctx, e) {
    const { x, y, canvasCtx } = ctx;
    if (!canvasCtx) return;
    const snap = ctx.snap(x, y);
    const px = snap.snapped ? snap.x : x;
    const py = snap.snapped ? snap.y : y;
    const doc = getActiveDocument();
    const page = doc?.currentPage || 1;
    const { text } = _coordinaten(page, px, py);
    const off = _richting();

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.strokeStyle = ctx.prefs?.measureDistStrokeColor || '#FF0000';
    canvasCtx.lineWidth = ctx.prefs?.measureDistLineWidth || 1;
    ctx.drawDimension(canvasCtx, {
      startX: px, startY: py,
      endX: px + off.dx, endY: py + off.dy,
      startHead: 'closed',
      endHead: 'none',
      headSize: ctx.prefs?.measureDistHeadSize || 12,
      color: ctx.prefs?.measureDistStrokeColor || '#FF0000',
      measureText: text,
    });
    canvasCtx.restore();
    if (snap.snapped) ctx.drawSnapIndicator(snap);
  },

  onEscape() { return false; },
  onDeactivate() { /* geen sessiestate */ },
};

/** Ribbon-entry-point met instructie. */
export async function startSpotCoordTool() {
  const m = await import('../manager.js');
  m.setTool('spotCoord');
  _bericht('Spot Coord: click a point to label its X,Y coordinates',
    'drawing.spotCoordHint');
}
