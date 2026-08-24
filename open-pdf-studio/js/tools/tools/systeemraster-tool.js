// systeemrasterTool — klik-voor-klik contour die automatisch gevuld wordt
// met een rechthoekig platenraster (systeemplafond, stelconplaten-veld, …).
//
// Flow (zelfde conventies als de filled-area-tool):
//   - Klikken breidt de contour uit; snap + Shift-ortho werken mee.
//   - Klik bij het eerste punt, Enter of rechtermuisklik sluit
//     de contour en plaatst het raster (≥ 3 punten vereist).
//   - Escape: ≥ 3 punten → toch committen (GitHub #273-conventie); minder →
//     annuleren.
//
// Het live voorbeeld gebruikt dezelfde buildSysteemraster()-geometrie als de
// definitieve weergave, dus na de laatste klik "verspringt" er niets.
import { state, getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';
import { createAnnotation } from '../../annotations/factory.js';
import { recordAdd } from '../../core/undo-manager.js';
import { buildSysteemraster, SYSTEEMRASTER_DEFAULTS } from '../../annotations/systeemraster.js';
import { systeemrasterBuildOpts } from '../../annotations/systeemraster-scale.js';
import { drawSysteemrasterGeom } from '../../annotations/rendering/systeemraster-draw.js';
import { DRAFTING_LINE_WIDTH } from '../../annotations/drafting.js';
import { ifcCategoryForAnnotationType } from '../../solid/data/ifcCategoryMap.js';
import { getSysteemTypeById, getSysteemTypenData } from '../../annotations/systeem-typen-registry.js';

// Punten-tot-nu-toe van de contour in aanbouw.
let _pts = null;

// Actieve variant: 'raster' (stelconplaten 2000×2000) of 'plafond'
// (systeemplafond 600×600 mét system-datamodel). Wordt gezet door de
// wrapper-tools onderaan; er is altijd maar één tekentool tegelijk actief.
let _variant = 'raster';

const _baseTool = {
  name: 'systeemraster',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    if (e.button === 2) {
      _finish(ctx);
      return;
    }
    if (!_pts) _pts = [];

    const snap = ctx.snap(x, y, null, _pts);
    let ptX = snap.snapped ? snap.x : x;
    let ptY = snap.snapped ? snap.y : y;

    // Shift-ortho (hoeksnap) t.o.v. het vorige punt.
    if (!snap.snapped && e.shiftKey && state.preferences.enableAngleSnap && _pts.length > 0) {
      const last = _pts[_pts.length - 1];
      const dx = x - last.x, dy = y - last.y;
      const len = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      const sn = ctx.snapAngle(ang, state.preferences.angleSnapDegrees) * (Math.PI / 180);
      ptX = last.x + len * Math.cos(sn);
      ptY = last.y + len * Math.sin(sn);
    }

    // Klik bij het eerste punt sluit de contour.
    if (_pts.length >= 3) {
      const first = _pts[0];
      if (Math.hypot(ptX - first.x, ptY - first.y) < 10 / ctx.scale) {
        _finish(ctx);
        return;
      }
    }

    _pts.push({ x: ptX, y: ptY });
    ctx.redraw();
  },

  onPointerMove(ctx, e) {
    const { x, y, canvasCtx, scale } = ctx;
    if (!_pts || _pts.length === 0) {
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

    const snap = ctx.snap(x, y, null, _pts);
    state.lastSnapResult = snap.snapped ? snap : null;
    let snapX = snap.snapped ? snap.x : x;
    let snapY = snap.snapped ? snap.y : y;
    let nearFirst = false;

    if (_pts.length >= 3) {
      const first = _pts[0];
      if (Math.hypot(snapX - first.x, snapY - first.y) < 10 / scale) {
        snapX = first.x; snapY = first.y; nearFirst = true;
      }
    }
    if (!snap.snapped && !nearFirst && e.shiftKey && state.preferences.enableAngleSnap) {
      const last = _pts[_pts.length - 1];
      const dx = x - last.x, dy = y - last.y;
      const len = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      const sn = ctx.snapAngle(ang, state.preferences.angleSnapDegrees) * (Math.PI / 180);
      snapX = last.x + len * Math.cos(sn);
      snapY = last.y + len * Math.sin(sn);
    }

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);

    const previewPts = [..._pts, { x: snapX, y: snapY }];
    if (previewPts.length >= 3) {
      // Volwaardig voorbeeld: contour + geclipt raster via dezelfde
      // geometrie- en tekenmodules als de definitieve weergave.
      const tempAnn = _annProps(previewPts);
      const geom = buildSysteemraster(tempAnn, systeemrasterBuildOpts(tempAnn));
      if (geom) {
        drawSysteemrasterGeom(canvasCtx, geom, {
          strokeColor: tempAnn.strokeColor,
          lineWidth: tempAnn.lineWidth,
        });
      }
    } else {
      canvasCtx.strokeStyle = '#000000';
      canvasCtx.lineWidth = DRAFTING_LINE_WIDTH;
      canvasCtx.setLineDash([4, 3]);
      canvasCtx.beginPath();
      canvasCtx.moveTo(previewPts[0].x, previewPts[0].y);
      for (let i = 1; i < previewPts.length; i++) {
        canvasCtx.lineTo(previewPts[i].x, previewPts[i].y);
      }
      canvasCtx.stroke();
      canvasCtx.setLineDash([]);
    }

    if (nearFirst) {
      const first = _pts[0];
      canvasCtx.beginPath();
      canvasCtx.arc(first.x, first.y, 5 / scale, 0, Math.PI * 2);
      canvasCtx.fillStyle = '#000000';
      canvasCtx.globalAlpha = 0.3;
      canvasCtx.fill();
      canvasCtx.globalAlpha = 1;
    }
    canvasCtx.restore();
    if (snap.snapped && !nearFirst) ctx.drawSnapIndicator(snap);
  },

  onKeyDown(ctx, e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      _finish(ctx);
    }
  },

  onEscape(ctx) {
    if (_pts && _pts.length > 0) {
      _finish(ctx); // ≥ 3 punten commit, minder annuleert (zie _finish)
      return true;
    }
    return false;
  },

  onDeactivate(ctx) {
    _pts = null;
    ctx.redraw();
  },
};

