// Stavenreeks — pure geometrie- en hoeveelheden-module (GEEN UI/DOM-deps).
//
// Dit is de ENIGE bron van waarheid voor de vorm van een stavenreeks:
// de canvas-rendering (annotations/rendering.js), de hoeveelheden-afleiding
// (quantities/categories.js) en straks de PDF-appearance-generatie
// (/AP /N Form-XObject in de saver) gebruiken allemaal deze functies.
// Zo kunnen scherm en PDF per definitie niet uit elkaar lopen.
//
// Rotatie-veiligheid (hard vereist, zie docs/superpowers/
// research-pdf-rotatie-mechanica.md §12.5.5): ALLE geometrie wordt afgeleid uit
// de vier coördinaten startX/startY/endX/endY. Er is GEEN `rotation`-veld en
// GEEN losse rotatie-transform. Een schuine reeks ontstaat doordat de punten
// zelf schuin liggen — niet doordat er een matrix overheen gaat. Daardoor kan
// de AP-stream straks `/Matrix` = identiteit en `/BBox` = `/Rect` houden, wat
// de §12.5.5-mapping A tot een identiteit maakt.

/** Standaard wapeningsstaaf-diameters (mm). */
export const STAVENREEKS_DIAMETERS = [6, 8, 10, 12, 16, 20, 25, 32, 40];

/** Toegestane pootrichtingen: {boven|onder} × {links|rechts hellend}. */
export const STAVENREEKS_LEG_DIRS = ['down-left', 'down-right', 'up-left', 'up-right'];

/** Doorstreepte-⌀ (U+2300 DIAMETER SIGN). */
export const DIAMETER_SIGN = '⌀';

/** Defaults, één plek — gebruikt door de creator én als fallback bij render. */
export const STAVENREEKS_DEFAULTS = {
  count: 3,
  diameter: 12,
  barLengthMm: 0,
  legDir: 'down-left',
  legLength: 24,
  labelSide: 'end',
  fontSize: 12,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Puntstraal als functie van de staafdiameter (app-px op schaal 1).
 * ⌀12 → 3.44, ⌀40 → 6.8; begrensd op [2, 9].
 */
export function pointRadius(diameter) {
  const d = Number(diameter);
  if (!Number.isFinite(d)) return 2;
  return clamp(2 + d * 0.12, 2, 9);
}

/** Genormaliseerde parameters met defaults ingevuld (puur, muteert niets). */
export function resolveParams(ann) {
  const a = ann || {};
  const count = Math.max(1, Math.round(Number(a.count) || STAVENREEKS_DEFAULTS.count));
  const diameter = Number(a.diameter) || STAVENREEKS_DEFAULTS.diameter;
  const barLengthMm = Number(a.barLengthMm) || 0;
  const legDir = STAVENREEKS_LEG_DIRS.includes(a.legDir) ? a.legDir : STAVENREEKS_DEFAULTS.legDir;
  const legLength = Number(a.legLength) > 0 ? Number(a.legLength) : STAVENREEKS_DEFAULTS.legLength;
  const labelSide = a.labelSide === 'start' ? 'start' : 'end';
  const fontSize = Number(a.fontSize) > 0 ? Number(a.fontSize) : STAVENREEKS_DEFAULTS.fontSize;
  return { count, diameter, barLengthMm, legDir, legLength, labelSide, fontSize };
}

/** Labeltekst "N ⌀ D" (bv. "5 ⌀ 16"). */
export function labelText(count, diameter) {
  const p = resolveParams({ count, diameter });
  return `${p.count} ${DIAMETER_SIGN} ${p.diameter}`;
}

/**
 * Eenheidsrichting van de reekslijn + de loodrechte.
 * n = (-uy, ux): voor een lijn naar rechts (u = (1,0)) wijst n naar (0,1),
 * in schermcoördinaten (y omlaag) dus NAAR BENEDEN. 'down' = +n, 'up' = -n.
 */
function lineFrame(startX, startY, endX, endY) {
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) {
    return { ux: 1, uy: 0, nx: 0, ny: 1, len: 0 };
  }
  const ux = dx / len, uy = dy / len;
  return { ux, uy, nx: -uy, ny: ux, len };
}

/**
 * Staafposities gelijkmatig over de reekslijn.
 * count === 1 → precies het midden; count >= 2 → inclusief beide uiteinden.
 */
export function barPositions(startX, startY, endX, endY, count) {
  const n = Math.max(1, Math.round(Number(count) || 1));
  if (n === 1) {
    return [{ x: (startX + endX) / 2, y: (startY + endY) / 2 }];
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push({ x: startX + (endX - startX) * t, y: startY + (endY - startY) * t });
  }
  return out;
}

