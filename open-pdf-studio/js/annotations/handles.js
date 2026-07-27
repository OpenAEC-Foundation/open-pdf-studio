import { HANDLE_SIZE, HANDLE_TYPES } from '../core/constants.js';
import { annotationCtx } from '../ui/dom-elements.js';
import { state } from '../core/state.js';
import { getTemplate } from '../symbols/registry.js';
import { twoPointEndpoints } from '../symbols/two-point.js';
import { handleAnchors } from './stavenreeks.js';
import { betonbalkTagAnchor } from './betonbalk.js';
import { betonbalkHalfWidthPx } from './betonbalk-scale.js';

// Rotate a point around a center point
function rotatePoint(x, y, centerX, centerY, rotationDegrees) {
  if (!rotationDegrees) return { x, y };

  const radians = rotationDegrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Translate to origin, rotate, translate back
  const dx = x - centerX;
  const dy = y - centerY;

  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos
  };
}

// Get the center point for an annotation
function getAnnotationCenter(annotation) {
  switch (annotation.type) {
    case 'box':
    case 'mask':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
    case 'image':
    case 'stamp':
    case 'signature':
    case 'scaleBar':
    case 'scheduleTable':
    case 'redaction':
    case 'parametricSymbol':
      return {
        x: annotation.x + annotation.width / 2,
        y: annotation.y + annotation.height / 2
      };
    case 'circle':
      const w = annotation.width || annotation.radius * 2;
      const h = annotation.height || annotation.radius * 2;
      const cx = annotation.x !== undefined ? annotation.x : annotation.centerX - annotation.radius;
      const cy = annotation.y !== undefined ? annotation.y : annotation.centerY - annotation.radius;
      return {
        x: cx + w / 2,
        y: cy + h / 2
      };
    case 'comment':
      const cw = annotation.width || 24;
      const ch = annotation.height || 24;
      return {
        x: annotation.x + cw / 2,
        y: annotation.y + ch / 2
      };
    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      return {
        x: annotation.x + annotation.width / 2,
        y: annotation.y + annotation.height / 2
      };
    default:
      return null;
  }
}

