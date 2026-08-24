import { HANDLE_TYPES } from '../core/constants.js';
import { state } from '../core/state.js';
import { snapAngle } from '../utils/helpers.js';
import { calculateDistance, calculateArea, calculatePerimeter, formatMeasurement, formatDimensionText, snapDistanceTo10 } from './measurement.js';
import { handleAnchors, lineEndForDotTarget, resolveParams } from './stavenreeks.js';
import { getTemplate } from '../symbols/registry.js';
import { systeemrasterPxPerMm, systeemrasterBuildOpts } from './systeemraster-scale.js';
import { PX_PER_MM_1_100 as SR_PX_PER_MM_1_100, segmentPoint as srSegmentPoint, flattenContour as srFlattenContour, copyPointKeepArc, buildSysteemraster, updateSparing as srUpdateSparing } from './systeemraster.js';
import { pxPerMmAt } from '../symbols/real-size.js';
import {
  syncTwoPointGeometry,
  syncTwoPointLengthParam,
  twoPointEndpoints,
} from '../symbols/two-point.js';

// Compute measurement text for a dimension annotation, using its own scale if available
function computeDimensionText(ann) {
  if (ann.measureScale) {
    const dx = ann.endX - ann.startX;
    const dy = ann.endY - ann.startY;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    const scaledVal = pixelDist * ann.measureScale;
    const unit = ann.measureUnit || 'mm';
    // mm shows whole numbers (no decimals); other units use annotation.measurePrecision.
    const prec = (unit === 'mm') ? 0
      : (ann.measurePrecision !== undefined ? ann.measurePrecision : 2);
    // mm is the implied drawing unit on dimensions — no suffix.
    const v = scaledVal.toFixed(prec);
    return unit === 'mm' ? v : `${v} ${unit}`;
  }
  return formatDimensionText(calculateDistance(ann.startX, ann.startY, ann.endX, ann.endY, ann.page));
}

// Keep the stored measurement fields of a dimension in sync with its geometry.
// Called after any endpoint edit so measureValue/measurePixels never go stale
// (recalculateAllMeasurements trusts measurePixels when recomputing on a
// scale change) and measureText reflects the new length × scale.
function syncDimensionMeasurement(ann) {
  const dx = ann.endX - ann.startX;
  const dy = ann.endY - ann.startY;
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  ann.measurePixels = pixelDist;
  if (ann.measureScale) {
    ann.measureValue = pixelDist * ann.measureScale;
  } else {
    ann.measureValue = calculateDistance(ann.startX, ann.startY, ann.endX, ann.endY, ann.page).value;
  }
  ann.measureText = computeDimensionText(ann);
}

// Recalculate callout leader line geometry from box position and arrow tip.
// Picks the best box edge based on arrow position:
//   - Arrow to the side → horizontal arm from left/right edge at vertical center
//   - Arrow above/below → vertical arm from top/bottom edge at horizontal center
function recalcCalloutLeader(annotation) {
  const boxW = annotation.width || 150;
  const boxH = annotation.height || 50;
  const arrowX = annotation.arrowX !== undefined ? annotation.arrowX : annotation.x - 60;
  const arrowY = annotation.arrowY !== undefined ? annotation.arrowY : annotation.y + boxH;

  const boxCenterX = annotation.x + boxW / 2;
  const boxCenterY = annotation.y + boxH / 2;

  // How far the arrow is outside the box span in each axis
  const hDist = arrowX < annotation.x ? annotation.x - arrowX :
                arrowX > annotation.x + boxW ? arrowX - (annotation.x + boxW) : 0;
  const vDist = arrowY < annotation.y ? annotation.y - arrowY :
                arrowY > annotation.y + boxH ? arrowY - (annotation.y + boxH) : 0;

  // Determine current mode, with hysteresis to prevent flickering
  const wasVertical = annotation._leaderVertical;
  const threshold = 20;
  let useVertical;
  if (wasVertical) {
    // Currently vertical — only switch to horizontal if hDist exceeds vDist by threshold
    useVertical = !(hDist > vDist + threshold);
  } else {
    // Currently horizontal — only switch to vertical if vDist exceeds hDist by threshold
    useVertical = vDist > hDist + threshold;
  }
  annotation._leaderVertical = useVertical;

  if (!useVertical) {
    // Arrow is more to the side → horizontal arm from left/right edge, vertical center
    const isLeft = arrowX < boxCenterX;
    annotation.armOriginX = isLeft ? annotation.x : annotation.x + boxW;
    annotation.armOriginY = boxCenterY;

    const armLen = Math.min(30, Math.abs(arrowX - annotation.armOriginX) * 0.4);
    annotation.kneeX = isLeft ? annotation.armOriginX - armLen : annotation.armOriginX + armLen;
    annotation.kneeY = annotation.armOriginY;
  } else {
    // Arrow is more above/below → vertical arm from top/bottom edge, horizontal center
    const isAbove = arrowY < boxCenterY;
    annotation.armOriginX = boxCenterX;
    annotation.armOriginY = isAbove ? annotation.y : annotation.y + boxH;

    const armLen = Math.min(30, Math.abs(arrowY - annotation.armOriginY) * 0.4);
    annotation.kneeX = annotation.armOriginX;
    annotation.kneeY = isAbove ? annotation.armOriginY - armLen : annotation.armOriginY + armLen;
  }
}

// Rotate a delta vector from screen space into the annotation's local coordinate space
function rotateDelta(deltaX, deltaY, rotationDeg) {
  if (!rotationDeg) return { dx: deltaX, dy: deltaY };
  const rad = -rotationDeg * Math.PI / 180;
  return {
    dx: deltaX * Math.cos(rad) - deltaY * Math.sin(rad),
    dy: deltaX * Math.sin(rad) + deltaY * Math.cos(rad)
  };
}

// Apply resize for a rotated rectangular annotation.
// The idea: resize in local (unrotated) space, then reposition so the
// anchor corner (opposite to the dragged handle) stays in the same
// screen position.
function applyRotatedResize(annotation, handleType, deltaX, deltaY, originalAnn, lockRatio = false) {
  const rot = originalAnn.rotation || 0;
  const { dx, dy } = rotateDelta(deltaX, deltaY, rot);

  // Start from original values
  let newX = originalAnn.x;
  let newY = originalAnn.y;
  let newW = originalAnn.width;
  let newH = originalAnn.height;
  const aspectRatio = lockRatio && originalAnn.originalWidth && originalAnn.originalHeight
    ? originalAnn.originalWidth / originalAnn.originalHeight
    : (lockRatio ? originalAnn.width / originalAnn.height : 0);

  // Apply local-space resize
  switch (handleType) {
    case HANDLE_TYPES.TOP_LEFT:
      if (lockRatio) {
        newW -= dx; newH = newW / aspectRatio;
        newX = originalAnn.x + originalAnn.width - newW;
        newY = originalAnn.y + originalAnn.height - newH;
      } else {
        newX += dx; newY += dy; newW -= dx; newH -= dy;
      }
      break;
    case HANDLE_TYPES.TOP_RIGHT:
      if (lockRatio) {
        newW += dx; newH = newW / aspectRatio;
        newY = originalAnn.y + originalAnn.height - newH;
      } else {
        newY += dy; newW += dx; newH -= dy;
      }
      break;
    case HANDLE_TYPES.BOTTOM_LEFT:
      if (lockRatio) {
        newW -= dx; newH = newW / aspectRatio;
        newX = originalAnn.x + originalAnn.width - newW;
      } else {
        newX += dx; newW -= dx; newH += dy;
      }
      break;
    case HANDLE_TYPES.BOTTOM_RIGHT:
      if (lockRatio) {
        newW += dx; newH = newW / aspectRatio;
      } else {
        newW += dx; newH += dy;
      }
      break;
    case HANDLE_TYPES.TOP:
      if (lockRatio) {
        newH -= dy; newW = newH * aspectRatio;
        newY = originalAnn.y + originalAnn.height - newH;
        newX = originalAnn.x + (originalAnn.width - newW) / 2;
      } else {
        newY += dy; newH -= dy;
      }
      break;
    case HANDLE_TYPES.BOTTOM:
      if (lockRatio) {
        newH += dy; newW = newH * aspectRatio;
        newX = originalAnn.x + (originalAnn.width - newW) / 2;
      } else {
        newH += dy;
      }
      break;
    case HANDLE_TYPES.LEFT:
      if (lockRatio) {
        newW -= dx; newH = newW / aspectRatio;
        newX = originalAnn.x + originalAnn.width - newW;
        newY = originalAnn.y + (originalAnn.height - newH) / 2;
      } else {
        newX += dx; newW -= dx;
      }
      break;
    case HANDLE_TYPES.RIGHT:
      if (lockRatio) {
        newW += dx; newH = newW / aspectRatio;
        newY = originalAnn.y + (originalAnn.height - newH) / 2;
      } else {
        newW += dx;
      }
      break;
  }

  // Enforce minimum size
  if (newW < 10) { newW = 10; if (lockRatio) newH = newW / aspectRatio; }
  if (newH < 10) { newH = 10; if (lockRatio) newW = newH * aspectRatio; }

  // The center of the original annotation in screen space
  const rad = rot * Math.PI / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  const origCx = originalAnn.x + originalAnn.width / 2;
  const origCy = originalAnn.y + originalAnn.height / 2;

  // New center in local space (relative to old local origin)
  const newLocalCx = newX + newW / 2;
  const newLocalCy = newY + newH / 2;

  // Offset of new center from old center in local space
  const localOffX = newLocalCx - (originalAnn.x + originalAnn.width / 2);
  const localOffY = newLocalCy - (originalAnn.y + originalAnn.height / 2);

  // Rotate offset back to screen space to get the new screen center
  const screenCx = origCx + localOffX * cosR - localOffY * sinR;
  const screenCy = origCy + localOffX * sinR + localOffY * cosR;

  // Set annotation position from screen center
  annotation.x = screenCx - newW / 2;
  annotation.y = screenCy - newH / 2;
  annotation.width = newW;
  annotation.height = newH;
}