/**
 * Eenheidsvector van een poot: 45° t.o.v. de reekslijn, samengesteld uit de
 * loodrechte (boven/onder) en de tangent (links/rechts hellend).
 */
export function legUnitVector(frame, legDir) {
  const dir = STAVENREEKS_LEG_DIRS.includes(legDir) ? legDir : STAVENREEKS_DEFAULTS.legDir;
  const perpSign = dir.startsWith('down') ? 1 : -1;
  const leanSign = dir.endsWith('right') ? 1 : -1;
  const vx = perpSign * frame.nx + leanSign * frame.ux;
  const vy = perpSign * frame.ny + leanSign * frame.uy;
  const m = Math.hypot(vx, vy) || 1;
  return { x: vx / m, y: vy / m };
}

/**
 * Breedte-schatter voor labeltekst zonder canvas. Wordt gebruikt in node-tests
 * en als fallback; de renderer geeft een echte ctx.measureText-meter mee.
 */
export function approxTextWidth(text, fontSize) {
  return String(text).length * fontSize * 0.55;
}

/**
 * Indeling van het label "N ⌀ D" in losse onderdelen.
 *
 * Het diameterteken wordt als VECTOR getekend (cirkel + schuine streep), niet
 * als glyph. Reden: U+2300 zit niet in WinAnsiEncoding, dus een standaard
 * Helvetica in de PDF-appearance kan hem niet weergeven. Door hem in ZOWEL het
 * canvas als de PDF-stream als vector te tekenen, zijn scherm en PDF identiek
 * en is er geen font-afhankelijkheid.
 *
 * @returns {{parts: Array, width: number, signRadius: number}}
 *   parts: [{kind:'text'|'dia', text?, dx, w}] — dx is de x-offset vanaf het
 *   begin van het label, langs de tekstrichting.
 */
export function labelLayout(count, diameter, fontSize, measure = approxTextWidth) {
  const p = resolveParams({ count, diameter });
  const left = String(p.count);
  const right = String(p.diameter);
  const gap = fontSize * 0.22;
  const signW = fontSize * 0.62;
  const wl = measure(left, fontSize);
  const wr = measure(right, fontSize);
  const parts = [
    { kind: 'text', text: left, dx: 0, w: wl },
    { kind: 'dia', dx: wl + gap, w: signW },
    { kind: 'text', text: right, dx: wl + gap + signW + gap, w: wr },
  ];
  return {
    parts,
    width: wl + gap + signW + gap + wr,
    signRadius: fontSize * 0.28,
  };
}

/**
 * Bouw de volledige stavenreeks-geometrie.
 *
 * @param {object} ann  Annotatie met startX/startY/endX/endY + parameters.
 * @param {object} [opts]
 * @param {(text:string,fontSize:number)=>number} [opts.measureText]
 *        Echte tekstbreedte-meter (canvas of PDF-fontmetriek). Default: schatting.
 * @returns {{
 *   params: object, frame: object, line: object,
 *   legs: Array, dots: Array, label: object,
 *   primitives: Array, aabb: {x:number,y:number,width:number,height:number}
 * }}
 */