// Get handles for an annotation based on its type
// scale parameter ensures handles stay the same screen size at any zoom level
export function getAnnotationHandles(annotation, scale = 1) {
  const handles = [];
  const hs = HANDLE_SIZE / scale;

  switch (annotation.type) {
    case 'box':
    case 'mask':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
      // Corner handles
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height - hs/2 });
      // Edge handles
      handles.push({ type: HANDLE_TYPES.TOP, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      // Center grip → move whole shape
      handles.push({
        type: HANDLE_TYPES.RECT_CENTER,
        x: annotation.x + annotation.width/2 - hs/2,
        y: annotation.y + annotation.height/2 - hs/2,
        isGrip: true,
        isCenterGrip: true,
      });
      // Rotation handle (above the shape)
      handles.push({ type: HANDLE_TYPES.ROTATE, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - 25 / scale - hs/2 });

      // Textbox leader handles + add button
      if (annotation.type === 'textbox') {
        // 16x16 button at top-right outside the box
        const btnSize = 16 / scale;
        const btnGap = 16 / scale;
        const addX = annotation.x + annotation.width + btnGap;
        const addY = annotation.y - btnSize - 4 / scale;
        handles.push({
          type: HANDLE_TYPES.LEADER_ADD,
          x: addX,
          y: addY,
          w: btnSize,
          h: btnSize,
          isLeaderUI: true,
        });

        if (Array.isArray(annotation.leaders)) {
          for (const leader of annotation.leaders) {
            // Tip handle (square)
            handles.push({
              type: `${HANDLE_TYPES.LEADER_TIP}_${leader.id}`,
              x: leader.tipX - hs / 2,
              y: leader.tipY - hs / 2,
              isLeaderHandle: true,
              leaderId: leader.id,
            });
            // Knee handle (slightly smaller — same width but flagged)
            handles.push({
              type: `${HANDLE_TYPES.LEADER_KNEE}_${leader.id}`,
              x: leader.kneeX - hs / 2,
              y: leader.kneeY - hs / 2,
              isLeaderHandle: true,
              isLeaderKnee: true,
              leaderId: leader.id,
            });
            // Delete (×) button at tip + 14 px along (tip - knee) direction
            const dx = leader.tipX - leader.kneeX;
            const dy = leader.tipY - leader.kneeY;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const off = 14 / scale;
            const dxX = leader.tipX + (dx / len) * off;
            const dxY = leader.tipY + (dy / len) * off;
            const delSize = 14 / scale;
            handles.push({
              type: `${HANDLE_TYPES.LEADER_DELETE}_${leader.id}`,
              x: dxX - delSize / 2,
              y: dxY - delSize / 2,
              w: delSize,
              h: delSize,
              isLeaderUI: true,
              leaderId: leader.id,
            });
          }
        }
      }
      break;

    case 'callout':
      // Corner handles for the text box
      const coW = annotation.width || 150;
      const coH = annotation.height || 50;
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + coW - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + coH - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + coW - hs/2, y: annotation.y + coH - hs/2 });
      // Move-all handle at center of box
      handles.push({ type: HANDLE_TYPES.CALLOUT_MOVE, x: annotation.x + coW / 2 - hs/2, y: annotation.y + coH / 2 - hs/2 });
      // Callout arrow handle
      const arrowX = annotation.arrowX !== undefined ? annotation.arrowX : annotation.x - 60;
      const arrowY = annotation.arrowY !== undefined ? annotation.arrowY : annotation.y + coH;
      handles.push({ type: HANDLE_TYPES.CALLOUT_ARROW, x: arrowX - hs/2, y: arrowY - hs/2 });
      // Knee point handle
      const kneeX = annotation.kneeX !== undefined ? annotation.kneeX : annotation.x - 30;
      const kneeY = annotation.kneeY !== undefined ? annotation.kneeY : annotation.y + coH / 2;
      handles.push({ type: HANDLE_TYPES.CALLOUT_KNEE, x: kneeX - hs/2, y: kneeY - hs/2 });
      break;

    case 'circle':
      // Ellipse uses same handles as box (corner and edge handles)
      const circW = annotation.width || annotation.radius * 2;
      const circH = annotation.height || annotation.radius * 2;
      const circX = annotation.x !== undefined ? annotation.x : annotation.centerX - annotation.radius;
      const circY = annotation.y !== undefined ? annotation.y : annotation.centerY - annotation.radius;
      // Corner handles
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: circX - hs/2, y: circY - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: circX + circW - hs/2, y: circY - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: circX - hs/2, y: circY + circH - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: circX + circW - hs/2, y: circY + circH - hs/2 });
      // Edge handles
      handles.push({ type: HANDLE_TYPES.TOP, x: circX + circW/2 - hs/2, y: circY - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: circX + circW/2 - hs/2, y: circY + circH - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: circX - hs/2, y: circY + circH/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: circX + circW - hs/2, y: circY + circH/2 - hs/2 });
      // Center grip → move whole circle
      handles.push({
        type: HANDLE_TYPES.CIRCLE_CENTER,
        x: circX + circW/2 - hs/2,
        y: circY + circH/2 - hs/2,
        isGrip: true,
        isCenterGrip: true,
      });
      // Rotation handle (above the shape)
      handles.push({ type: HANDLE_TYPES.ROTATE, x: circX + circW/2 - hs/2, y: circY - 25 / scale - hs/2 });
      break;

    case 'stavenreeks': {
      // De grijppunten zitten op de WAPENINGSPUNTEN (de staven), niet op de
      // uiteinden van de aanhaallijn: dat is wat de gebruiker ziet en wil
      // vastpakken. handleAnchors() levert het punt bij het lijn-startpunt,
      // het punt bij het lijn-eindpunt en het midden daartussen. Het slepen
      // rekent in transforms.js terug naar het bijbehorende lijn-uiteinde.
      const sr = handleAnchors(annotation);
      handles.push({ type: HANDLE_TYPES.LINE_START, x: sr.start.x - hs/2, y: sr.start.y - hs/2, isGrip: true });
      handles.push({ type: HANDLE_TYPES.LINE_END, x: sr.end.x - hs/2, y: sr.end.y - hs/2, isGrip: true });
      handles.push({
        type: HANDLE_TYPES.LINE_MID,
        x: sr.mid.x - hs/2,
        y: sr.mid.y - hs/2,
        isGrip: true,
        isCenterGrip: true,
      });
      break;
    }

    case 'wall':
    case 'betonbalk':
    case 'line':
      // Endpoint handles + midpoint grip (move whole line)
      handles.push({ type: HANDLE_TYPES.LINE_START, x: annotation.startX - hs/2, y: annotation.startY - hs/2, isGrip: true });
      handles.push({ type: HANDLE_TYPES.LINE_END, x: annotation.endX - hs/2, y: annotation.endY - hs/2, isGrip: true });
      handles.push({
        type: HANDLE_TYPES.LINE_MID,
        x: (annotation.startX + annotation.endX)/2 - hs/2,
        y: (annotation.startY + annotation.endY)/2 - hs/2,
        isGrip: true,
        isCenterGrip: true,
      });
      // Betonbalk-tag: eigen grippunt op de tag zodat die vrij te verslepen
      // is (tagOffsetX/Y) zonder de balk zelf te bewegen. Het anker komt uit
      // dezelfde helper als de tekenroutine, dus de grip ligt exact op de
      // getekende tekst.
      if (annotation.type === 'betonbalk' && annotation.tagTonen === true) {
        const bbTag = betonbalkTagAnchor(annotation, betonbalkHalfWidthPx(annotation));
        if (bbTag) {
          handles.push({ type: 'betonbalk_tag', x: bbTag.x - hs/2, y: bbTag.y - hs/2, isGrip: true });
        }
      }
      break;

    case 'arrow':
      // Arrow uses same endpoint handles as line + midpoint grip
      handles.push({ type: HANDLE_TYPES.LINE_START, x: annotation.startX - hs/2, y: annotation.startY - hs/2, isGrip: true });
      handles.push({ type: HANDLE_TYPES.LINE_END, x: annotation.endX - hs/2, y: annotation.endY - hs/2, isGrip: true });
      handles.push({
        type: HANDLE_TYPES.LINE_MID,
        x: (annotation.startX + annotation.endX)/2 - hs/2,
        y: (annotation.startY + annotation.endY)/2 - hs/2,
        isGrip: true,
        isCenterGrip: true,
      });
      break;

    case 'measureDistance':
      // Dimension line endpoints
      handles.push({ type: HANDLE_TYPES.LINE_START, x: annotation.startX - hs/2, y: annotation.startY - hs/2 });
      handles.push({ type: HANDLE_TYPES.LINE_END, x: annotation.endX - hs/2, y: annotation.endY - hs/2 });
      // Extension line tip handles (if extension lines exist)
      if (annotation.leaderStartX !== undefined) {
        handles.push({ type: HANDLE_TYPES.LEADER_START, x: annotation.leaderStartX - hs/2, y: annotation.leaderStartY - hs/2 });
      }
      if (annotation.leaderEndX !== undefined) {
        handles.push({ type: HANDLE_TYPES.LEADER_END, x: annotation.leaderEndX - hs/2, y: annotation.leaderEndY - hs/2 });
      }
      // Text drag handle at the label anchor (dimension-line midpoint +
      // optional textOffset) — lets the measurement text be placed off-line.
      if (annotation.measureText) {
        const mdlx = (annotation.startX + annotation.endX) / 2 + (annotation.textOffsetX || 0);
        const mdly = (annotation.startY + annotation.endY) / 2 + (annotation.textOffsetY || 0);
        handles.push({ type: HANDLE_TYPES.LABEL_MOVE, x: mdlx - hs/2, y: mdly - hs/2 });
      }
      break;

    case 'measureAngle':
      if (annotation.point1 && annotation.vertex && annotation.point2) {
        handles.push({ type: HANDLE_TYPES.POLYLINE_NODE, x: annotation.point1.x - hs/2, y: annotation.point1.y - hs/2, nodeIndex: 0 });
        handles.push({ type: HANDLE_TYPES.POLYLINE_NODE, x: annotation.vertex.x - hs/2, y: annotation.vertex.y - hs/2, nodeIndex: 1 });
        handles.push({ type: HANDLE_TYPES.POLYLINE_NODE, x: annotation.point2.x - hs/2, y: annotation.point2.y - hs/2, nodeIndex: 2 });
      }
      break;

    case 'comment':
      // No resize/rotation handles — sticky note icon is fixed size, move only
      break;

    case 'text':
      // Calculate text bounds
      if (annotationCtx) {
        annotationCtx.font = `${annotation.fontSize || 16}px Arial`;
        const textWidth = annotationCtx.measureText(annotation.text).width;
        const textHeight = annotation.fontSize || 16;
        handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - textHeight - hs/2 });
        handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + textWidth - hs/2, y: annotation.y - textHeight - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + textWidth - hs/2, y: annotation.y - hs/2 });
      }
      break;

    case 'draw':
      // For freehand, show bounding box handles
      if (annotation.path && annotation.path.length > 0) {
        const minX = Math.min(...annotation.path.map(p => p.x));
        const minY = Math.min(...annotation.path.map(p => p.y));
        const maxX = Math.max(...annotation.path.map(p => p.x));
        const maxY = Math.max(...annotation.path.map(p => p.y));
        handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: minX - hs/2, y: minY - hs/2 });
        handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: maxX - hs/2, y: minY - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: minX - hs/2, y: maxY - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: maxX - hs/2, y: maxY - hs/2 });
      }
      break;

    case 'polyline':
    case 'splineArrow':
    case 'cloudPolyline':
    case 'measureArea':
    case 'measurePerimeter':
    case 'filledArea':
      // Per-node handles for polyline
      if (annotation.points && annotation.points.length > 0) {
        annotation.points.forEach((p, i) => {
          handles.push({ type: HANDLE_TYPES.POLYLINE_NODE, x: p.x - hs/2, y: p.y - hs/2, nodeIndex: i });
        });
      }
      // Per-node handles for holes in measureArea / filledArea
      if ((annotation.type === 'measureArea' || annotation.type === 'filledArea') && annotation.holes && annotation.holes.length > 0) {
        annotation.holes.forEach((hole, holeIdx) => {
          if (!hole) return;
          hole.forEach((p, nodeIdx) => {
            handles.push({ type: `${HANDLE_TYPES.POLYLINE_NODE}_hole_${holeIdx}`, x: p.x - hs/2, y: p.y - hs/2, nodeIndex: nodeIdx, isHole: true });
          });
        });
      }
      // Edge-midpoint handles only in edit-contour mode for filledArea
      if (annotation.type === 'filledArea' && state?.editingContour === annotation.id) {
        const ehs = (HANDLE_SIZE - 2) / scale; // slightly smaller open circle visual
        if (annotation.points && annotation.points.length >= 2) {
          const n = annotation.points.length;
          // Closed polygon: include edge from last vertex back to first
          for (let i = 0; i < n; i++) {
            const a = annotation.points[i];
            const b = annotation.points[(i + 1) % n];
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            handles.push({
              type: `${HANDLE_TYPES.POLYLINE_EDGE}_${i}`,
              x: mx - ehs/2,
              y: my - ehs/2,
              w: ehs,
              h: ehs,
              edgeIndex: i,
              isEdgeMid: true,
            });
          }
        }
        if (annotation.holes && annotation.holes.length > 0) {
          annotation.holes.forEach((hole, holeIdx) => {
            if (!hole || hole.length < 2) return;
            const hn = hole.length;
            for (let i = 0; i < hn; i++) {
              const a = hole[i];
              const b = hole[(i + 1) % hn];
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              handles.push({
                type: `${HANDLE_TYPES.POLYLINE_EDGE}_hole_${holeIdx}_${i}`,
                x: mx - ehs/2,
                y: my - ehs/2,
                w: ehs,
                h: ehs,
                edgeIndex: i,
                holeIndex: holeIdx,
                isEdgeMid: true,
                isHole: true,
              });
            }
          });
        }
      }
      // Label drag handle for measureArea (at label position or centroid)
      if (annotation.type === 'measureArea' && annotation.points && annotation.points.length >= 3 && annotation.measureText) {
        let lx, ly;
        if (annotation.labelX != null && annotation.labelY != null) {
          lx = annotation.labelX;
          ly = annotation.labelY;
        } else {
          lx = 0; ly = 0;
          for (const p of annotation.points) { lx += p.x; ly += p.y; }
          lx /= annotation.points.length;
          ly /= annotation.points.length;
        }
        handles.push({ type: HANDLE_TYPES.LABEL_MOVE, x: lx - hs/2, y: ly - hs/2 });
      }
      break;

    case 'viewport':
    case 'scaleRegion':
      // Viewport / scale region: corner + edge handles, no rotation
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      break;

    case 'image':
    case 'stamp':
    case 'signature':
    case 'scaleBar':
    case 'scheduleTable':
    case 'parametricSymbol':
      // Fixed-size parametric symbols (steel profiles): size comes from the
      // 'maat' × 'schaal' params, NOT from graphic resizing — only rotation.
      // Line-form beam views (template.freeAxis → 'x') additionally get the
      // LEFT/RIGHT grips so the beam LENGTH is draggable.
      if (annotation.type === 'parametricSymbol') {
        const _tpl = getTemplate(annotation.symbolId);
        if (_tpl?.placement === 'two-point') {
          const _points = twoPointEndpoints(annotation);
          handles.push({
            type: HANDLE_TYPES.LINE_START,
            x: _points.startX - hs / 2,
            y: _points.startY - hs / 2,
            isGrip: true,
            isTwoPoint: true,
          });
          handles.push({
            type: HANDLE_TYPES.LINE_END,
            x: _points.endX - hs / 2,
            y: _points.endY - hs / 2,
            isGrip: true,
            isTwoPoint: true,
          });
          handles.push({
            type: HANDLE_TYPES.LINE_MID,
            x: (_points.startX + _points.endX) / 2 - hs / 2,
            y: (_points.startY + _points.endY) / 2 - hs / 2,
            isGrip: true,
            isCenterGrip: true,
            isTwoPoint: true,
          });
          break;
        }
        if (_tpl?.fixedSize) {
          const _free = typeof _tpl.freeAxis === 'function'
            ? _tpl.freeAxis(annotation.params || {})
            : null;
          if (_free === 'x') {
            handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
            handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
          }
          handles.push({ type: HANDLE_TYPES.ROTATE, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - 25 / scale - hs/2 });
          break;
        }
      }
      // Corner + edge + rotation handles
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.ROTATE, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - 25 / scale - hs/2 });
      break;

    case 'redaction':
      // Corner and edge handles for resize (no rotation)
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      break;

    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      // Text markup annotations use per-rect selection outlines (drawn in selection.js)
      // No bounding-box handles — they can only be moved or deleted
      break;

    default:
      // Fallback for plugin annotation types (e.g. symitech.scheur, symitech.vloer-contour,
      // symitech.doorvoer-polyline-closed, symitech.doorvoer-line-contour,
      // symitech.niet-onderzocht-polyline-closed): any annotation that exposes a
      // points: Array<{x,y}> field gets per-vertex polyline_node handles automatically.
      if (annotation.points && Array.isArray(annotation.points) && annotation.points.length > 0) {
        annotation.points.forEach((p, i) => {
          handles.push({ type: HANDLE_TYPES.POLYLINE_NODE, x: p.x - hs/2, y: p.y - hs/2, nodeIndex: i });
        });
      } else if (
        typeof annotation.x === 'number'
        && typeof annotation.y === 'number'
        && typeof annotation.w === 'number'
        && typeof annotation.h === 'number'
      ) {
        // Plugin rect/oval-area types (symitech.doorvoer.rect-area,
        // symitech.doorvoer.oval-area, symitech.niet-onderzocht.rect-area,
        // symitech.niet-onderzocht.oval-area) store geometry as
        // {x, y, w, h} (not width/height). Emit the same 4 corner + 4 edge
        // handles built-in box/circle types use, so users can resize after
        // placement by dragging any handle.
        const ax = annotation.x, ay = annotation.y, aw = annotation.w, ah = annotation.h;
        handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: ax - hs/2, y: ay - hs/2 });
        handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: ax + aw - hs/2, y: ay - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: ax - hs/2, y: ay + ah - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: ax + aw - hs/2, y: ay + ah - hs/2 });
        handles.push({ type: HANDLE_TYPES.TOP, x: ax + aw/2 - hs/2, y: ay - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM, x: ax + aw/2 - hs/2, y: ay + ah - hs/2 });
        handles.push({ type: HANDLE_TYPES.LEFT, x: ax - hs/2, y: ay + ah/2 - hs/2 });
        handles.push({ type: HANDLE_TYPES.RIGHT, x: ax + aw - hs/2, y: ay + ah/2 - hs/2 });
      }
      break;
  }

  // If the annotation is rotated, rotate all handle positions around the annotation center
  if (annotation.rotation) {
    const center = getAnnotationCenter(annotation);
    if (center) {
      for (const handle of handles) {
        // Leader UI / handles live in absolute (unrotated) document space
        if (handle.isLeaderUI || handle.isLeaderHandle || handle.isTwoPoint) continue;
        const handleCenterX = handle.x + hs / 2;
        const handleCenterY = handle.y + hs / 2;
        const rotated = rotatePoint(handleCenterX, handleCenterY, center.x, center.y, annotation.rotation);
        handle.x = rotated.x - hs / 2;
        handle.y = rotated.y - hs / 2;
      }
    }
  }

  return handles;
}

