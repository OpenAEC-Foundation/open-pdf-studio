/**
 * Greep slepen — waar de gesleepte greep oorspronkelijk zat, en de lengte in
 * de tooltip van de meetlijn. Rekenwerk voor _handleResize in
 * tool-dispatcher.js; tekent zelf niets.
 *
 * - greepOorsprong: het punt waar de greep bij het begin van de sleep stond.
 *   Snapt de cursor, dan wordt de sleep "gesnapt punt min dit punt", zodat de
 *   greep precies op het snappunt komt.
 * - strekBasispunt: beginpunt van de gestippelde meetlijn naar de cursor.
 * - strekLengteTekst: de lengte van die meetlijn als tekst.
 *
 * Alle coördinaten zijn paginacoördinaten.
 */

import { greepOpScherm } from '../annotations/handles.js';
import { twoPointEndpoints } from '../symbols/two-point.js';

// De acht maatgrepen staan in de lokale (ongedraaide) ruimte van de vorm en
// worden om het midden gedraaid getekend (handles.js). Snap en meetlijn
// rekenen vanaf die getekende plek; anders verspringt een gedraaide vorm
// zodra de snap aanslaat. De middengrepen liggen op het draaipunt zelf.
const _MAATGREPEN = new Set(['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r']);

// Eind- en middengreep van een twee-punts parametrisch symbool, uit dezelfde
// bron als handles.js en applyResize (twoPointEndpoints): de eigen
// eindpunten, of bij een oud symbool zonder eindpunten die uit het gedraaide
// vak. Anders ontbreekt bij zo'n oud symbool de oorsprong en klapt het bij
// een snap in. Null voor alle andere grepen en vormen.
function _tweepuntGreep(orig, h) {
  if (orig.type !== 'parametricSymbol') return null;
  if (h !== 'line_start' && h !== 'line_end' && h !== 'line_mid') return null;
  const p = twoPointEndpoints(orig);
  if (h === 'line_start') return { x: p.startX, y: p.startY };
  if (h === 'line_end') return { x: p.endX, y: p.endY };
  return { x: (p.startX + p.endX) / 2, y: (p.startY + p.endY) / 2 };
}

/**
 * Oorspronkelijke plek van de gesleepte greep. `sjabloonOorsprong(orig, h)`
 * levert voor een parametrisch symbool de plek van een sjabloon-eigen greep
 * (of niets).
 */
export function greepOorsprong(orig, h, sjabloonOorsprong) {
  let ox, oy;
  // Textbox leader tip/knee: pull origin from the matching leader on originalAnn
  if (typeof h === 'string' && (h.startsWith('leader_tip_') || h.startsWith('leader_knee_'))) {
    const isTipL = h.startsWith('leader_tip_');
    const lid = h.substring(isTipL ? 'leader_tip_'.length : 'leader_knee_'.length);
    const ldrs = Array.isArray(orig.leaders) ? orig.leaders : [];
    const found = ldrs.find(l => l.id === lid);
    if (found) {
      ox = isTipL ? found.tipX : found.kneeX;
      oy = isTipL ? found.tipY : found.kneeY;
    }
  } else
  if (typeof h === 'string' && h.startsWith('polyline_node_')) {
    // Check for hole node: polyline_node_hole_<holeIdx>_<nodeIdx>
    const holeSnapMatch = h.match(/^polyline_node_hole_(\d+)_(\d+)$/);
    if (holeSnapMatch && orig.holes) {
      const hi = parseInt(holeSnapMatch[1], 10);
      const ni = parseInt(holeSnapMatch[2], 10);
      if (hi < orig.holes.length && ni < orig.holes[hi].length) {
        ox = orig.holes[hi][ni].x;
        oy = orig.holes[hi][ni].y;
      }
    } else if (orig.points) {
      const nodeIdx = parseInt(h.split('_').pop(), 10);
      if (!isNaN(nodeIdx) && nodeIdx < orig.points.length) {
        ox = orig.points[nodeIdx].x;
        oy = orig.points[nodeIdx].y;
      }
    } else if (orig.type === 'measureAngle' && orig.point1 && orig.vertex && orig.point2) {
      const maNodeIdx = parseInt(h.split('_').pop(), 10);
      const maPts = [orig.point1, orig.vertex, orig.point2];
      if (!isNaN(maNodeIdx) && maNodeIdx < 3) {
        ox = maPts[maNodeIdx].x;
        oy = maPts[maNodeIdx].y;
      }
    }
  }
  // Label move handle
  if (h === 'label_move' && orig.points) {
    if (orig.labelX != null && orig.labelY != null) {
      ox = orig.labelX;
      oy = orig.labelY;
    } else {
      let clx = 0, cly = 0;
      for (const p of orig.points) { clx += p.x; cly += p.y; }
      ox = clx / orig.points.length;
      oy = cly / orig.points.length;
    }
  }
  // Label move on a dimension line (measureDistance text handle): anchor =
  // dimension-line midpoint + textOffset. Without this the generic x/width
  // fallback below would produce NaN (dimensions have no x/width).
  if (h === 'label_move' && ox === undefined
      && typeof orig.startX === 'number' && typeof orig.endX === 'number') {
    ox = (orig.startX + orig.endX) / 2 + (orig.textOffsetX || 0);
    oy = (orig.startY + orig.endY) / 2 + (orig.textOffsetY || 0);
  }
  // Sjabloon-eigen greep van een parametrisch symbool (bijv. de stijl van
  // een gevelelement): het sjabloon weet waar die greep zat.
  if (ox === undefined && orig.type === 'parametricSymbol') {
    const o = typeof sjabloonOorsprong === 'function' ? sjabloonOorsprong(orig, h) : null;
    if (o) { ox = o.x; oy = o.y; }
  }
  if (ox === undefined) {
    const t = _tweepuntGreep(orig, h);
    if (t) { ox = t.x; oy = t.y; }
  }
  if (ox === undefined) {
    ox = h === 'line_start' ? orig.startX
      : h === 'line_end' ? orig.endX
      : h === 'line_mid' ? (orig.startX + orig.endX) / 2
      : h === 'leader_start' ? orig.leaderStartX
      : h === 'leader_end' ? orig.leaderEndX
      : h === 'callout_arrow' ? (orig.arrowX || orig.x)
      : h === 'callout_knee' ? (orig.kneeX || orig.x)
      : h === 'circle_center' ? ((orig.x !== undefined ? orig.x : orig.centerX - (orig.radius || 0)) + (orig.width || (orig.radius || 0) * 2) / 2)
      : h === 'rect_center' ? (orig.x + (orig.width || 0) / 2)
      : (h === 'tl' || h === 'l' || h === 'bl') ? orig.x
      : (h === 'tr' || h === 'r' || h === 'br') ? orig.x + orig.width
      : orig.x + orig.width / 2;
    oy = h === 'line_start' ? orig.startY
      : h === 'line_end' ? orig.endY
      : h === 'line_mid' ? (orig.startY + orig.endY) / 2
      : h === 'leader_start' ? orig.leaderStartY
      : h === 'leader_end' ? orig.leaderEndY
      : h === 'callout_arrow' ? (orig.arrowY || orig.y)
      : h === 'callout_knee' ? (orig.kneeY || orig.y)
      : h === 'circle_center' ? ((orig.y !== undefined ? orig.y : orig.centerY - (orig.radius || 0)) + (orig.height || (orig.radius || 0) * 2) / 2)
      : h === 'rect_center' ? (orig.y + (orig.height || 0) / 2)
      : (h === 'tl' || h === 't' || h === 'tr') ? orig.y
      : (h === 'bl' || h === 'b' || h === 'br') ? orig.y + orig.height
      : orig.y + orig.height / 2;
    if (_MAATGREPEN.has(h)) {
      const p = greepOpScherm(orig, ox, oy);
      ox = p.x; oy = p.y;
    }
  }
  return { x: ox, y: oy };
}