// Apply resize based on handle being dragged
export function applyResize(annotation, handleType, deltaX, deltaY, originalAnn, shiftKey = false, ctrlKey = false) {
  if (annotation.locked) return;

  // Center grips: move the whole annotation (translation, not stretch).
  // These are the "grip stretch" semantics for the center grip per the
  // grippoints spec — a single click+drag on the midpoint translates the
  // entire shape by the cursor delta from the grip's original location.
  // Caller has already reset `annotation` from `originalAnn` before invoking
  // applyResize (see _handleResize in tool-dispatcher.js), so applyMove can
  // operate directly on the original-relative state.
  // Systeemraster-oorsprong: verschuift alleen de rasteroorsprong
  // (originXMm/originYMm, in werkelijke mm via de plaatselijke schaal) —
  // de contour blijft onaangeroerd. Verslepen op een as zet equalize op die
  // as uit, anders zou de sleep geen zichtbaar effect hebben.
  if (handleType === 'systeemraster_origin' && annotation.type === 'systeemraster') {
    const srK = systeemrasterPxPerMm(annotation) || SR_PX_PER_MM_1_100;
    // Rasterhoek-bewust: de sleep-delta (wereld) naar de rasterruimte
    // draaien, want originXMm/-YMm leven op de (gedraaide) rasterassen.
    const srTheta = ((Number(originalAnn.rasterHoek) || 0) * Math.PI) / 180;
    const srCos = Math.cos(srTheta), srSin = Math.sin(srTheta);
    const srDx = deltaX * srCos + deltaY * srSin;
    const srDy = -deltaX * srSin + deltaY * srCos;
    annotation.originXMm = (Number(originalAnn.originXMm) || 0) + srDx / srK;
    annotation.originYMm = (Number(originalAnn.originYMm) || 0) + srDy / srK;
    if (Math.abs(srDx) > 1e-9) annotation.equalizeX = false;
    if (Math.abs(srDy) > 1e-9) annotation.equalizeY = false;
    return;
  }

  // Systeemraster-hoekgrip: slepen zet de RASTERHOEK — de hoek van de
  // sleeppositie t.o.v. de rasteroorsprong (wereld). Shift snapt op 15°.
  if (handleType === 'systeemraster_hoek' && annotation.type === 'systeemraster') {
    const srGeom = buildSysteemraster(originalAnn, systeemrasterBuildOpts(originalAnn));
    if (srGeom && srGeom.hoekGrip && srGeom.originGrip) {
      const tx = srGeom.hoekGrip.x + deltaX, ty = srGeom.hoekGrip.y + deltaY;
      const dx = tx - srGeom.originGrip.x, dy = ty - srGeom.originGrip.y;
      if (Math.hypot(dx, dy) > 1e-6) {
        let deg = Math.atan2(dy, dx) * (180 / Math.PI);
        if (shiftKey) deg = Math.round(deg / 15) * 15;
        // Vrijwel 0° → exact 0 (recht raster, geen rot-tak in de geometrie).
        if (Math.abs(deg) < 0.5 || Math.abs(Math.abs(deg) - 360) < 0.5) deg = 0;
        annotation.rasterHoek = ((deg % 360) + 360) % 360;
      }
    }
    return;
  }

  // Sparing-grip: verplaatst de sparing. De wereld-delta wordt naar de
  // rasterruimte gedraaid (sparingen leven op de gedraaide rasterassen) en
  // in werkelijke mm op xMm/yMm gezet.
  if (typeof handleType === 'string' && handleType.startsWith('systeemraster_sparing_')
      && annotation.type === 'systeemraster') {
    const spId = handleType.substring('systeemraster_sparing_'.length);
    const orig = (originalAnn.sparingen || []).find(s => s && s.id === spId);
    if (orig) {
      const srK2 = systeemrasterPxPerMm(annotation) || SR_PX_PER_MM_1_100;
      const th = ((Number(originalAnn.rasterHoek) || 0) * Math.PI) / 180;
      const c = Math.cos(th), sn = Math.sin(th);
      const dxR = deltaX * c + deltaY * sn;
      const dyR = -deltaX * sn + deltaY * c;
      srUpdateSparing(annotation, spId, {
        xMm: (Number(orig.xMm) || 0) + dxR / srK2,
        yMm: (Number(orig.yMm) || 0) + dyR / srK2,
      });
    }
    return;
  }

  // Systeemraster-segmentgrip: buigt het contoursegment. De boogdiepte volgt
  // de sleepafstand loodrecht op de koorde (kwadratische Bézier: doorzakking
  // op t=0,5 = bulge·koorde/2 → bulge = 2·afstand/koorde). Vrijwel op de
  // koorde terugslepen maakt het segment weer recht — dat is meteen de
  // recht↔boog-toggle. De boogdata staat op het EINDpunt van het segment
  // (zelfde conventie als filledArea, zie arcControlPoint in measurement.js).
  if (typeof handleType === 'string' && handleType.startsWith('systeemraster_seg_')
      && annotation.type === 'systeemraster') {
    const s = parseInt(handleType.substring('systeemraster_seg_'.length), 10);
    const pts = annotation.points || [];
    const opts = originalAnn.points || [];
    if (!isNaN(s) && s >= 0 && s < pts.length && pts.length >= 3) {
      const a = opts[s], b = opts[(s + 1) % opts.length];
      const base = srSegmentPoint(opts, s, 0.5);
      const tx = base.x + deltaX, ty = base.y + deltaY;
      const dx = b.x - a.x, dy = b.y - a.y;
      const chord = Math.hypot(dx, dy);
      if (chord > 1e-9) {
        // Loodrechte (getekende) afstand van de sleeppositie tot de koorde,
        // in dezelfde normaalrichting als arcControl (-dy, dx).
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const h = ((tx - mx) * (-dy) + (ty - my) * dx) / chord;
        let bulge = (2 * h) / chord;
        bulge = Math.max(-1.5, Math.min(1.5, bulge));
        const end = pts[(s + 1) % pts.length];
        if (Math.abs(bulge) < 0.03) {
          delete end.arc;
          delete end.bulge;
        } else {
          end.arc = true;
          end.bulge = bulge;
        }
      }
    }
    return;
  }

  if (handleType === HANDLE_TYPES.LINE_MID ||
      handleType === HANDLE_TYPES.RECT_CENTER ||
      handleType === HANDLE_TYPES.CIRCLE_CENTER) {
    applyMove(annotation, deltaX, deltaY);
    return;
  }

  switch (annotation.type) {
    case 'box':
    case 'mask':
    case 'circle':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
      // Textbox leader tip/knee drag: update only that point on the matching leader.
      if (annotation.type === 'textbox' && typeof handleType === 'string' &&
          (handleType.startsWith(HANDLE_TYPES.LEADER_TIP + '_') ||
           handleType.startsWith(HANDLE_TYPES.LEADER_KNEE + '_'))) {
        const isTip = handleType.startsWith(HANDLE_TYPES.LEADER_TIP + '_');
        const prefix = isTip ? (HANDLE_TYPES.LEADER_TIP + '_') : (HANDLE_TYPES.LEADER_KNEE + '_');
        const leaderId = handleType.substring(prefix.length);
        const origLeaders = Array.isArray(originalAnn.leaders) ? originalAnn.leaders : [];
        const newLeaders = origLeaders.map(l => ({ ...l }));
        const idx = newLeaders.findIndex(l => l.id === leaderId);
        // Shift held → ortho-snap: constrain delta to dominant axis (horizontal or vertical)
        let dx = deltaX, dy = deltaY;
        if (state.shiftKeyPressed) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
        }
        if (idx >= 0) {
          if (isTip) {
            newLeaders[idx].tipX = origLeaders[idx].tipX + dx;
            newLeaders[idx].tipY = origLeaders[idx].tipY + dy;
          } else {
            newLeaders[idx].kneeX = origLeaders[idx].kneeX + dx;
            newLeaders[idx].kneeY = origLeaders[idx].kneeY + dy;
          }
        }
        annotation.leaders = newLeaders;
        annotation.modifiedAt = new Date().toISOString();
        return;
      }
      if (originalAnn.rotation) {
        applyRotatedResize(annotation, handleType, deltaX, deltaY, originalAnn);
      } else {
        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.y = originalAnn.y + deltaY;
            annotation.width = originalAnn.width - deltaX;
            annotation.height = originalAnn.height - deltaY;
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            annotation.y = originalAnn.y + deltaY;
            annotation.width = originalAnn.width + deltaX;
            annotation.height = originalAnn.height - deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.width = originalAnn.width - deltaX;
            annotation.height = originalAnn.height + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            annotation.width = originalAnn.width + deltaX;
            annotation.height = originalAnn.height + deltaY;
            break;
          case HANDLE_TYPES.TOP:
            annotation.y = originalAnn.y + deltaY;
            annotation.height = originalAnn.height - deltaY;
            break;
          case HANDLE_TYPES.BOTTOM:
            annotation.height = originalAnn.height + deltaY;
            break;
          case HANDLE_TYPES.LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.width = originalAnn.width - deltaX;
            break;
          case HANDLE_TYPES.RIGHT:
            annotation.width = originalAnn.width + deltaX;
            break;
        }
        // Ensure minimum size
        if (annotation.width < 10) annotation.width = 10;
        if (annotation.height < 10) annotation.height = 10;
      }
      break;

    case 'callout':
      // Initialize width/height if not set
      if (!originalAnn.width) originalAnn.width = 150;
      if (!originalAnn.height) originalAnn.height = 50;

      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.CALLOUT_MOVE:
          // Move entire callout (box + arrow + all points)
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.arrowX = (originalAnn.arrowX || originalAnn.x - 60) + deltaX;
          annotation.arrowY = (originalAnn.arrowY || originalAnn.y + originalAnn.height) + deltaY;
          annotation.kneeX = (originalAnn.kneeX || originalAnn.x - 30) + deltaX;
          annotation.kneeY = (originalAnn.kneeY || originalAnn.y + originalAnn.height / 2) + deltaY;
          annotation.armOriginX = (originalAnn.armOriginX || originalAnn.x) + deltaX;
          annotation.armOriginY = (originalAnn.armOriginY || originalAnn.y + originalAnn.height / 2) + deltaY;
          break;
        case HANDLE_TYPES.CALLOUT_ARROW:
          // Move arrow tip
          annotation.arrowX = (originalAnn.arrowX || originalAnn.x - 60) + deltaX;
          annotation.arrowY = (originalAnn.arrowY || originalAnn.y + originalAnn.height) + deltaY;
          break;
        case HANDLE_TYPES.CALLOUT_KNEE:
          // Constrain to the arm direction: horizontal arm → move X only, vertical arm → move Y only
          if (annotation._leaderVertical) {
            annotation.kneeY = (originalAnn.kneeY || originalAnn.y + originalAnn.height / 2) + deltaY;
          } else {
            annotation.kneeX = (originalAnn.kneeX || originalAnn.x - 30) + deltaX;
          }
          break;
      }
      // Ensure minimum size
      if (annotation.width < 50) annotation.width = 50;
      if (annotation.height < 30) annotation.height = 30;
      // Recalculate leader line geometry (skip for move-all, already correct)
      if (handleType === HANDLE_TYPES.CALLOUT_MOVE) {
        // Everything moved together, no recalc needed
      } else if (handleType === HANDLE_TYPES.CALLOUT_KNEE) {
        // Preserve user's knee offset in the arm direction, recalc everything else
        const isVert = annotation._leaderVertical;
        const userKneeX = annotation.kneeX;
        const userKneeY = annotation.kneeY;
        recalcCalloutLeader(annotation);
        if (isVert) {
          annotation.kneeY = userKneeY;
        } else {
          annotation.kneeX = userKneeX;
        }
      } else {
        recalcCalloutLeader(annotation);
      }
      break;

    // De stavenreeks bewerkt als een lijn — met één verschil: de grijppunten
    // zitten op de WAPENINGSPUNTEN (zie handles.js), niet op de uiteinden van
    // de aanhaallijn. Slepen moet dus het PUNT onder de cursor krijgen, en het
    // bijbehorende lijn-uiteinde daaruit terugrekenen. Omdat het punt via de
    // pootvector aan de LIJNRICHTING hangt, is dat geen simpele aftrekking:
    // lineEndForDotTarget() lost de vergelijking exact op (gesloten vorm), zodat
    // het punt onder de cursor blijft ook als de reeks tijdens het slepen draait.
    case 'stavenreeks': {
      if (handleType !== HANDLE_TYPES.LINE_START && handleType !== HANDLE_TYPES.LINE_END) break;
      const movingStart = handleType === HANDLE_TYPES.LINE_START;
      const anchors = handleAnchors(originalAnn);
      const srp = resolveParams(originalAnn);
      // Doelpositie van het punt = waar het bij drag-start stond + de sleep.
      const anchor = movingStart ? anchors.start : anchors.end;
      const target = { x: anchor.x + deltaX, y: anchor.y + deltaY };
      // Het andere lijn-uiteinde blijft staan.
      const fixed = movingStart
        ? { x: originalAnn.endX, y: originalAnn.endY }
        : { x: originalAnn.startX, y: originalAnn.startY };
      let solved = lineEndForDotTarget(
        fixed, target, movingStart ? 'start' : 'end', srp.legDir, srp.legLength,
      );
      // Geen oplossing (cursor te dicht op het vaste uiteinde): val terug op
      // het directe gedrag — het uiteinde volgt de sleep — zodat de vorm niet
      // wegspringt.
      if (!solved) {
        solved = movingStart
          ? { x: originalAnn.startX + deltaX, y: originalAnn.startY + deltaY }
          : { x: originalAnn.endX + deltaX, y: originalAnn.endY + deltaY };
      }
      if (shiftKey && state.preferences.enableAngleSnap) {
        // Snap de REEKSLIJN op vaste hoeken rond het stilstaande uiteinde,
        // met behoud van de zojuist bepaalde lengte.
        const sdx = solved.x - fixed.x;
        const sdy = solved.y - fixed.y;
        const slen = Math.sqrt(sdx * sdx + sdy * sdy);
        const snapped = snapAngle(
          Math.atan2(sdy, sdx) * (180 / Math.PI),
          state.preferences.angleSnapDegrees,
        ) * (Math.PI / 180);
        solved = { x: fixed.x + slen * Math.cos(snapped), y: fixed.y + slen * Math.sin(snapped) };
      }
      if (movingStart) {
        annotation.startX = solved.x;
        annotation.startY = solved.y;
      } else {
        annotation.endX = solved.x;
        annotation.endY = solved.y;
      }
      break;
    }

    case 'wall':
    case 'betonbalk':
    case 'line':
    case 'arrow':
      // Betonbalk-tag verslepen: alleen de vrije paginaruimte-offset van de
      // tag verschuift — de balkgeometrie zelf blijft onaangeroerd.
      if (handleType === 'betonbalk_tag') {
        annotation.tagOffsetX = (originalAnn.tagOffsetX || 0) + deltaX;
        annotation.tagOffsetY = (originalAnn.tagOffsetY || 0) + deltaY;
        break;
      }
      if (handleType === HANDLE_TYPES.LINE_START) {
        let newStartX = originalAnn.startX + deltaX;
        let newStartY = originalAnn.startY + deltaY;
        if (shiftKey && state.preferences.enableAngleSnap) {
          const fixedX = originalAnn.endX;
          const fixedY = originalAnn.endY;
          const dx = newStartX - fixedX;
          const dy = newStartY - fixedY;
          const length = Math.sqrt(dx * dx + dy * dy);
          const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const snappedAngle = snapAngle(currentAngle, state.preferences.angleSnapDegrees) * (Math.PI / 180);
          newStartX = fixedX + length * Math.cos(snappedAngle);
          newStartY = fixedY + length * Math.sin(snappedAngle);
        }
        annotation.startX = newStartX;
        annotation.startY = newStartY;
      } else if (handleType === HANDLE_TYPES.LINE_END) {
        let newEndX = originalAnn.endX + deltaX;
        let newEndY = originalAnn.endY + deltaY;
        if (shiftKey && state.preferences.enableAngleSnap) {
          const fixedX = originalAnn.startX;
          const fixedY = originalAnn.startY;
          const dx = newEndX - fixedX;
          const dy = newEndY - fixedY;
          const length = Math.sqrt(dx * dx + dy * dy);
          const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const snappedAngle = snapAngle(currentAngle, state.preferences.angleSnapDegrees) * (Math.PI / 180);
          newEndX = fixedX + length * Math.cos(snappedAngle);
          newEndY = fixedY + length * Math.sin(snappedAngle);
        }
        annotation.endX = newEndX;
        annotation.endY = newEndY;
      }
      break;

    case 'measureDistance': {
      if (handleType === HANDLE_TYPES.LEADER_START || handleType === HANDLE_TYPES.LEADER_END) {
        // Outer handles: move freely, define the measured points
        let newLSX = handleType === HANDLE_TYPES.LEADER_START
          ? originalAnn.leaderStartX + deltaX : originalAnn.leaderStartX;
        let newLSY = handleType === HANDLE_TYPES.LEADER_START
          ? originalAnn.leaderStartY + deltaY : originalAnn.leaderStartY;
        let newLEX = handleType === HANDLE_TYPES.LEADER_END
          ? originalAnn.leaderEndX + deltaX : originalAnn.leaderEndX;
        let newLEY = handleType === HANDLE_TYPES.LEADER_END
          ? originalAnn.leaderEndY + deltaY : originalAnn.leaderEndY;

        // Snap to angle increments when Shift is held
        if (shiftKey && state.preferences.enableAngleSnap) {
          if (handleType === HANDLE_TYPES.LEADER_START) {
            const dx = newLSX - newLEX;
            const dy = newLSY - newLEY;
            const len = Math.sqrt(dx * dx + dy * dy);
            const cur = Math.atan2(dy, dx) * (180 / Math.PI);
            const snapped = snapAngle(cur, state.preferences.angleSnapDegrees) * (Math.PI / 180);
            newLSX = newLEX + len * Math.cos(snapped);
            newLSY = newLEY + len * Math.sin(snapped);
          } else {
            const dx = newLEX - newLSX;
            const dy = newLEY - newLSY;
            const len = Math.sqrt(dx * dx + dy * dy);
            const cur = Math.atan2(dy, dx) * (180 / Math.PI);
            const snapped = snapAngle(cur, state.preferences.angleSnapDegrees) * (Math.PI / 180);
            newLEX = newLSX + len * Math.cos(snapped);
            newLEY = newLSY + len * Math.sin(snapped);
          }
        }

        // Ctrl key: snap distance between leader tips to nearest 10 units
        if (ctrlKey) {
          if (handleType === HANDLE_TYPES.LEADER_START) {
            const s = snapDistanceTo10(newLEX, newLEY, newLSX, newLSY);
            newLSX = s.x; newLSY = s.y;
          } else {
            const s = snapDistanceTo10(newLSX, newLSY, newLEX, newLEY);
            newLEX = s.x; newLEY = s.y;
          }
        }

        // Snap to alignment with the other leader point
        const dimAlignTol = 3 / (state.documents?.[state.activeDocumentIndex]?.scale || 1.5);
        if (handleType === HANDLE_TYPES.LEADER_START) {
          if (Math.abs(newLSY - newLEY) < dimAlignTol) newLSY = newLEY;
          if (Math.abs(newLSX - newLEX) < dimAlignTol) newLSX = newLEX;
        } else {
          if (Math.abs(newLEY - newLSY) < dimAlignTol) newLEY = newLSY;
          if (Math.abs(newLEX - newLSX) < dimAlignTol) newLEX = newLSX;
        }

        annotation.leaderStartX = newLSX;
        annotation.leaderStartY = newLSY;
        annotation.leaderEndX = newLEX;
        annotation.leaderEndY = newLEY;

        // Recompute dimension line: keep the same perpendicular offset from leader tips
        // Compute perpDist from ORIGINAL geometry (so it stays constant at any angle)
        const origLDx = originalAnn.leaderEndX - originalAnn.leaderStartX;
        const origLDy = originalAnn.leaderEndY - originalAnn.leaderStartY;
        const origLLen = Math.sqrt(origLDx * origLDx + origLDy * origLDy) || 1;
        const origPerpX = -origLDy / origLLen;
        const origPerpY = origLDx / origLLen;
        const offDx = originalAnn.startX - originalAnn.leaderStartX;
        const offDy = originalAnn.startY - originalAnn.leaderStartY;
        const perpDist = offDx * origPerpX + offDy * origPerpY;
        // Apply that fixed offset along the NEW perpendicular direction
        const newLDx = newLEX - newLSX;
        const newLDy = newLEY - newLSY;
        const newLLen = Math.sqrt(newLDx * newLDx + newLDy * newLDy) || 1;
        const perpX = -newLDy / newLLen;
        const perpY = newLDx / newLLen;
        // Place dimension line endpoints at the perpendicular offset from new leader tips
        annotation.startX = newLSX + perpDist * perpX;
        annotation.startY = newLSY + perpDist * perpY;
        annotation.endX = newLEX + perpDist * perpX;
        annotation.endY = newLEY + perpDist * perpY;

        syncDimensionMeasurement(annotation);
      } else if ((handleType === HANDLE_TYPES.LINE_START || handleType === HANDLE_TYPES.LINE_END)
                 && originalAnn.leaderStartX === undefined) {
        // Dimension WITHOUT extension lines (e.g. imported without /LL): the
        // dimension-line endpoints ARE the measured points. Move them freely,
        // exactly like line/arrow endpoints, and recompute the measurement.
        // (The old perpendicular-offset math below divides by the leader
        // vector, which does not exist here — it would corrupt the geometry.)
        const isStart = handleType === HANDLE_TYPES.LINE_START;
        let newPX = (isStart ? originalAnn.startX : originalAnn.endX) + deltaX;
        let newPY = (isStart ? originalAnn.startY : originalAnn.endY) + deltaY;
        const fixedX = isStart ? originalAnn.endX : originalAnn.startX;
        const fixedY = isStart ? originalAnn.endY : originalAnn.startY;
        if (shiftKey && state.preferences.enableAngleSnap) {
          const dx = newPX - fixedX;
          const dy = newPY - fixedY;
          const length = Math.sqrt(dx * dx + dy * dy);
          const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const snappedAngle = snapAngle(currentAngle, state.preferences.angleSnapDegrees) * (Math.PI / 180);
          newPX = fixedX + length * Math.cos(snappedAngle);
          newPY = fixedY + length * Math.sin(snappedAngle);
        }
        // Ctrl key: snap measured distance to nearest N units
        if (ctrlKey) {
          const s = snapDistanceTo10(fixedX, fixedY, newPX, newPY);
          newPX = s.x; newPY = s.y;
        }
        if (isStart) {
          annotation.startX = newPX;
          annotation.startY = newPY;
        } else {
          annotation.endX = newPX;
          annotation.endY = newPY;
        }
        syncDimensionMeasurement(annotation);
      } else if (handleType === HANDLE_TYPES.LINE_START || handleType === HANDLE_TYPES.LINE_END) {
        // Inner handles: constrain to perpendicular direction only (change offset, not measurement)
        // Perpendicular direction based on the leader line
        const ldrDx = originalAnn.leaderEndX - originalAnn.leaderStartX;
        const ldrDy = originalAnn.leaderEndY - originalAnn.leaderStartY;
        const ldrLen = Math.sqrt(ldrDx * ldrDx + ldrDy * ldrDy) || 1;
        const pX = -ldrDy / ldrLen;
        const pY = ldrDx / ldrLen;
        // Project mouse delta onto perpendicular
        const pDot = deltaX * pX + deltaY * pY;
        // Move both dimension line endpoints together (keep parallel to leader line)
        annotation.startX = originalAnn.startX + pDot * pX;
        annotation.startY = originalAnn.startY + pDot * pY;
        annotation.endX = originalAnn.endX + pDot * pX;
        annotation.endY = originalAnn.endY + pDot * pY;
      } else if (handleType === HANDLE_TYPES.LABEL_MOVE) {
        // Text handle: drag the measurement text independent of the line.
        // Stored as an OFFSET from the dimension-line midpoint so the text
        // follows the line on move/endpoint edits. Default (0,0) = on the line.
        annotation.textOffsetX = (originalAnn.textOffsetX || 0) + deltaX;
        annotation.textOffsetY = (originalAnn.textOffsetY || 0) + deltaY;
      }
      break;
    }

    case 'measureAngle': {
      // Node drag for angle measurement
      if (typeof handleType === 'string' && handleType.startsWith('polyline_node_')) {
        const angleNodeIdx = parseInt(handleType.split('_').pop(), 10);
        const anglePoints = [
          { ...originalAnn.point1 },
          { ...originalAnn.vertex },
          { ...originalAnn.point2 },
        ];
        if (angleNodeIdx >= 0 && angleNodeIdx < 3) {
          anglePoints[angleNodeIdx].x += deltaX;
          anglePoints[angleNodeIdx].y += deltaY;
          // Snap to sibling vertex alignment
          const angAlignTol = 3 / (state.documents?.[state.activeDocumentIndex]?.scale || 1.5);
          for (let ai = 0; ai < 3; ai++) {
            if (ai === angleNodeIdx) continue;
            if (Math.abs(anglePoints[angleNodeIdx].y - anglePoints[ai].y) < angAlignTol) anglePoints[angleNodeIdx].y = anglePoints[ai].y;
            if (Math.abs(anglePoints[angleNodeIdx].x - anglePoints[ai].x) < angAlignTol) anglePoints[angleNodeIdx].x = anglePoints[ai].x;
          }
        }
        annotation.point1 = anglePoints[0];
        annotation.vertex = anglePoints[1];
        annotation.point2 = anglePoints[2];
        // Recalculate angle
        const a1 = Math.atan2(annotation.point1.y - annotation.vertex.y, annotation.point1.x - annotation.vertex.x);
        const a2 = Math.atan2(annotation.point2.y - annotation.vertex.y, annotation.point2.x - annotation.vertex.x);
        let angleDeg = (a2 - a1) * (180 / Math.PI);
        if (angleDeg < 0) angleDeg += 360;
        if (angleDeg > 180) angleDeg = 360 - angleDeg;
        annotation.measureValue = angleDeg;
        annotation.measureText = angleDeg.toFixed(1) + '\u00B0';
      }
      break;
    }

    case 'draw':
      // Scale the path based on bounding box resize
      if (originalAnn.path && originalAnn.path.length > 0) {
        const minX = Math.min(...originalAnn.path.map(p => p.x));
        const minY = Math.min(...originalAnn.path.map(p => p.y));
        const maxX = Math.max(...originalAnn.path.map(p => p.x));
        const maxY = Math.max(...originalAnn.path.map(p => p.y));
        const origWidth = maxX - minX || 1;
        const origHeight = maxY - minY || 1;

        let newMinX = minX, newMinY = minY, newMaxX = maxX, newMaxY = maxY;

        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            newMinX = minX + deltaX;
            newMinY = minY + deltaY;
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            newMaxX = maxX + deltaX;
            newMinY = minY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            newMinX = minX + deltaX;
            newMaxY = maxY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            newMaxX = maxX + deltaX;
            newMaxY = maxY + deltaY;
            break;
        }

        const newWidth = newMaxX - newMinX || 1;
        const newHeight = newMaxY - newMinY || 1;
        const scaleX = newWidth / origWidth;
        const scaleY = newHeight / origHeight;

        annotation.path = originalAnn.path.map(p => ({
          x: newMinX + (p.x - minX) * scaleX,
          y: newMinY + (p.y - minY) * scaleY
        }));
      }
      break;

    case 'polyline':
    case 'splineArrow':
    case 'cloudPolyline':
    case 'measureArea':
    case 'measurePerimeter':
    case 'filledArea':
    case 'systeemraster':
      // Label drag for measureArea
      if (handleType === HANDLE_TYPES.LABEL_MOVE && annotation.type === 'measureArea') {
        // Compute centroid as default if no label position set
        let baseLx, baseLy;
        if (originalAnn.labelX != null && originalAnn.labelY != null) {
          baseLx = originalAnn.labelX;
          baseLy = originalAnn.labelY;
        } else {
          baseLx = 0; baseLy = 0;
          for (const p of originalAnn.points) { baseLx += p.x; baseLy += p.y; }
          baseLx /= originalAnn.points.length;
          baseLy /= originalAnn.points.length;
        }
        annotation.labelX = baseLx + deltaX;
        annotation.labelY = baseLy + deltaY;
        break;
      }
      // Drag individual node
      // Punt-kopie die de boogvelden (arc/bulge — filledArea én
      // systeemraster) BEHOUDT: de node-sleep herbouwde points[] eerder met
      // kale {x,y}, waardoor een eerder gebogen segment weer recht werd.
      const keepArc = copyPointKeepArc;
      if (typeof handleType === 'string' && handleType.startsWith(HANDLE_TYPES.POLYLINE_NODE + '_')) {
        // Check if this is a hole node: polyline_node_hole_<holeIdx>_<nodeIdx>
        const holeMatch = handleType.match(/^polyline_node_hole_(\d+)_(\d+)$/);
        if (holeMatch && (annotation.type === 'measureArea' || annotation.type === 'filledArea') && originalAnn.holes) {
          const holeIdx = parseInt(holeMatch[1], 10);
          const nodeIdx = parseInt(holeMatch[2], 10);
          if (holeIdx < originalAnn.holes.length && nodeIdx < originalAnn.holes[holeIdx].length) {
            annotation.holes = originalAnn.holes.map((hole, hi) => {
              if (hi !== holeIdx) return hole.map(p => keepArc(p, p.x, p.y));
              return hole.map((p, ni) => {
                if (ni !== nodeIdx) return keepArc(p, p.x, p.y);
                let nx = p.x + deltaX, ny = p.y + deltaY;
                if (shiftKey) {
                  const len = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                  if (len > 0) {
                    const ang = snapAngle(Math.atan2(deltaY, deltaX) * (180 / Math.PI), 45) * (Math.PI / 180);
                    nx = p.x + len * Math.cos(ang);
                    ny = p.y + len * Math.sin(ang);
                  }
                }
                return keepArc(p, nx, ny);
              });
            });
            // Recalculate measurement text with holes
            annotation.measureText = formatMeasurement(calculateArea(annotation.points, annotation.holes, annotation.page));
          }
        } else {
          // Regular outer node drag
          const nodeIdx = parseInt(handleType.split('_').pop(), 10);
          if (originalAnn.points && !isNaN(nodeIdx) && nodeIdx < originalAnn.points.length) {
            annotation.points = originalAnn.points.map((p, i) => {
              if (i === nodeIdx) {
                let nx = p.x + deltaX, ny = p.y + deltaY;
                // Shift key: constrain movement to horizontal/vertical/diagonal
                if (shiftKey) {
                  const len = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                  if (len > 0) {
                    const ang = snapAngle(Math.atan2(deltaY, deltaX) * (180 / Math.PI), 45) * (Math.PI / 180);
                    nx = p.x + len * Math.cos(ang);
                    ny = p.y + len * Math.sin(ang);
                  }
                }
                // Ctrl key: snap segment to previous point to nearest N units (measure types only)
                if (ctrlKey && (annotation.type === 'measureArea' || annotation.type === 'measurePerimeter')) {
                  const prevIdx = i > 0 ? i - 1 : originalAnn.points.length - 1;
                  const prev = originalAnn.points[prevIdx];
                  if (prev && prevIdx !== i) {
                    const s = snapDistanceTo10(prev.x, prev.y, nx, ny);
                    nx = s.x; ny = s.y;
                  }
                }
                // Snap to sibling vertex alignment (horizontal/vertical)
                const alignTol = 3 / (state.documents?.[state.activeDocumentIndex]?.scale || 1.5);
                for (let si = 0; si < originalAnn.points.length; si++) {
                  if (si === i) continue;
                  const sp = originalAnn.points[si];
                  if (Math.abs(ny - sp.y) < alignTol) ny = sp.y;
                  if (Math.abs(nx - sp.x) < alignTol) nx = sp.x;
                }
                return keepArc(p, nx, ny);
              }
              return keepArc(p, p.x, p.y);
            });
            // Recalculate bounding box — boog-bewust: bij boogsegmenten
            // (arc/bulge op de punten) moet de bbox de uitstulping omvatten,
            // dus rekenen we op de vlakke uitslag i.p.v. de kale hoekpunten.
            const bboxPts = annotation.points.some(p => p.arc === true)
              ? srFlattenContour(annotation.points)
              : annotation.points;
            const xs = bboxPts.map(p => p.x);
            const ys = bboxPts.map(p => p.y);
            annotation.x = Math.min(...xs);
            annotation.y = Math.min(...ys);
            annotation.width = Math.max(...xs) - annotation.x;
            annotation.height = Math.max(...ys) - annotation.y;
            // Recalculate measurement text (with holes if present)
            if (annotation.type === 'measureArea') {
              annotation.measureText = formatMeasurement(calculateArea(annotation.points, annotation.holes, annotation.page));
            } else if (annotation.type === 'measurePerimeter') {
              annotation.measureText = formatMeasurement(calculatePerimeter(annotation.points, annotation.page));
            }
          }
        }
      }
      break;

    case 'viewport':
    case 'scaleRegion': {
      // Viewport / scale region: standard rectangle resize, minimum 40x40
      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX; annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX; annotation.height = originalAnn.height - deltaY; break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX; annotation.height = originalAnn.height - deltaY; break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX; annotation.height = originalAnn.height + deltaY; break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX; annotation.height = originalAnn.height + deltaY; break;
        case HANDLE_TYPES.TOP:
          annotation.y = originalAnn.y + deltaY; annotation.height = originalAnn.height - deltaY; break;
        case HANDLE_TYPES.BOTTOM:
          annotation.height = originalAnn.height + deltaY; break;
        case HANDLE_TYPES.LEFT:
          annotation.x = originalAnn.x + deltaX; annotation.width = originalAnn.width - deltaX; break;
        case HANDLE_TYPES.RIGHT:
          annotation.width = originalAnn.width + deltaX; break;
      }
      if (annotation.width < 40) annotation.width = 40;
      if (annotation.height < 40) annotation.height = 40;
      break;
    }

    case 'image':
    case 'stamp':
    case 'signature':
    case 'scaleBar':
    case 'scheduleTable':
    case 'parametricSymbol': {
      if (annotation.type === 'parametricSymbol'
          && getTemplate(annotation.symbolId)?.placement === 'two-point') {
        const points = twoPointEndpoints(originalAnn);
        let startX = points.startX;
        let startY = points.startY;
        let endX = points.endX;
        let endY = points.endY;
        const movingStart = handleType === HANDLE_TYPES.LINE_START;
        const movingEnd = handleType === HANDLE_TYPES.LINE_END;
        if (!movingStart && !movingEnd) break;
        if (movingStart) {
          startX += deltaX;
          startY += deltaY;
        } else {
          endX += deltaX;
          endY += deltaY;
        }
        if (shiftKey && state.preferences.enableAngleSnap) {
          const fixedX = movingStart ? endX : startX;
          const fixedY = movingStart ? endY : startY;
          const movingX = movingStart ? startX : endX;
          const movingY = movingStart ? startY : endY;
          const length = Math.hypot(movingX - fixedX, movingY - fixedY);
          const angle = snapAngle(
            Math.atan2(movingY - fixedY, movingX - fixedX) * 180 / Math.PI,
            state.preferences.angleSnapDegrees,
          ) * Math.PI / 180;
          if (movingStart) {
            startX = fixedX + length * Math.cos(angle);
            startY = fixedY + length * Math.sin(angle);
          } else {
            endX = fixedX + length * Math.cos(angle);
            endY = fixedY + length * Math.sin(angle);
          }
        }
        syncTwoPointGeometry(
          annotation, startX, startY, endX, endY, originalAnn.height,
        );
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        syncTwoPointLengthParam(annotation, pxPerMmAt(annotation.page, midX, midY));
        break;
      }
      const lockRatio = shiftKey || annotation.lockAspectRatio;
      if (originalAnn.rotation) {
        applyRotatedResize(annotation, handleType, deltaX, deltaY, originalAnn, lockRatio);
      } else {
        const aspectRatio = originalAnn.originalWidth && originalAnn.originalHeight
          ? originalAnn.originalWidth / originalAnn.originalHeight
          : originalAnn.width / originalAnn.height;

        if (lockRatio && aspectRatio > 0) {
          // Aspect-ratio-locked resize (issue #283). Derive both axes from a
          // single ratio-preserving width, then clamp BOTH axes proportionally
          // — re-deriving the partner axis from the clamped one — so the ratio
          // holds at every drag distance. The previous code clamped width and
          // height to the minimum independently, which broke the ratio once the
          // shorter axis dropped below the 20px floor ("past a certain point"),
          // and let the size go negative when a handle was dragged past its
          // anchor. Position is computed from the fixed anchor AFTER the clamp
          // so the box never drifts.
          //
          // The floor bounds the LONGEST axis, not both axes independently
          // (issue #315). A single 20-unit floor on width AND height freezes a
          // very wide (or very tall) image long before it looks small: a
          // 188 x 24 pt scale-bar image hits the 20-unit height floor while it
          // is still 159 pt wide, and from there every further drag re-derives
          // the exact same 159 x 20 box — the annotation appears stuck. With
          // the floor on the long axis the ratio can always be honored; for a
          // square-ish image (ratio 1) MIN_W/MIN_H are both 20, identical to
          // the previous behavior.
          const MIN_LONG = 20;
          const MIN_W = aspectRatio >= 1 ? MIN_LONG : MIN_LONG * aspectRatio;
          const MIN_H = MIN_W / aspectRatio;
          const ox = originalAnn.x, oy = originalAnn.y;
          const ow = originalAnn.width, oh = originalAnn.height;

          // 1. Ratio-preserving width from the drag. For corners take the
          //    dominant delta (width- vs height-driven) so diagonal drags stay
          //    natural; edges drive from their own axis.
          let newWidth;
          switch (handleType) {
            case HANDLE_TYPES.TOP_LEFT:
            case HANDLE_TYPES.BOTTOM_LEFT: {
              const hSign = (handleType === HANDLE_TYPES.BOTTOM_LEFT) ? 1 : -1;
              const wFromX = ow - deltaX;
              const wFromY = (oh + hSign * deltaY) * aspectRatio;
              newWidth = Math.abs(deltaX) >= Math.abs(deltaY) ? wFromX : wFromY;
              break;
            }
            case HANDLE_TYPES.TOP_RIGHT:
            case HANDLE_TYPES.BOTTOM_RIGHT: {
              const hSign = (handleType === HANDLE_TYPES.BOTTOM_RIGHT) ? 1 : -1;
              const wFromX = ow + deltaX;
              const wFromY = (oh + hSign * deltaY) * aspectRatio;
              newWidth = Math.abs(deltaX) >= Math.abs(deltaY) ? wFromX : wFromY;
              break;
            }
            case HANDLE_TYPES.LEFT:   newWidth = ow - deltaX; break;
            case HANDLE_TYPES.RIGHT:  newWidth = ow + deltaX; break;
            case HANDLE_TYPES.TOP:    newWidth = (oh - deltaY) * aspectRatio; break;
            case HANDLE_TYPES.BOTTOM: newWidth = (oh + deltaY) * aspectRatio; break;
            default:                  newWidth = ow;
          }

          // 2. Proportional clamp. A width <= 0 (dragged past the anchor) is
          //    below the floor, so it collapses to the minimum rather than
          //    flipping. Both tests describe the same box, the second only
          //    catches float residue from the division above.
          let newHeight = newWidth / aspectRatio;
          if (newWidth < MIN_W)  { newWidth = MIN_W;  newHeight = newWidth / aspectRatio; }
          if (newHeight < MIN_H) { newHeight = MIN_H; newWidth = newHeight * aspectRatio; }

          // 3. Place from the fixed anchor using the final size.
          let nx = ox, ny = oy;
          switch (handleType) {
            case HANDLE_TYPES.TOP_LEFT:
              nx = ox + ow - newWidth; ny = oy + oh - newHeight; break;
            case HANDLE_TYPES.TOP_RIGHT:
              ny = oy + oh - newHeight; break;
            case HANDLE_TYPES.BOTTOM_LEFT:
              nx = ox + ow - newWidth; break;
            case HANDLE_TYPES.BOTTOM_RIGHT:
              break;
            case HANDLE_TYPES.TOP:
              nx = ox + (ow - newWidth) / 2; ny = oy + oh - newHeight; break;
            case HANDLE_TYPES.BOTTOM:
              nx = ox + (ow - newWidth) / 2; break;
            case HANDLE_TYPES.LEFT:
              nx = ox + ow - newWidth; ny = oy + (oh - newHeight) / 2; break;
            case HANDLE_TYPES.RIGHT:
              ny = oy + (oh - newHeight) / 2; break;
          }
          annotation.x = nx; annotation.y = ny;
          annotation.width = newWidth; annotation.height = newHeight;
        } else {
          switch (handleType) {
            case HANDLE_TYPES.TOP_LEFT:
              annotation.x = originalAnn.x + deltaX;
              annotation.y = originalAnn.y + deltaY;
              annotation.width = originalAnn.width - deltaX;
              annotation.height = originalAnn.height - deltaY;
              break;
            case HANDLE_TYPES.TOP_RIGHT:
              annotation.y = originalAnn.y + deltaY;
              annotation.width = originalAnn.width + deltaX;
              annotation.height = originalAnn.height - deltaY;
              break;
            case HANDLE_TYPES.BOTTOM_LEFT:
              annotation.x = originalAnn.x + deltaX;
              annotation.width = originalAnn.width - deltaX;
              annotation.height = originalAnn.height + deltaY;
              break;
            case HANDLE_TYPES.BOTTOM_RIGHT:
              annotation.width = originalAnn.width + deltaX;
              annotation.height = originalAnn.height + deltaY;
              break;
            case HANDLE_TYPES.TOP:
              annotation.y = originalAnn.y + deltaY;
              annotation.height = originalAnn.height - deltaY;
              break;
            case HANDLE_TYPES.BOTTOM:
              annotation.height = originalAnn.height + deltaY;
              break;
            case HANDLE_TYPES.LEFT:
              annotation.x = originalAnn.x + deltaX;
              annotation.width = originalAnn.width - deltaX;
              break;
            case HANDLE_TYPES.RIGHT:
              annotation.width = originalAnn.width + deltaX;
              break;
          }
          // Ensure minimum size
          if (annotation.width < 20) annotation.width = 20;
          if (annotation.height < 20) annotation.height = 20;
        }
      }
      break;
    }

    case 'comment':
      // Initialize width/height if not set
      if (!originalAnn.width) originalAnn.width = 24;
      if (!originalAnn.height) originalAnn.height = 24;

      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.TOP:
          annotation.y = originalAnn.y + deltaY;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM:
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          break;
        case HANDLE_TYPES.RIGHT:
          annotation.width = originalAnn.width + deltaX;
          break;
      }
      // Ensure minimum size
      if (annotation.width < 20) annotation.width = 20;
      if (annotation.height < 20) annotation.height = 20;
      break;

    default:
      // Plugin rect/oval-area resize: types that use {x, y, w, h} (not
      // width/height) get corner/edge resize support here. Mirrors the
      // built-in 'box' case but writes to `w`/`h` instead.
      if (
        typeof originalAnn.x === 'number'
        && typeof originalAnn.y === 'number'
        && typeof originalAnn.w === 'number'
        && typeof originalAnn.h === 'number'
        && typeof handleType === 'string'
        && !handleType.startsWith('polyline_node_')
      ) {
        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.y = originalAnn.y + deltaY;
            annotation.w = originalAnn.w - deltaX;
            annotation.h = originalAnn.h - deltaY;
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            annotation.y = originalAnn.y + deltaY;
            annotation.w = originalAnn.w + deltaX;
            annotation.h = originalAnn.h - deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.w = originalAnn.w - deltaX;
            annotation.h = originalAnn.h + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            annotation.w = originalAnn.w + deltaX;
            annotation.h = originalAnn.h + deltaY;
            break;
          case HANDLE_TYPES.TOP:
            annotation.y = originalAnn.y + deltaY;
            annotation.h = originalAnn.h - deltaY;
            break;
          case HANDLE_TYPES.BOTTOM:
            annotation.h = originalAnn.h + deltaY;
            break;
          case HANDLE_TYPES.LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.w = originalAnn.w - deltaX;
            break;
          case HANDLE_TYPES.RIGHT:
            annotation.w = originalAnn.w + deltaX;
            break;
        }
        // Minimum-size guard: collapsing below 10 px makes the shape
        // unreachable. Mirror the box-case minimum.
        if (annotation.w < 10) annotation.w = 10;
        if (annotation.h < 10) annotation.h = 10;
        break;
      }
      // Plugin polyline fallback: any annotation-type with a points array supports
      // polyline_node_<i> handle-drag identically to the builtin polyline case.
      if (typeof handleType === 'string' && handleType.startsWith('polyline_node_') &&
          originalAnn.points && Array.isArray(originalAnn.points)) {
        const nodeIdx = parseInt(handleType.split('_').pop(), 10);
        if (!isNaN(nodeIdx) && nodeIdx < originalAnn.points.length) {
          annotation.points = originalAnn.points.map((p, i) => {
            if (i === nodeIdx) {
              let nx = p.x + deltaX, ny = p.y + deltaY;
              if (shiftKey) {
                const len = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                if (len > 0) {
                  const ang = snapAngle(Math.atan2(deltaY, deltaX) * (180 / Math.PI), 45) * (Math.PI / 180);
                  nx = p.x + len * Math.cos(ang);
                  ny = p.y + len * Math.sin(ang);
                }
              }
              return { x: nx, y: ny };
            }
            return { x: p.x, y: p.y };
          });
          // Recalculate bounding box if annotation tracks x/y/width/height
          if (typeof annotation.x === 'number') {
            const xs = annotation.points.map(p => p.x);
            const ys = annotation.points.map(p => p.y);
            annotation.x = Math.min(...xs);
            annotation.y = Math.min(...ys);
            annotation.width = Math.max(...xs) - annotation.x;
            annotation.height = Math.max(...ys) - annotation.y;
          }
        }
      }
      break;
  }

  annotation.modifiedAt = new Date().toISOString();
}