// Find which handle is at the given coordinates
// Uses an expanded hit area (larger than visual handle) so handles are easy to grab.
// When multiple handles overlap in the expanded zone, the nearest one wins.
export function findHandleAt(x, y, annotation, scale = 1) {
  if (!annotation) return null;
  const handles = getAnnotationHandles(annotation, scale);
  const hs = HANDLE_SIZE / scale;
  // Hit tolerance: expand clickable area by this much on each side of the handle
  const hitPad = 4 / scale;

  let bestHandle = null;
  let bestDist = Infinity;

  for (const handle of handles) {
    const hw = handle.w !== undefined ? handle.w : hs;
    const hh = handle.h !== undefined ? handle.h : hs;
    if (x >= handle.x - hitPad && x <= handle.x + hw + hitPad &&
        y >= handle.y - hitPad && y <= handle.y + hh + hitPad) {
      // Distance from click to handle center
      const hcx = handle.x + hw / 2;
      const hcy = handle.y + hh / 2;
      const dist = (x - hcx) * (x - hcx) + (y - hcy) * (y - hcy);
      if (dist < bestDist) {
        bestDist = dist;
        bestHandle = handle;
      }
    }
  }

  if (!bestHandle) return null;
  // For polyline nodes, encode the index in the type string
  if (bestHandle.type === HANDLE_TYPES.POLYLINE_NODE) {
    return `${bestHandle.type}_${bestHandle.nodeIndex}`;
  }
  // For hole node handles (type = "polyline_node_hole_<holeIdx>"), append the nodeIndex
  if (typeof bestHandle.type === 'string' && bestHandle.type.startsWith(HANDLE_TYPES.POLYLINE_NODE + '_hole_')) {
    return `${bestHandle.type}_${bestHandle.nodeIndex}`;
  }
  // Edge-midpoint handles already encode the index in the type string at build time
  return bestHandle.type;
}

