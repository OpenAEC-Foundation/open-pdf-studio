// Betonbalk-tekengereedschap — klik-voor-klik hartlijn (zoals de polylijn),
// met live balkvoorbeeld op de actuele breedte.
//
//  * klik           → hartlijnpunt toevoegen (object-snap + polair doen mee)
//  * Enter / dubbelklik / rechtermuisklik → balk afsluiten (≥ 2 punten)
//  * Escape         → laatste punt annuleren; nogmaals Escape → balk annuleren
//
// Na het afsluiten blijft de tool actief zodat direct de volgende balk
// getekend kan worden (T-/hoekaansluitingen tekenen in één beweging door).
// De geometrie van het voorbeeld komt uit exact dezelfde buildBetonbalk() +
// drawBetonbalkGeom() als de definitieve weergave.
import { state as appState, getActiveDocument } from '../../core/state.js';
import { applyToolTransform, isModalOpen } from '../tool-context.js';
import { createAnnotation } from '../../annotations/factory.js';
import { recordAdd } from '../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { drawBetonbalkGeom } from '../../annotations/rendering/betonbalk-draw.js';
import { buildBetonbalk, BETONBALK_DEFAULTS } from '../../annotations/betonbalk.js';
import { betonbalkBuildOpts } from '../../annotations/betonbalk-scale.js';
import { ifcCategoryForAnnotationType } from '../../solid/data/ifcCategoryMap.js';
import { getLineWidthValue } from '../../bridge.js';

function _redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function _points() {
  if (!Array.isArray(appState.betonbalkPoints)) appState.betonbalkPoints = [];
  return appState.betonbalkPoints;
}

// Pending-annotatie voor het voorbeeld: dezelfde parameters als de balk die
// straks geplaatst wordt, zodat breedte/lijnstijl in het voorbeeld kloppen.
function _pendingAnn(points) {
  const o = appState.toolOverrides || {};
  return {
    type: 'betonbalk',
    page: getActiveDocument()?.currentPage || 1,
    points,
    breedteMm: o.betonbalkBreedteMm ?? BETONBALK_DEFAULTS.breedteMm,
    lijnstijl: o.betonbalkLijnstijl ?? BETONBALK_DEFAULTS.lijnstijl,
  };
}

function _drawPreview(ctx, canvasCtx, previewPoints) {
  if (!canvasCtx || previewPoints.length < 2) return;
  const doc = getActiveDocument();
  const ann = _pendingAnn(previewPoints);
  const geom = buildBetonbalk(ann, betonbalkBuildOpts(ann, doc?.annotations || []));
  if (!geom) return;
  canvasCtx.save();
  applyToolTransform(canvasCtx);
  drawBetonbalkGeom(canvasCtx, geom, {
    strokeColor: '#000000',
    lineWidth: getLineWidthValue() || 1,
  });
  canvasCtx.restore();
}

function _cancel() {
  appState.betonbalkPoints = [];
  appState.isDrawingBetonbalk = false;
  appState._betonbalkEscapeArmed = false;
  _redraw();
}

function _finish() {
  const pts = _points();
  if (pts.length >= 2) {
    const doc = getActiveDocument();
    const ann = createAnnotation({
      ..._pendingAnn([...pts]),
      strokeColor: '#000000',
      // NL constructie-componenten zijn standaard ZWART, net als wand en
      // stavenreeks; herkleuren kan achteraf in het eigenschappen-paneel.
      color: '#000000',
      lineWidth: getLineWidthValue() || 1,
      opacity: 1,
      ifcCategory: ifcCategoryForAnnotationType('betonbalk'),
    });
    if (doc) doc.annotations.push(ann);
    recordAdd(ann);
  }
  appState.betonbalkPoints = [];
  appState.isDrawingBetonbalk = false;
  appState._betonbalkEscapeArmed = false;
  _redraw();
  // Tool blijft actief: de volgende balk (bv. de T-aansluitende) kan direct
  // getekend worden — bewust GEEN maybeRevertToSelect zoals bij de polylijn.
}

export const betonbalkTool = {
  name: 'betonbalk',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, canvasCtx } = ctx;
    appState._betonbalkEscapeArmed = false;

    // Rechtermuisklik of dubbelklik sluit de balk af.
    if (e.button === 2) {
      _finish();
      appState._suppressNextContextmenu = true;
      return;
    }
    if (e.detail === 2) {
      _finish();
      return;
    }

    const pts = _points();
    const snap = ctx.snap(x, y, null, pts);
    pts.push({
      x: snap.snapped ? snap.x : x,
      y: snap.snapped ? snap.y : y,
    });
    appState.isDrawingBetonbalk = true;
    ctx.redraw();
    _drawPreview(ctx, canvasCtx, pts);
  },

  onPointerMove(ctx, e) {
    const { x, y, canvasCtx, state } = ctx;
    const pts = _points();
    if (!appState.isDrawingBetonbalk || pts.length === 0) {
      // Hover-snap-indicator, zoals bij de polylijn.
      const snap = ctx.snap(x, y);
      if (snap.snapped) {
        state.lastSnapResult = snap;
        ctx.redraw();
        ctx.drawSnapIndicator(snap);
      } else if (state.lastSnapResult) {
        state.lastSnapResult = null;
        ctx.redraw();
      }
      return;
    }

    const snap = ctx.snap(x, y, null, pts);
    const snapX = snap.snapped ? snap.x : x;
    const snapY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;

    ctx.redraw();
    _drawPreview(ctx, canvasCtx, [...pts, { x: snapX, y: snapY }]);
    if (snap.snapped) ctx.drawSnapIndicator(snap);
  },

  // Enter sluit af; Escape pelt het laatste punt en annuleert bij de tweede
  // druk de hele balk (spec-gedrag). preventDefault houdt de globale
  // Escape-ladder (→ selectietool) buiten de deur zolang er getekend wordt.
  onKeyDown(keyCtx, e) {
    const pts = _points();
    if (e.key === 'Enter' && pts.length >= 2) {
      e.preventDefault();
      _finish();
      return;
    }
    if (e.key === 'Escape' && pts.length > 0 && !isModalOpen()) {
      e.preventDefault();
      if (appState._betonbalkEscapeArmed || pts.length <= 1) {
        _cancel();
      } else {
        pts.pop();
        appState._betonbalkEscapeArmed = true;
        _redraw();
      }
    }
  },

  // Vangnet voor de Escape-ladder (bv. Escape zonder actieve tekening nadat
  // onKeyDown hem doorliet): tekenstate opruimen, daarna schakelt de ladder
  // zelf naar de selectietool.
  onEscape() {
    const pts = _points();
    if (pts.length === 0 && !appState.isDrawingBetonbalk) return false;
    _cancel();
    return true;
  },

  onDeactivate(ctx) {
    if (appState.isDrawingBetonbalk || _points().length > 0) {
      appState.betonbalkPoints = [];
      appState.isDrawingBetonbalk = false;
      appState._betonbalkEscapeArmed = false;
      ctx.redraw();
    }
  },
};