// ── THE single move primitive ───────────────────────────────────────────────
// applyMove is a geometry-FIELD walker, not a per-type switch: it translates
// every known position-bearing field that exists on the annotation. Every
// annotation kind — built-ins (text, line, arc, circle, dimensions, areas),
// parametric symbols, plugin types and FUTURE types — moves through this one
// function and gets correct G/MV/drag behaviour for free, as long as its
// geometry lives in any of these conventional fields. NEVER add per-type
// move code in tools or panels; extend the field tables here instead.
const _MOVE_SCALAR_PAIRS = [
  ['x', 'y'],
  ['startX', 'startY'],
  ['endX', 'endY'],
  ['leaderStartX', 'leaderStartY'],
  ['leaderEndX', 'leaderEndY'],
  ['labelX', 'labelY'],
  ['cx', 'cy'],
];
// Nested {x,y} objects (measureAngle vertices, plugin point-markers, …)
const _MOVE_POINT_OBJECTS = ['at', 'vertex', 'point1', 'point2'];
// Arrays of {x,y} points (polylines, freehand paths, spline control points, …)
const _MOVE_POINT_ARRAYS = ['points', 'path', 'controlPoints', 'vertices'];

function _movePoint(p, dx, dy) {
  return {
    ...p,
    x: typeof p.x === 'number' ? p.x + dx : p.x,
    y: typeof p.y === 'number' ? p.y + dy : p.y,
  };
}

