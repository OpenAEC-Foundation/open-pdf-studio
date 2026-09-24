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
import { isPointPolygon, rotatePointPolygon } from './polygon-transform.js';
import {
  MIN_GEBIED_PX, schaalRechthoekMetGreep, schermPxNaarPt, veiligeVerhouding,
  tekstvakMinimum, nietNul,
} from './minimummaat.js';

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

// Schaal een rechthoek-vorm met een maatgreep via de gedeelde regel uit
// minimummaat.js: maat -> klem -> positie uit het vaste punt. Werkt voor
// ongedraaid en gedraaid (de vorm draait om zijn midden), voor vrije en vaste
// verhouding, en voor plugin-vormen die w/h in plaats van width/height voeren.
function _schaalMetGreep(annotation, handleType, deltaX, deltaY, originalAnn, opties = {}) {
  const wKey = opties.breedteVeld || 'width';
  const hKey = opties.hoogteVeld || 'height';
  let bron = { x: originalAnn.x, y: originalAnn.y, width: originalAnn[wKey], height: originalAnn[hKey] };
  // Oude cirkels voeren middelpunt + straal in plaats van een omhullende.
  if (originalAnn.type === 'circle' && originalAnn.radius > 0
      && !(originalAnn.width > 0) && !(originalAnn.height > 0)) {
    const d = originalAnn.radius * 2;
    bron = {
      x: originalAnn.x !== undefined ? originalAnn.x : originalAnn.centerX - originalAnn.radius,
      y: originalAnn.y !== undefined ? originalAnn.y : originalAnn.centerY - originalAnn.radius,
      width: d, height: d,
    };
  }
  const r = schaalRechthoekMetGreep(
    bron,
    handleType, deltaX, deltaY,
    {
      rotatie: opties.negeerRotatie ? 0 : (originalAnn.rotation || 0),
      minBreedte: opties.minBreedte,
      minHoogte: opties.minHoogte,
      vasteVerhouding: !!opties.vasteVerhouding,
      verhouding: opties.verhouding,
    },
  );
  annotation.x = r.x;
  annotation.y = r.y;
  annotation[wKey] = r.width;
  annotation[hKey] = r.height;
}

// Notitie-icoon: vaste markering met een vaste ondergrens in paginapunten.
// Bewust GEEN schermpixel- of epsilon-grens: het icoon wordt op een vaste
// maat getekend en krijgt van getAnnotationHandles geen maatgrepen; deze tak
// is alleen nog bereikbaar voor programmatische aanroepen.
export const COMMENT_MIN_MAAT_PT = 20;

const _MAATGREPEN = new Set([
  HANDLE_TYPES.TOP_LEFT, HANDLE_TYPES.TOP_RIGHT, HANDLE_TYPES.BOTTOM_LEFT, HANDLE_TYPES.BOTTOM_RIGHT,
  HANDLE_TYPES.TOP, HANDLE_TYPES.BOTTOM, HANDLE_TYPES.LEFT, HANDLE_TYPES.RIGHT,
]);