// Cache for generated cursor SVG data URIs
const cursorCache = new Map();

// Generate an SVG resize cursor matching the native Windows double-headed arrow style
function createRotatedResizeCursor(angleDeg) {
  // Normalize to 0-180 range (resize arrows are bidirectional)
  const norm = ((angleDeg % 180) + 180) % 180;
  const key = Math.round(norm);
  if (cursorCache.has(key)) return cursorCache.get(key);

  const size = 32;
  const cx = size / 2;
  const cy = size / 2;
  const rad = -key * Math.PI / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);

  // Direction vectors: along the arrow axis and perpendicular
  // dx,dy = axis direction, px,py = perpendicular
  const dx = -s, dy = -c;
  const px = c, py = -s;

  // Native Windows style: wide triangular arrowheads connected by a narrow shaft
  // Total length tip-to-tip
  const tipLen = 11;
  // Arrowhead dimensions
  const headLen = 5;
  const headW = 5;
  // Shaft half-width
  const shaftW = 1.5;

  // Build the outline as a single polygon (like the native cursor)
  // Tip 1 (top/left end)
  const t1x = cx - tipLen * dx, t1y = cy - tipLen * dy;
  // Base of arrowhead 1
  const b1x = cx - (tipLen - headLen) * dx, b1y = cy - (tipLen - headLen) * dy;
  // Tip 2 (bottom/right end)
  const t2x = cx + tipLen * dx, t2y = cy + tipLen * dy;
  // Base of arrowhead 2
  const b2x = cx + (tipLen - headLen) * dx, b2y = cy + (tipLen - headLen) * dy;

  // Points forming the full arrow shape (clockwise)
  const pts = [
    // Arrowhead 1 tip
    [t1x, t1y],
    // Arrowhead 1 left wing
    [b1x - headW * px, b1y - headW * py],
    // Shaft left side at head 1 base
    [b1x - shaftW * px, b1y - shaftW * py],
    // Shaft left side at head 2 base
    [b2x - shaftW * px, b2y - shaftW * py],
    // Arrowhead 2 left wing
    [b2x - headW * px, b2y - headW * py],
    // Arrowhead 2 tip
    [t2x, t2y],
    // Arrowhead 2 right wing
    [b2x + headW * px, b2y + headW * py],
    // Shaft right side at head 2 base
    [b2x + shaftW * px, b2y + shaftW * py],
    // Shaft right side at head 1 base
    [b1x + shaftW * px, b1y + shaftW * py],
    // Arrowhead 1 right wing
    [b1x + headW * px, b1y + headW * py],
  ];

  const pointsStr = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<polygon points="${pointsStr}" fill="black" stroke="white" stroke-width="2" stroke-linejoin="round"/>` +
    `</svg>`;

  const dataUri = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${cx} ${cy}, auto`;
  cursorCache.set(key, dataUri);
  return dataUri;
}