export function applyMoveGeneric(annotation, dx, dy) {
  for (const [kx, ky] of _MOVE_SCALAR_PAIRS) {
    if (typeof annotation[kx] === 'number') annotation[kx] += dx;
    if (typeof annotation[ky] === 'number') annotation[ky] += dy;
  }
  for (const k of _MOVE_POINT_OBJECTS) {
    const o = annotation[k];
    if (o && typeof o === 'object') {
      if (typeof o.x === 'number') o.x += dx;
      if (typeof o.y === 'number') o.y += dy;
    }
  }
  for (const k of _MOVE_POINT_ARRAYS) {
    if (Array.isArray(annotation[k])) {
      annotation[k] = annotation[k].map(p => _movePoint(p, dx, dy));
    }
  }
  // Hole contours move rigidly with the outer polygon (donuts).
  if (Array.isArray(annotation.holes)) {
    annotation.holes = annotation.holes.map(h =>
      Array.isArray(h) ? h.map(p => _movePoint(p, dx, dy)) : h
    );
  }
  // Text-markup rects + PDF quadPoints ([x1,y1,...,x4,y4] flat arrays).
  if (Array.isArray(annotation.rects)) {
    annotation.rects = annotation.rects.map(r => ({ ...r, x: r.x + dx, y: r.y + dy }));
  }
  if (Array.isArray(annotation.quadPoints)) {
    annotation.quadPoints = annotation.quadPoints.map(quad =>
      Array.isArray(quad) ? quad.map((v, i) => v + (i % 2 === 0 ? dx : dy)) : quad
    );
  }
  // Textbox leader arrows (tip/knee) move rigidly with the box.
  if (Array.isArray(annotation.leaders)) {
    annotation.leaders = annotation.leaders.map(l => ({
      ...l,
      tipX: typeof l.tipX === 'number' ? l.tipX + dx : l.tipX,
      tipY: typeof l.tipY === 'number' ? l.tipY + dy : l.tipY,
      kneeX: typeof l.kneeX === 'number' ? l.kneeX + dx : l.kneeX,
      kneeY: typeof l.kneeY === 'number' ? l.kneeY + dy : l.kneeY,
    }));
  }
}

