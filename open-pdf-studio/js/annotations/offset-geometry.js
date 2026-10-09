/**
 * Offset-geometrie (AutoCAD OFFSET) — puur, zonder state/DOM, zodat de
 * unit-tests hem direct kunnen aanroepen.
 *
 * offsetProps(ann, dist, side) levert de nieuwe geometrie-velden voor een
 * OFFSET-copy op afstand `dist` (in pagina-pixels) aan de kant van het punt
 * `side`:
 *
 *   - lijngebaseerd (startX/startY … endX/endY) → loodrechte verschuiving,
 *     de kant volgt uit het vectoriele product tussen lijnrichting en `side`
 *   - rechthoekig (x/y/width/height, o.a. box, circle en de regelmatige
 *     polygon) → buitenom groeien, of inkrimpen als `side` binnen de omtrek
 *     valt
 *   - puntengebaseerd (points[], o.a. polyline en lshape) → parallelle
 *     contouroverschuiving langs de hoekpuntsbissectrices, open én gesloten
 *
 * Retourneert null als het type niet ondersteund wordt of als de afstand de
 * vorm zou doen verdwijnen (krimpen voorbij nul).
 */

// Types die we veilig kunnen offsetten. Met bewust een korte lijst: types met
// extra betekenis (maatlijnen, gemeten oppervlakken, wolkjes met bumps) zijn
// geen geometrische vormen die je "parallel kopieert".
const ONDERSTEUND = new Set([
  'box', 'circle', 'polygon', 'polyline', 'lshape',
  'line', 'arrow', 'wall', 'betonbalk',
]);

// Kleiner dan dit is geen bruikbare vorm meer (paginapunten).
const MIN_MAAT = 0.5;

const _fin = (v) => Number.isFinite(v);

export function isLineAnnotation(ann) {
  return !!ann && _fin(ann.startX) && _fin(ann.startY) && _fin(ann.endX) && _fin(ann.endY);
}

export function isRectAnnotation(ann) {
  return !!ann && _fin(ann.x) && _fin(ann.y) && _fin(ann.width) && _fin(ann.height);
}

/** Of dit type object in principe geoffzet kan worden (los van afstand). */
export function canOffset(ann) {
  if (!ann || !ONDERSTEUND.has(ann.type)) return false;
  if (isLineAnnotation(ann)) return true;
  if (Array.isArray(ann.points) && ann.points.length > 1) return true;
  if (isRectAnnotation(ann)) return true;
  return false;
}

/**
 * @param {object} ann      bron-annotatie (onveranderd)
 * @param {number} dist     offsetafstand in pagina-punten (> 0)
 * @param {{x:number,y:number}} side  punt dat de kant van de offset bepaalt
 * @returns {object|null}   velden om op een copy te mergen, of null
 */
export function offsetProps(ann, dist, side) {
  if (!ann || !_fin(dist) || dist <= 0) return null;
  if (!ONDERSTEUND.has(ann.type)) return null;
  if (isLineAnnotation(ann)) return _offsetLine(ann, dist, side);
  if (Array.isArray(ann.points) && ann.points.length > 1) return _offsetPoints(ann, dist, side);
  if (isRectAnnotation(ann)) return _offsetRect(ann, dist, side);
  return null;
}

/** Rechthoek/ellipse: `side` binnen de omtrek = inkrimpen, erbuiten = groeien. */
function _offsetRect(ann, dist, side) {
  const binnen = !!side
    && side.x >= ann.x && side.x <= ann.x + ann.width
    && side.y >= ann.y && side.y <= ann.y + ann.height;
  if (binnen) {
    const width = ann.width - 2 * dist;
    const height = ann.height - 2 * dist;
    if (width < MIN_MAAT || height < MIN_MAAT) return null;
    return { x: ann.x + dist, y: ann.y + dist, width, height };
  }
  return {
    x: ann.x - dist,
    y: ann.y - dist,
    width: ann.width + 2 * dist,
    height: ann.height + 2 * dist,
  };
}

/** Lijn/pijl/wand: loodrecht op de lijn, naar de kant van `side`. */
function _offsetLine(ann, dist, side) {
  const dx = ann.endX - ann.startX;
  const dy = ann.endY - ann.startY;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const sign = _sideSign(dx, dy, ann.startX, ann.startY, side);
  const nx = (-dy / len) * sign * dist;
  const ny = (dx / len) * sign * dist;
  return {
    startX: ann.startX + nx,
    startY: ann.startY + ny,
    endX: ann.endX + nx,
    endY: ann.endY + ny,
  };
}