export function buildStavenreeks(ann, opts = {}) {
  const measure = typeof opts.measureText === 'function' ? opts.measureText : approxTextWidth;

  const startX = Number(ann?.startX) || 0;
  const startY = Number(ann?.startY) || 0;
  const endX = Number(ann?.endX) || 0;
  const endY = Number(ann?.endY) || 0;

  const params = resolveParams(ann);
  const frame = lineFrame(startX, startY, endX, endY);
  const r = pointRadius(params.diameter);

  const line = { x1: startX, y1: startY, x2: endX, y2: endY };

  // Poten + punten
  const positions = barPositions(startX, startY, endX, endY, params.count);
  const lv = legUnitVector(frame, params.legDir);
  const legs = [];
  const dots = [];
  for (const p of positions) {
    const tipX = p.x + lv.x * params.legLength;
    const tipY = p.y + lv.y * params.legLength;
    legs.push({ x1: p.x, y1: p.y, x2: tipX, y2: tipY });
    dots.push({ x: tipX, y: tipY, r });
  }

  // Label: net voorbij het gekozen uiteinde, uitgelijnd langs de lijnrichting.
  const text = labelText(params.count, params.diameter);
  const fontSize = params.fontSize;
  const layout = labelLayout(params.count, params.diameter, fontSize, measure);
  const textW = layout.width;
  const atEnd = params.labelSide === 'end';
  const anchorX = atEnd ? endX : startX;
  const anchorY = atEnd ? endY : startY;
  // Richting waarin het label van de lijn wegloopt.
  let dx = atEnd ? frame.ux : -frame.ux;
  let dy = atEnd ? frame.uy : -frame.uy;
  if (frame.len === 0) { dx = 1; dy = 0; }
  const gap = fontSize * 0.5;
  const labelX = anchorX + dx * gap;
  const labelY = anchorY + dy * gap;

  // Leesbaarheid: tekst nooit op zijn kop. Bij een naar-links wijzende
  // uitloop draaien we de tekenrichting 180° en laten de tekst vanaf het
  // ankerpunt de ANDERE kant op lopen (align 'right'), zodat hij fysiek nog
  // steeds van de lijn af staat.
  let angle = Math.atan2(dy, dx);
  let align = 'left';
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
    angle += Math.PI;
    align = 'right';
  }

  const label = {
    text, x: labelX, y: labelY, angle, align,
    fontSize, width: textW,
    // Onderdelen (tekst + vector-⌀) — gedeeld door canvas en PDF-appearance.
    parts: layout.parts, signRadius: layout.signRadius,
    // Fysieke uitlooprichting van de tekst (onafhankelijk van de flip).
    dirX: dx, dirY: dy,
  };

  // ── AABB van het HELE element ────────────────────────────────────────────
  // Inclusief reekslijn, poten, punt-cirkels én het (geroteerde) labelvak.
  // Deze AABB is straks 1-op-1 de PDF-/Rect en de /BBox-afmeting.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  grow(startX, startY);
  grow(endX, endY);
  for (const l of legs) grow(l.x2, l.y2);
  for (const d of dots) {
    grow(d.x - d.r, d.y - d.r);
    grow(d.x + d.r, d.y + d.r);
  }
  // Labelvak: loopt vanaf (labelX,labelY) `textW` ver in de FYSIEKE
  // uitlooprichting, en ±0.6·fontSize loodrecht (baseline = midden).
  {
    const px = -dy, py = dx;              // loodrecht op de uitloop
    const half = fontSize * 0.6;
    for (const t of [0, textW]) {
      for (const s of [-half, half]) {
        grow(labelX + dx * t + px * s, labelY + dy * t + py * s);
      }
    }
  }

  const aabb = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  // Tekenprimitieven in ABSOLUTE app-coördinaten. `toLocalPrimitives` zet ze
  // om naar AABB-relatief voor de AP-stream.
  const primitives = [
    { kind: 'line', ...line },
    ...legs.map(l => ({ kind: 'line', ...l })),
    ...dots.map(d => ({ kind: 'dot', ...d })),
    {
      kind: 'text', text, x: labelX, y: labelY, size: fontSize, angle, align,
      // Onderdelen + de x-offset waar het label in het geroteerde frame begint
      // ('right' laat het label vóór het ankerpunt eindigen).
      parts: layout.parts, signRadius: layout.signRadius,
      startOffset: align === 'right' ? -textW : 0,
      width: textW,
    },
  ];

  return { params, frame, line, legs, dots, label, primitives, aabb };
}

/**
 * Zet absolute primitieven om naar AABB-relatieve coördinaten.
 * Voor de PDF-AP: `/BBox [0 0 w h]`, `/Matrix` identiteit, `/Rect` = AABB.
 * @param {Array} primitives  Uit buildStavenreeks().primitives
 * @param {{x:number,y:number,width:number,height:number}} aabb
 * @param {{flipY?:boolean}} [opts]  flipY: naar PDF-assen (y omhoog).
 */
export function toLocalPrimitives(primitives, aabb, opts = {}) {
  const flipY = !!opts.flipY;
  const mapX = (x) => x - aabb.x;
  const mapY = (y) => (flipY ? (aabb.y + aabb.height - y) : (y - aabb.y));
  return primitives.map((p) => {
    switch (p.kind) {
      case 'line':
        return { ...p, x1: mapX(p.x1), y1: mapY(p.y1), x2: mapX(p.x2), y2: mapY(p.y2) };
      case 'dot':
        return { ...p, x: mapX(p.x), y: mapY(p.y) };
      case 'text':
        return { ...p, x: mapX(p.x), y: mapY(p.y), angle: flipY ? -p.angle : p.angle };
      default:
        return { ...p };
    }
  });
}

/**
 * Totale staaflengte van een reeks in METER: count × barLengthMm (mm → m).
 * Retourneert null als de staaflengte onbekend is (0), zodat de
 * hoeveelhedenstaat een lege cel toont in plaats van een misleidende 0.
 */
export function totalBarLengthM(ann) {
  const p = resolveParams(ann);
  if (!(p.barLengthMm > 0)) return null;
  return (p.count * p.barLengthMm) / 1000;
}