// Apply move to annotation
export function applyMove(annotation, deltaX, deltaY) {
  if (annotation.locked) return;

  if (annotation.type === 'callout') {
    // Special semantics: moving a callout moves only the TEXT BOX — the
    // arrow tip stays anchored and the leader is recomputed.
    annotation.x += deltaX;
    annotation.y += deltaY;
    recalcCalloutLeader(annotation);
  } else {
    applyMoveGeneric(annotation, deltaX, deltaY);
  }

  annotation.modifiedAt = new Date().toISOString();
}

// ── Generic rotate walker ────────────────────────────────────────────────
// THE per-type rotate primitive for the interactive 'RO' session (see
// g-rotate-mode.js). Mirrors applyMove's contract: ONE walker over the same
// field tables, so every current and future annotation type rotates without
// per-type code elsewhere.
//
// Semantics:
//  * Point-bearing fields (start/end pairs, points[], holes, leaders, …)
//    rotate exactly around the shared pivot — a multi-selection orbits as a
//    rigid group.
//  * Rect-anchored types (x/y/width/height) orbit by their CENTRE (their
//    visual spin happens around the own centre via the rotation field, so
//    the anchor must follow the centre, not the top-left corner).
//  * Types that render a `rotation` field additionally get
//    rotation = original.rotation + deg.