/** +1 als `side` links van de richting (dx,dy) ligt, -1 rechts. */
function _sideSign(dx, dy, ax, ay, side) {
  if (!side) return 1;
  const cross = dx * (side.y - ay) - dy * (side.x - ax);
  return cross >= 0 ? 1 : -1;
}

/**
 * Puntenreeks: elk randsegment eerst op afstand leggen, daarna de
 * verschoven randlijnen per hoekpunt snijden (bissectrice-methode). Open
 * reeksen schuiven de uiteinden simpelweg loodrecht mee.
 */
function _offsetPoints(ann, dist, side) {
  let pts = ann.points;
  if (pts.length < 2) return null;

  // Gesloten ring met herhaald eerste punt? Eerst ontleden, aan het eind
  // weer sluiten zodat de vorm exact zo terugkomt als die inging.
  let herhaald = false;
  if (pts.length > 2 && _dichtbij(pts[0], pts[pts.length - 1])) {
    herhaald = true;
    pts = pts.slice(0, -1);
  }
  const n = pts.length;
  if (n < 2) return null;
  const gesloten = herhaald || ann.type === 'lshape' || ann.type === 'polygon';

  const count = gesloten ? n : n - 1;
  const area = gesloten ? _signedArea(pts) : 0;
  const edges = [];
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) { edges.push(null); continue; }
    let nx = -dy / len;   // linksnormaal
    let ny = dx / len;
    // Voor een gesloten ring wijzen de linksnormalen bij een positieve
    // oppervlakte (wijzerzin op scherm) naar BINNEN → omdraaien naar buiten.
    if (gesloten && area > 0) { nx = -nx; ny = -ny; }
    edges.push({ dx: dx / len, dy: dy / len, nx, ny });
  }
  if (!edges.some(Boolean)) return null;

  // Kant: bij een gesloten vorm = inkompunt binnen de contour (krimpen);
  // bij een open reeks = vectorieel product met de eerste rand.
  let dir;
  if (gesloten) {
    dir = _pointInPolygon(side, pts) ? -1 : 1;
  } else {
    const e0 = edges.find(Boolean);
    dir = _sideSign(e0.dx, e0.dy, pts[edges.indexOf(e0)].x, pts[edges.indexOf(e0)].y, side);
  }
  const off = dist * dir;

  const out = [];
  for (let i = 0; i < n; i++) {
    const eIn = (i > 0 || gesloten) ? edges[(i - 1 + count) % count] : null;
    const eOut = (i < count) ? edges[i] : null;
    let nv = null;
    if (eIn && eOut) {
      nv = _intersect(
        { x: pts[i].x + eIn.nx * off, y: pts[i].y + eIn.ny * off }, eIn,
        { x: pts[i].x + eOut.nx * off, y: pts[i].y + eOut.ny * off }, eOut,
      );
    }
    if (!nv) {
      if (eIn && eOut) {
        // Parallelle (collineaire) randen: gemiddelde van beide normalen.
        nv = {
          x: pts[i].x + ((eIn.nx + eOut.nx) / 2) * off,
          y: pts[i].y + ((eIn.ny + eOut.ny) / 2) * off,
        };
      } else {
        const e = eIn || eOut;
        if (!e) return null;
        nv = { x: pts[i].x + e.nx * off, y: pts[i].y + e.ny * off };
      }
    }
    out.push(nv);
  }

  if (herhaald) out.push({ ...out[0] });

  const props = { points: out };
  // Reeksvormen met een mee-gehouden omtrek (lshape, polyline) updaten hun
  // bbox mee, anders klopt selectie/hit-testing niet meer.
  if (isRectAnnotation(ann)) {
    const b = _bbox(out);
    props.x = b.x; props.y = b.y; props.width = b.width; props.height = b.height;
  }
  return props;
}

/** Snijpunt van twee richtingsvectoren (oneindige lijnen), of null. */
function _intersect(p1, e1, p2, e2) {
  const det = e1.dx * e2.dy - e1.dy * e2.dx;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((p2.x - p1.x) * e2.dy - (p2.y - p1.y) * e2.dx) / det;
  return { x: p1.x + t * e1.dx, y: p1.y + t * e1.dy };
}

function _dichtbij(a, b, eps = 1e-6) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

/** Shoelace-oppervlakte (teken = winding, y-omlaag op scherm). */
export function _signedArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Ray-casting punt-in-polygon (ray naar +x). */
export function _pointInPolygon(p, pts) {
  if (!p) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    const snijdt = (a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x;
    if (snijdt) inside = !inside;
  }
  return inside;
}

function _bbox(pts) {
  let x = Infinity, y = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) {
    x = Math.min(x, p.x); y = Math.min(y, p.y);
    x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y);
  }
  return { x, y, width: x2 - x, height: y2 - y };
}
