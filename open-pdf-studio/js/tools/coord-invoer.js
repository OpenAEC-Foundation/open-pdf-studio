/**
 * Pure kern van de CAD-achtige coördinaatinvoer (zie type-length-input.js):
 * het parsen van de getypte buffer en het beperken van een eindpunt tot die
 * invoer. Geen afhankelijkheden van app-state, zodat het los te testen is en
 * door zowel de tekengereedschappen als het handvat-slepen gedeeld wordt.
 *
 *   length        `100`        afstand in de richting anker → cursor
 *   relative XY   `100,50`     verschuiving dx,dy vanaf het anker
 *   polar         `100<45`     afstand onder hoek (graden) vanaf het anker
 *   absolute      `=400,300`   absolute app-coördinaat
 */

/**
 * Parse a buffer string into a structured form.
 * Returns { kind, a, b } where:
 *   kind ∈ 'empty' | 'length' | 'cartesian' | 'polar' | 'absolute' | 'invalid'
 *   a, b are numbers (b unused for length)
 */
export function parseCoordBuffer(s) {
  if (!s || s.length === 0) return { kind: 'empty', a: null, b: null };

  // Absolute: starts with '='
  if (s[0] === '=') {
    const rest = s.slice(1);
    if (rest.length === 0) return { kind: 'absolute', a: null, b: null };
    // require a comma separator (or '<' for polar-absolute, but spec keeps it cartesian-only)
    const idx = rest.indexOf(',');
    if (idx < 0) return { kind: 'absolute', a: null, b: null };
    const xs = rest.slice(0, idx);
    const ys = rest.slice(idx + 1);
    const x = _toNum(xs);
    const y = _toNum(ys);
    if (x == null || (ys.length > 0 && y == null)) return { kind: 'invalid', a: null, b: null };
    return { kind: 'absolute', a: x, b: ys.length === 0 ? null : y };
  }

  // Polar: contains '<'
  const ltIdx = s.indexOf('<');
  if (ltIdx >= 0) {
    const ds = s.slice(0, ltIdx);
    const ts = s.slice(ltIdx + 1);
    const d = _toNum(ds);
    const t = ts.length === 0 ? null : _toNum(ts);
    if (d == null) return { kind: 'invalid', a: null, b: null };
    if (ts.length > 0 && t == null) return { kind: 'invalid', a: null, b: null };
    return { kind: 'polar', a: d, b: t };
  }

  // Relative XY: contains ','
  const commaIdx = s.indexOf(',');
  if (commaIdx >= 0) {
    const xs = s.slice(0, commaIdx);
    const ys = s.slice(commaIdx + 1);
    const x = _toNum(xs);
    const y = ys.length === 0 ? null : _toNum(ys);
    if (x == null) return { kind: 'invalid', a: null, b: null };
    if (ys.length > 0 && y == null) return { kind: 'invalid', a: null, b: null };
    return { kind: 'cartesian', a: x, b: y };
  }

  // Length-only: must be numeric
  const v = _toNum(s);
  if (v == null) return { kind: 'invalid', a: null, b: null };
  return { kind: 'length', a: v, b: null };
}

function _toNum(s) {
  if (s == null) return null;
  const t = s.trim();
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  // Reject anything that isn't a clean signed decimal
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const v = parseFloat(t);
  return isFinite(v) ? v : null;
}

/**
 * Constrain a cursor-driven endpoint to a parsed buffer.
 * `pxPerUnit` converts typed scale units to app pixels (absolute mode is
 * already in app pixels). Returns { x, y, constrained }. For an empty or
 * unparseable buffer the unchanged cursor coords are returned.
 */
export function beperkEindpunt(r, startX, startY, cursorX, cursorY, pxPerUnit) {
  const k0 = pxPerUnit > 0 ? pxPerUnit : 1;
  switch (r?.kind) {
    case 'length': {
      if (r.a == null || r.a <= 0) {
        return { x: cursorX, y: cursorY, constrained: false };
      }
      const dx = cursorX - startX;
      const dy = cursorY - startY;
      const len = Math.sqrt(dx * dx + dy * dy);
      const pixels = r.a * k0;
      if (len === 0) return { x: startX + pixels, y: startY, constrained: true };
      const k = pixels / len;
      return { x: startX + dx * k, y: startY + dy * k, constrained: true };
    }
    case 'cartesian': {
      // Need both fields to constrain. If only dx typed, fall back to cursor Y.
      if (r.a == null) return { x: cursorX, y: cursorY, constrained: false };
      const dxPx = r.a * k0;
      const dyPx = r.b == null ? (cursorY - startY) : r.b * k0;
      return { x: startX + dxPx, y: startY + dyPx, constrained: true };
    }
    case 'polar': {
      if (r.a == null) return { x: cursorX, y: cursorY, constrained: false };
      // Angle: if typed, use it; otherwise use cursor angle from anchor.
      let theta;
      if (r.b == null) {
        theta = Math.atan2(cursorY - startY, cursorX - startX);
      } else {
        // App Y axis points down; convert mathematical angle (CCW from +X) so
        // positive angles rotate counter-clockwise on screen.
        theta = -r.b * Math.PI / 180;
      }
      const pixels = r.a * k0;
      return {
        x: startX + Math.cos(theta) * pixels,
        y: startY + Math.sin(theta) * pixels,
        constrained: true,
      };
    }
    case 'absolute': {
      // =X,Y → raw app-coordinates (already in app-pixel space).
      if (r.a == null) return { x: cursorX, y: cursorY, constrained: false };
      const ax = r.a;
      const ay = r.b == null ? cursorY : r.b;
      return { x: ax, y: ay, constrained: true };
    }
    default:
      return { x: cursorX, y: cursorY, constrained: false };
  }
}