// Types whose renderer honours annotation.rotation (same set as the rotate
// handle + applyRotation, plus the table/scalebar widgets).
const _ROTATION_FIELD_TYPES = new Set([
  'image', 'stamp', 'signature', 'comment', 'box', 'mask', 'circle', 'highlight',
  'polygon', 'cloud', 'textbox', 'parametricSymbol', 'scaleBar', 'scheduleTable'
]);

export function applyRotateGeneric(annotation, original, pivotX, pivotY, deg) {
  if (annotation.locked) return;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const rotX = (px, py) => pivotX + (px - pivotX) * cos - (py - pivotY) * sin;
  const rotY = (px, py) => pivotY + (px - pivotX) * sin + (py - pivotY) * cos;
  const rotPoint = (p) => {
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return p;
    return { ...p, x: rotX(p.x, p.y), y: rotY(p.x, p.y) };
  };

  // Anchor (x/y): rect-anchored types orbit by centre; bare x/y is a point.
  if (typeof annotation.x === 'number' && typeof annotation.y === 'number') {
    if (typeof annotation.width === 'number' && typeof annotation.height === 'number') {
      const cx = annotation.x + annotation.width / 2;
      const cy = annotation.y + annotation.height / 2;
      annotation.x = rotX(cx, cy) - annotation.width / 2;
      annotation.y = rotY(cx, cy) - annotation.height / 2;
    } else {
      const nx = rotX(annotation.x, annotation.y);
      const ny = rotY(annotation.x, annotation.y);
      annotation.x = nx;
      annotation.y = ny;
    }
  }
  if (_ROTATION_FIELD_TYPES.has(annotation.type)) {
    annotation.rotation = ((((original?.rotation || 0) + deg) % 360) + 360) % 360;
  }

  // Pure point fields rotate exactly around the pivot (skip the x/y anchor —
  // handled above).
  for (const [kx, ky] of _MOVE_SCALAR_PAIRS) {
    if (kx === 'x') continue;
    if (typeof annotation[kx] === 'number' && typeof annotation[ky] === 'number') {
      const nx = rotX(annotation[kx], annotation[ky]);
      const ny = rotY(annotation[kx], annotation[ky]);
      annotation[kx] = nx;
      annotation[ky] = ny;
    }
  }
  for (const k of _MOVE_POINT_OBJECTS) {
    const o = annotation[k];
    if (o && typeof o === 'object' && typeof o.x === 'number' && typeof o.y === 'number') {
      const nx = rotX(o.x, o.y);
      const ny = rotY(o.x, o.y);
      o.x = nx;
      o.y = ny;
    }
  }
  for (const k of _MOVE_POINT_ARRAYS) {
    if (Array.isArray(annotation[k])) {
      annotation[k] = annotation[k].map(rotPoint);
    }
  }
  if (Array.isArray(annotation.holes)) {
    annotation.holes = annotation.holes.map(h => (Array.isArray(h) ? h.map(rotPoint) : h));
  }
  // Axis-aligned markup rects can't tilt — orbit their anchor rigidly.
  if (Array.isArray(annotation.rects)) {
    annotation.rects = annotation.rects.map(r => ({ ...r, x: rotX(r.x, r.y), y: rotY(r.x, r.y) }));
  }
  if (Array.isArray(annotation.quadPoints)) {
    annotation.quadPoints = annotation.quadPoints.map(quad => {
      if (!Array.isArray(quad)) return quad;
      const out = quad.slice();
      for (let i = 0; i + 1 < out.length; i += 2) {
        const nx = rotX(out[i], out[i + 1]);
        const ny = rotY(out[i], out[i + 1]);
        out[i] = nx;
        out[i + 1] = ny;
      }
      return out;
    });
  }
  // Textbox leader arrows (tip/knee) rotate with the box.
  if (Array.isArray(annotation.leaders)) {
    annotation.leaders = annotation.leaders.map(l => {
      const out = { ...l };
      if (typeof out.tipX === 'number' && typeof out.tipY === 'number') {
        const nx = rotX(out.tipX, out.tipY);
        const ny = rotY(out.tipX, out.tipY);
        out.tipX = nx;
        out.tipY = ny;
      }
      if (typeof out.kneeX === 'number' && typeof out.kneeY === 'number') {
        const nx = rotX(out.kneeX, out.kneeY);
        const ny = rotY(out.kneeX, out.kneeY);
        out.kneeX = nx;
        out.kneeY = ny;
      }
      return out;
    });
  }
  // Callout: the arrow tip rotates around the pivot; the leader (knee/arm)
  // is then recomputed from the new box↔tip relation, like applyMove does.
  if (annotation.type === 'callout') {
    for (const [ax, ay] of [['arrowX', 'arrowY'], ['armOriginX', 'armOriginY']]) {
      if (typeof annotation[ax] === 'number' && typeof annotation[ay] === 'number') {
        const nx = rotX(annotation[ax], annotation[ay]);
        const ny = rotY(annotation[ax], annotation[ay]);
        annotation[ax] = nx;
        annotation[ay] = ny;
      }
    }
    recalcCalloutLeader(annotation);
  }

  annotation.modifiedAt = new Date().toISOString();
}

