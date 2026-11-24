/**
 * Nulpunt. — klik op een punt van het blad en dat wordt het nulpunt van de
 * coördinaatlabels (x naar rechts, y naar boven). De labels op dat blad
 * worden bijgewerkt en nieuwe labels tellen er meteen vanaf.
 */
import { getActiveDocument } from '../../core/state.js';
import { zetPaginaNulpunt, volgendeNulpuntWaarde } from '../../annotations/coord-nulpunt-app.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import i18next from '../../i18n/config.js';

function _bericht(def, key) {
  updateStatusMessage(i18next.t(key, { ns: 'ribbon', defaultValue: def }), 5000);
}

export const coordOriginTool = {
  name: 'coordOrigin',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    const snap = ctx.snap(ctx.x, ctx.y);
    const px = snap.snapped ? snap.x : ctx.x;
    const py = snap.snapped ? snap.y : ctx.y;
    const doc = getActiveDocument();
    const page = ctx.pageNum || doc?.currentPage || 1;
    zetPaginaNulpunt(page, { x: px, y: py, yUp: true, ...volgendeNulpuntWaarde() });
    ctx.redraw();
    import('../manager.js').then((m) => m.setTool('select'));
  },

  onPointerMove(ctx) {
    const { x, y, canvasCtx } = ctx;
    if (!canvasCtx) return;
    const snap = ctx.snap(x, y);
    if (snap.snapped) { ctx.redraw(); ctx.drawSnapIndicator(snap); }
  },

  onEscape() { return false; },
  onDeactivate() { /* geen sessiestate */ },
};

/** Ribbon-ingang met instructie. */
export async function startCoordOriginTool() {
  const m = await import('../manager.js');
  m.setTool('coordOrigin');
  _bericht('Origin: click the point that becomes (0, 0)', 'drawing.originHint');
}