// Annotatie-eigenschappen voor een contour (ook voor het live voorbeeld).
// Variant 'plafond': systeemplafond — celmaat 600×600 mm, system-datamodel
// (v1: één laag met paneel-overrides en randprofiel) en IFC-subtype CEILING.
function _annProps(points) {
  const D = SYSTEEMRASTER_DEFAULTS;
  const plafond = _variant === 'plafond';
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return {
    type: 'systeemraster',
    page: getActiveDocument()?.currentPage || 1,
    points: points.map(p => ({ x: p.x, y: p.y })),
    color: '#000000',
    strokeColor: '#000000',
    // Tekenpen van de NL-tekenwerkcomponenten (drafting.js) als terugval;
    // wordt later per IFC-categorie instelbaar via de tekenlaag.
    lineWidth: DRAFTING_LINE_WIDTH,
    plaatBreedteMm: plafond ? 600 : D.plaatBreedteMm,
    plaatHoogteMm: plafond ? 600 : D.plaatHoogteMm,
    ...(plafond ? (() => {
      // SYSTEEMTYPE: de instance verwijst naar de herbruikbare definitie
      // uit de registry (celmaat/randprofiel/IFC komen uit het TYPE); de
      // instance draagt alleen contour, oorsprong, hoek en overrides.
      const st = getSysteemTypeById('st-plafond-600x600')
        || getSysteemTypenData().typen[0];
      return {
        systeemTypeId: st ? st.id : undefined,
        system: { type: 'plafond', layers: [{ panels: {}, edge: { profiel: 'geen' } }] },
        ifcCategory: st?.ifcCategory || ifcCategoryForAnnotationType('systeemraster'),
        ifcPredefinedType: st?.ifcPredefinedType || 'CEILING',
      };
    })() : {}),
    originXMm: D.originXMm,
    originYMm: D.originYMm,
    equalizeX: D.equalizeX,
    equalizeY: D.equalizeY,
    randConditie: D.randConditie,
    minRandMm: D.minRandMm,
    rasterHoek: D.rasterHoek,
    tagTonen: D.tagTonen,
    tagFontSize: D.tagFontSize,
    ifcCategory: ifcCategoryForAnnotationType('systeemraster'),
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function _finish(ctx) {
  if (_pts && _pts.length >= 3) {
    const ann = createAnnotation(_annProps(_pts));
    const doc = getActiveDocument();
    if (doc) doc.annotations.push(ann);
    recordAdd(ann);
  }
  _pts = null;
  ctx.redraw();
  import('../manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

// Wrapper-tools: zelfde klik-flow, andere defaults. De wrapper zet de
// variant vlak vóór elke gedelegeerde aanroep (er is één tool tegelijk
// actief, dus dit is race-vrij).
function _makeVariantTool(name, variant) {
  const wrap = (fn) => function (...args) {
    _variant = variant;
    return fn.apply(_baseTool, args);
  };
  return {
    name,
    cursor: _baseTool.cursor,
    onPointerDown: wrap(_baseTool.onPointerDown),
    onPointerMove: wrap(_baseTool.onPointerMove),
    onKeyDown: wrap(_baseTool.onKeyDown),
    onEscape: wrap(_baseTool.onEscape),
    onDeactivate: wrap(_baseTool.onDeactivate),
  };
}

export const systeemrasterTool = _makeVariantTool('systeemraster', 'raster');
export const systeemplafondTool = _makeVariantTool('systeemplafond', 'plafond');