// Apply rotation to annotation
export function applyRotation(annotation, mouseX, mouseY, originalAnn) {
  if (annotation.locked) return;

  // Supported types for rotation
  const rotationTypes = ['image', 'stamp', 'signature', 'comment', 'box', 'mask', 'circle', 'highlight', 'polygon', 'cloud', 'textbox', 'parametricSymbol'];
  if (!rotationTypes.includes(annotation.type)) return;

  // Calculate center of annotation
  let width, height, centerX, centerY;

  width = originalAnn.width || 24;
  height = originalAnn.height || 24;
  centerX = originalAnn.x + width / 2;
  centerY = originalAnn.y + height / 2;

  // Calculate angle from center to mouse position
  // +90 offset because the rotation handle is above the annotation (at -90°)
  const angle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI) + 90;

  annotation.rotation = Math.round(angle);

  // Snap to 15 degree increments when shift is held
  if (state.shiftKeyPressed && state.preferences.enableAngleSnap) {
    annotation.rotation = snapAngle(annotation.rotation, state.preferences.angleSnapDegrees);
  } else {
    // Magnetic snap to common angles (0, ±45, ±90, ±135, 180) within ±3° tolerance
    const magnetAngles = [0, 45, 90, 135, 180, -45, -90, -135, -180];
    const magnetTolerance = 3;
    for (const magnet of magnetAngles) {
      if (Math.abs(annotation.rotation - magnet) <= magnetTolerance) {
        annotation.rotation = magnet;
        break;
      }
    }
  }

  annotation.modifiedAt = new Date().toISOString();
}