// Get cursor style for handle type, accounting for annotation rotation
export function getCursorForHandle(handleType, rotation, annotation) {
  // Polyline node handles
  if (typeof handleType === 'string' && handleType.startsWith(HANDLE_TYPES.POLYLINE_NODE + '_')) {
    return 'crosshair';
  }

  // Non-directional cursors - rotation doesn't affect these
  switch (handleType) {
    case HANDLE_TYPES.LINE_START:
    case HANDLE_TYPES.LINE_END:
    case HANDLE_TYPES.LEADER_START:
    case HANDLE_TYPES.LEADER_END:
      return 'crosshair';
    case HANDLE_TYPES.LINE_MID:
    case HANDLE_TYPES.RECT_CENTER:
    case HANDLE_TYPES.CIRCLE_CENTER:
      return 'move';
    case HANDLE_TYPES.MOVE:
      return 'move';
    case HANDLE_TYPES.ROTATE:
      return 'grab';
    case HANDLE_TYPES.CALLOUT_MOVE:
    case HANDLE_TYPES.LABEL_MOVE:
      return 'move';
    case HANDLE_TYPES.CALLOUT_ARROW:
      return 'crosshair';
    case HANDLE_TYPES.CALLOUT_KNEE:
      return annotation && annotation._leaderVertical ? 'ns-resize' : 'ew-resize';
  }

  // Map each handle to its base angle (0° = vertical/N-S)
  let baseAngle;
  switch (handleType) {
    case HANDLE_TYPES.TOP:
    case HANDLE_TYPES.BOTTOM:
      baseAngle = 0;
      break;
    case HANDLE_TYPES.TOP_RIGHT:
    case HANDLE_TYPES.BOTTOM_LEFT:
      baseAngle = 45;
      break;
    case HANDLE_TYPES.LEFT:
    case HANDLE_TYPES.RIGHT:
      baseAngle = 90;
      break;
    case HANDLE_TYPES.TOP_LEFT:
    case HANDLE_TYPES.BOTTOM_RIGHT:
      baseAngle = 135;
      break;
    default:
      return 'default';
  }

  const totalAngle = baseAngle + (rotation || 0);

  // For no rotation or near-zero, use standard CSS cursors (crisper)
  if (!rotation || Math.abs(rotation) < 1) {
    const cursorAngles = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
    const index = Math.round(((baseAngle % 360 + 360) % 360) / 45) % 4;
    return cursorAngles[index];
  }

  // Use custom SVG cursor rotated to the exact angle
  return createRotatedResizeCursor(totalAngle);
}