/**
 * Beginpunt van de meetlijn: de plek van de greep bij het begin van de
 * sleep, of null voor grepen zonder meetlijn.
 */
export function strekBasispunt(orig, h) {
  const tweepunt = _tweepuntGreep(orig, h);
  if (tweepunt) return tweepunt;
  let bx, by;
  if (typeof h === 'string' && h.startsWith('polyline_node_') && !h.includes('hole') && Array.isArray(orig.points)) {
    const ni = parseInt(h.split('_').pop(), 10);
    if (!isNaN(ni) && ni < orig.points.length) {
      bx = orig.points[ni].x; by = orig.points[ni].y;
    }
  } else if (h === 'line_start') { bx = orig.startX; by = orig.startY; }
  else if (h === 'line_end') { bx = orig.endX; by = orig.endY; }
  else if (h === 'line_mid') { bx = (orig.startX + orig.endX) / 2; by = (orig.startY + orig.endY) / 2; }
  else if (h === 'rect_center') { bx = orig.x + (orig.width || 0) / 2; by = orig.y + (orig.height || 0) / 2; }
  else if (h === 'circle_center') {
    const cw = orig.width || (orig.radius || 0) * 2;
    const ch = orig.height || (orig.radius || 0) * 2;
    const cx0 = orig.x !== undefined ? orig.x : (orig.centerX - (orig.radius || 0));
    const cy0 = orig.y !== undefined ? orig.y : (orig.centerY - (orig.radius || 0));
    bx = cx0 + cw / 2; by = cy0 + ch / 2;
  } else if (h === 'tl') { bx = orig.x; by = orig.y; }
  else if (h === 'tr') { bx = orig.x + orig.width; by = orig.y; }
  else if (h === 'bl') { bx = orig.x; by = orig.y + orig.height; }
  else if (h === 'br') { bx = orig.x + orig.width; by = orig.y + orig.height; }
  else if (h === 't') { bx = orig.x + orig.width / 2; by = orig.y; }
  else if (h === 'b') { bx = orig.x + orig.width / 2; by = orig.y + orig.height; }
  else if (h === 'l') { bx = orig.x; by = orig.y + orig.height / 2; }
  else if (h === 'r') { bx = orig.x + orig.width; by = orig.y + orig.height / 2; }
  if (bx === undefined || by === undefined) return null;
  return _MAATGREPEN.has(h) ? greepOpScherm(orig, bx, by) : { x: bx, y: by };
}

/**
 * Lengte van de meetlijn als tekst, bijv. "3.13 m". `schaal` is de schaal ter
 * plekke ({ pixelsPerUnit, unit }, van findMeasureScale in measurement.js:
 * dezelfde omrekening als de maatvelden B/H), of null zonder enige schaal;
 * dan blijven het punten ("12.3 px"). De documentschaal is een object; een
 * oude kale getal-schaal (eenheden per punt) rekent nog zoals vroeger.
 */
export function strekLengteTekst(lengte, schaal, doc) {
  if (schaal && schaal.pixelsPerUnit > 0) {
    return `${(lengte / schaal.pixelsPerUnit).toFixed(2)} ${schaal.unit || 'mm'}`;
  }
  const oud = doc?.measureScale;
  if (typeof oud === 'number' && oud > 0) {
    return `${(lengte * oud).toFixed(1)} ${doc.measureUnit || 'px'}`;
  }
  return `${lengte.toFixed(1)} px`;
}