// Apply resize based on handle being dragged.
// opties.schaal = actuele zoom (schermpixels per paginapunt); nodig voor de
// ondergrenzen die in schermpixels staan (schaalgebied, viewport, schaalbalk).
export function applyResize(annotation, handleType, deltaX, deltaY, originalAnn, shiftKey = false, ctrlKey = false, opties = {}) {
  if (annotation.locked) return;
  // Ondergrens in schermpixels -> paginapunten bij de huidige zoom. Zonder
  // bekende zoom geldt alleen de technische ondergrens.
  const gebiedMinPt = (Number.isFinite(opties?.schaal) && opties.schaal > 0)
    ? schermPxNaarPt(MIN_GEBIED_PX, opties.schaal) : undefined;

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
    case 'redaction':
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
      if (_MAATGREPEN.has(handleType)) {
        // Rechthoek, ellips, wolk, maskeer-, markerings- en redactievlak mogen
        // willekeurig klein worden (alleen de technische ondergrens; de
        // redactiemarkering had wel grepen maar geen tak). Een TEKSTVAK houdt
        // een eigen ondergrens: er moet één teken op één regel in passen —
        // afgeleid van de lettergrootte, niet een vast aantal punten.
        const tbMin = annotation.type === 'textbox' ? tekstvakMinimum(originalAnn) : null;
        _schaalMetGreep(annotation, handleType, deltaX, deltaY, originalAnn, tbMin || {});
      }
      break;

    case 'callout':
      // Initialize width/height if not set
      if (!originalAnn.width) originalAnn.width = 150;
      if (!originalAnn.height) originalAnn.height = 50;

      // Hoekgrepen van het tekstvak: gedeelde regel. De ondergrens volgt de
      // lettergrootte (één teken op één regel moet passen; de aanhaallijn
      // rekent met de vakmaat), niet de oude vaste 50 x 30 punten.
      if (_MAATGREPEN.has(handleType)) {
        _schaalMetGreep(annotation, handleType, deltaX, deltaY, originalAnn,
          { ...tekstvakMinimum(originalAnn), negeerRotatie: true });
      }
      switch (handleType) {
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

        // Delingswacht met behoud van teken (omklappen mag bij vrije hand);
        // exact 0 springt niet meer naar 1 pt.
        const newWidth = nietNul(newMaxX - newMinX);
        const newHeight = nietNul(newMaxY - newMinY);
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
      // Schaalgebied / viewport: alleen op de randen raakbaar, en een per
      // ongeluk ingeklapt gebied haalt alle maten erbinnen uit hun schaal.
      // Daarom WEL een ondergrens, maar in SCHERMPIXELS (px / zoom): wie
      // inzoomt kan een kleiner gebied maken. Een gebied dat al kleiner is
      // (ingetypt in het paneel) springt niet omhoog.
      if (_MAATGREPEN.has(handleType)) {
        _schaalMetGreep(annotation, handleType, deltaX, deltaY, originalAnn,
          { minBreedte: gebiedMinPt, minHoogte: gebiedMinPt, negeerRotatie: true });
      }
      break;
    }

    case 'image':
    case 'stamp':
    case 'signature':
    case 'scaleBar':
    case 'scheduleTable':
    case 'vectorSnippet':
    case 'parametricSymbol': {
      const _tweepuntTpl = annotation.type === 'parametricSymbol'
        ? getTemplate(annotation.symbolId) : null;
      if (_tweepuntTpl?.placement === 'two-point') {
        const points = twoPointEndpoints(originalAnn);
        let startX = points.startX;
        let startY = points.startY;
        let endX = points.endX;
        let endY = points.endY;
        const movingStart = handleType === HANDLE_TYPES.LINE_START;
        const movingEnd = handleType === HANDLE_TYPES.LINE_END;
        if (!movingStart && !movingEnd) {
          // Sjabloon-eigen greep (bijv. de stijl van een gevelelement).
          if (typeof _tweepuntTpl.sleepGreep === 'function') {
            _tweepuntTpl.sleepGreep(annotation, originalAnn, handleType, deltaX, deltaY);
          }
          break;
        }
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
        // Het sjabloon mag zijn indeling bijwerken op de nieuwe lengte; het
        // uiteinde dat niet bewoog is de vaste kant.
        if (typeof _tweepuntTpl.naRek === 'function') {
          _tweepuntTpl.naRek(annotation, originalAnn, movingStart ? 'eind' : 'begin');
        }
        break;
      }
      // Afbeelding, stempel, handtekening, staat en parametrisch symbool mogen
      // willekeurig klein worden; ongedraaid, gedraaid, vrij en met vaste
      // verhouding lopen via dezelfde regel. Bewuste keuze uit #283 blijft:
      // voorbij het vaste punt slepen klapt niet om maar zakt naar de
      // ondergrens, en de verhouding blijft bij elke sleepafstand gelden
      // (#315: ook bij een zeer brede of zeer hoge afbeelding).
      //
      // De SCHAALBALK is geen gewone vorm: bij loslaten wordt zijn breedte de
      // schaal van het hele document. Een per ongeluk ingeklapte balk zou
      // alles herschalen, dus die houdt de schermpixel-ondergrens.
      if (!_MAATGREPEN.has(handleType)) break;
      const lockRatio = shiftKey || annotation.lockAspectRatio;
      const aspectRatio = veiligeVerhouding(originalAnn.originalWidth, originalAnn.originalHeight)
        || veiligeVerhouding(originalAnn.width, originalAnn.height);
      const isSchaalbalk = annotation.type === 'scaleBar';
      _schaalMetGreep(annotation, handleType, deltaX, deltaY, originalAnn, {
        vasteVerhouding: !!lockRatio,
        verhouding: aspectRatio,
        minBreedte: isSchaalbalk ? gebiedMinPt : undefined,
      });
      // Inrichting (#478): een template met `paramsUitMaat` maakt van het
      // versleepte vak zijn nieuwe werkelijke maat (een aanrecht langer, een
      // closet dieper), zodat parameters en tekening gelijk blijven en de
      // onderdelen in een aanrecht niet mee uitrekken.
      if (annotation.type === 'parametricSymbol') {
        const tpl = getTemplate(annotation.symbolId);
        if (typeof tpl?.paramsUitMaat === 'function') {
          const k = pxPerMmAt(
            annotation.page,
            annotation.x + annotation.width / 2,
            annotation.y + annotation.height / 2,
          );
          if (k > 0) {
            annotation.params = tpl.paramsUitMaat(originalAnn.params || {}, {
              breedteMm: annotation.width / k,
              hoogteMm: annotation.height / k,
            });
          }
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
      if (annotation.width < COMMENT_MIN_MAAT_PT) annotation.width = COMMENT_MIN_MAAT_PT;
      if (annotation.height < COMMENT_MIN_MAAT_PT) annotation.height = COMMENT_MIN_MAAT_PT;
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
        // Zelfde regel als de ingebouwde rechthoek, maar naar w/h geschreven.
        // Geen vaste 10 pt meer: de grepen zijn schermvast, dus inzoomen
        // maakt ook een piepkleine vorm weer grijpbaar.
        if (_MAATGREPEN.has(handleType)) {
          _schaalMetGreep(annotation, handleType, deltaX, deltaY, originalAnn,
            { breedteVeld: 'w', hoogteVeld: 'h', negeerRotatie: true });
        }
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

  // Closed point-based polygons (filledArea/measureArea) have no rotation
  // field: the drag turns the real points, about the original bbox centre.
  // The caller restores `annotation` from `originalAnn` before every call.
  const pointPolygon = isPointPolygon(originalAnn);

  // Supported types for rotation
  const rotationTypes = ['image', 'stamp', 'signature', 'comment', 'box', 'mask', 'circle', 'highlight', 'polygon', 'cloud', 'textbox', 'parametricSymbol'];
  if (!pointPolygon && !rotationTypes.includes(annotation.type)) return;

  // Calculate center of annotation
  let width, height, centerX, centerY;

  width = originalAnn.width || 24;
  height = originalAnn.height || 24;
  centerX = originalAnn.x + width / 2;
  centerY = originalAnn.y + height / 2;

  // Calculate angle from center to mouse position
  // +90 offset because the rotation handle is above the annotation (at -90°)
  const angle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI) + 90;

  let degrees = Math.round(angle);

  // Snap to 15 degree increments when shift is held
  if (state.shiftKeyPressed && state.preferences.enableAngleSnap) {
    degrees = snapAngle(degrees, state.preferences.angleSnapDegrees);
  } else {
    // Magnetic snap to common angles (0, ±45, ±90, ±135, 180) within ±3° tolerance
    const magnetAngles = [0, 45, 90, 135, 180, -45, -90, -135, -180];
    const magnetTolerance = 3;
    for (const magnet of magnetAngles) {
      if (Math.abs(degrees - magnet) <= magnetTolerance) {
        degrees = magnet;
        break;
      }
    }
  }

  if (pointPolygon) {
    rotatePointPolygon(annotation, degrees);
  } else {
    annotation.rotation = degrees;
  }

  annotation.modifiedAt = new Date().toISOString();
}
