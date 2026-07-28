// Systeemraster — pure geometrie-module (GEEN UI/DOM/app-state-deps).
//
// Een systeemgenerator die een getekende contour vult met een rechthoekig
// raster van platen (systeemplafond, veld met stelconplaten 2000×2000 mm, …).
// Dit is de ENIGE bron van waarheid voor de vorm: de canvas-rendering
// (annotations/rendering.js via rendering/systeemraster-draw.js), de hit-test
// en de PDF-appearance-generatie (saver → buildSysteemrasterAP) gebruiken
// allemaal buildSysteemraster(). Zo kunnen scherm en PDF per definitie niet
// uit elkaar lopen.
//
// Model: de annotatie draagt de CONTOUR als points[] (zoals filledArea; dat
// geeft verplaatsen/roteren/node-grips gratis via de generieke walkers) plus
// de rasterparameters:
//  * plaatBreedteMm / plaatHoogteMm — plaatmaat in werkelijke mm (via het
//    schaalgebied, zoals betonbalk/stavenreeks; fallback 1:100);
//  * originXMm / originYMm — verschuiving van de rasteroorsprong t.o.v. de
//    contour-AABB-linksboven, in werkelijke mm (translatie-invariant: het
//    raster verhuist vanzelf mee met de contour);
//  * equalizeX / equalizeY — randstukken links/rechts resp. boven/onder
//    gelijk maken (raster centreren per as; overschrijft de origin op die as);
//  * randConditie — hoe randen behandeld worden. v1: 'tonen' (gesneden platen
//    gewoon tonen) en 'minmaat' (raster zó schuiven dat geen randstuk smaller
//    dan minRandMm ontstaat). Bewust een string-switch + één centrale
//    _applyRandConditie() zodat latere, slimmere randafval-strategieën hier
//    kunnen aanhaken zonder de aanroepers te raken;
//  * rasterHoek — GERESERVEERD veld voor een gedraaid raster; v1 rekent
//    altijd met 0° (het veld wordt wel bewaard en her-opgeslagen).
//
// Rotatie-/verplaatsingsveiligheid: alle geometrie wordt per aanroep opnieuw
// afgeleid uit points[] + parameters; er wordt nooit iets gemuteerd.

/** Toegestane randcondities (uitbreidbaar — zie _applyRandConditie). */
export const SYSTEEMRASTER_RANDCONDITIES = ['tonen', 'minmaat'];

/** Defaults, één plek — gebruikt door de creator én als fallback bij render. */
export const SYSTEEMRASTER_DEFAULTS = {
  plaatBreedteMm: 2000,
  plaatHoogteMm: 2000,
  originXMm: 0,
  originYMm: 0,
  equalizeX: false,
  equalizeY: false,
  randConditie: 'tonen',
  minRandMm: 300,
  rasterHoek: 0,
  tagTonen: true,
  tagFontSize: 10,
};

/** Bereik van de instelbare plaatmaat (mm). */
export const SYSTEEMRASTER_PLAAT_RANGE = { min: 50, max: 20000 };

/**
 * Vaste omrekening als er GEEN schaal(gebied) bekend is: 1:100.
 * 1 werkelijke mm = 0,01 papier-mm = 0,01 × 72/25,4 pt ≈ 0,0283 app-px.
 */
export const PX_PER_MM_1_100 = 72 / 25.4 / 100;

/** Tolerantie (app-px) waaronder een randstuk als "geen randstuk" telt —
 *  bijvoorbeeld wanneer een contourrand precies op een rasterlijn ligt. */
export const EDGE_EPS = 1e-6;

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/** Wiskundige modulo (resultaat altijd in [0, n)). */
export function mod(a, n) {
  return ((a % n) % n + n) % n;
}

/** Genormaliseerde parameters met defaults ingevuld (puur, muteert niets). */
export function resolveSysteemrasterParams(ann) {
  const a = ann || {};
  const D = SYSTEEMRASTER_DEFAULTS;
  const num = (v, dflt, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? clamp(n, lo, hi) : dflt;
  };
  const off = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const mr = Number(a.minRandMm);
  const tf = Number(a.tagFontSize);
  return {
    plaatBreedteMm: num(a.plaatBreedteMm, D.plaatBreedteMm,
      SYSTEEMRASTER_PLAAT_RANGE.min, SYSTEEMRASTER_PLAAT_RANGE.max),
    plaatHoogteMm: num(a.plaatHoogteMm, D.plaatHoogteMm,
      SYSTEEMRASTER_PLAAT_RANGE.min, SYSTEEMRASTER_PLAAT_RANGE.max),
    originXMm: off(a.originXMm),
    originYMm: off(a.originYMm),
    equalizeX: a.equalizeX === true,
    equalizeY: a.equalizeY === true,
    randConditie: SYSTEEMRASTER_RANDCONDITIES.includes(a.randConditie)
      ? a.randConditie : D.randConditie,
    minRandMm: Number.isFinite(mr) && mr >= 0 ? mr : D.minRandMm,
    // Gereserveerd: wordt bewaard/heropgeslagen, maar v1 rekent met 0.
    rasterHoek: Number.isFinite(Number(a.rasterHoek)) ? Number(a.rasterHoek) : 0,
    tagTonen: a.tagTonen !== false,
    tagFontSize: Number.isFinite(tf) && tf > 0 ? clamp(tf, 4, 72) : D.tagFontSize,
  };
}

/** Geldige contourpunten van de annotatie (≥ 3, opeenvolgende dubbelen weg). */
export function systeemrasterContour(ann) {
  const out = [];
  for (const p of (ann && ann.points) || []) {
    const x = Number(p && p.x), y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.hypot(x - prev.x, y - prev.y) < 1e-9) continue;
    out.push({ x, y });
  }
  // Gesloten aangeleverde contour (laatste == eerste): sluitpunt weglaten.
  if (out.length >= 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-9) out.pop();
  }
  return out.length >= 3 ? out : null;
}

/** Breedte-schatter voor de tag zonder canvas (zelfde heuristiek als de
 *  betonbalk); de renderer mag een echte meter meegeven. */
export function approxTextWidth(text, fontSize) {
  return String(text).length * fontSize * 0.55;
}

/** Tagtekst van het raster: de plaatmaat "BxH" (mm). ASCII-'x', zodat de
 *  PDF-appearance (Helvetica/WinAnsi) exact dezelfde tekst kan zetten. */
export function systeemrasterTagTekst(params) {
  return `${Math.round(params.plaatBreedteMm)}x${Math.round(params.plaatHoogteMm)}`;
}

// ── as-offset (kern van origin / equalize / randconditie) ──────────────────

// Randstukken bij een gegeven offset: links = offset zelf, rechts = rest.
// Een waarde < EDGE_EPS betekent "rasterlijn valt samen met de rand" — dan
// begint/eindigt het veld met een VOLLE plaat en is er géén randstuk.
function _edges(lengthPx, cellPx, off) {
  const left = off < EDGE_EPS ? 0 : off;
  const rRaw = mod(lengthPx - off, cellPx);
  const right = rRaw < EDGE_EPS || cellPx - rRaw < EDGE_EPS ? 0 : rRaw;
  return { left, right };
}

// Voldoet een offset aan de minimale-randmaat? (0 = geen randstuk = ok)
function _satisfiesMin(lengthPx, cellPx, off, minPx) {
  const { left, right } = _edges(lengthPx, cellPx, off);
  return (left === 0 || left >= minPx - EDGE_EPS)
      && (right === 0 || right >= minPx - EDGE_EPS);
}

// Randconditie toepassen op de basis-offset van één as. UITBREIDINGSPUNT:
// nieuwe strategieën ("iets intelligents met randafval") krijgen hier hun
// eigen tak en kunnen desnoods méér teruggeven dan alleen een offset.
function _applyRandConditie(lengthPx, cellPx, baseOff, params, minPx) {
  if (params.randConditie !== 'minmaat' || !(minPx > 0)) return baseOff;
  if (_satisfiesMin(lengthPx, cellPx, baseOff, minPx)) return baseOff;
  // Deterministische kandidaten: gecentreerd, rand exact op de minmaat
  // (links resp. rechts) en "vol beginnen" (offset 0). De eerste die voldoet
  // wint; voldoet geen enkele (contour te krap), dan de kandidaat met het
  // grootste kleinste randstuk (volle plaat telt als cellPx).
  const candidates = [
    mod(lengthPx, cellPx) / 2,            // equalize
    mod(minPx, cellPx),                   // linkerrand exact minmaat
    mod(lengthPx - minPx, cellPx),        // rechterrand exact minmaat
    0,                                    // vol beginnen op de rand
  ];
  for (const c of candidates) {
    if (_satisfiesMin(lengthPx, cellPx, c, minPx)) return c;
  }
  let best = baseOff, bestScore = -Infinity;
  for (const c of [baseOff, ...candidates]) {
    const { left, right } = _edges(lengthPx, cellPx, c);
    const score = Math.min(left === 0 ? cellPx : left, right === 0 ? cellPx : right);
    if (score > bestScore + EDGE_EPS) { bestScore = score; best = c; }
  }
  return best;
}

/**
 * Offset (app-px, in [0, cellPx)) van de eerste rasterlijn t.o.v. de
 * AABB-minzijde van één as: origin → equalize → randconditie.
 */
export function computeAxisOffset({ lengthPx, cellPx, originPx, equalize, params, minPx }) {
  if (!(cellPx > 0) || !(lengthPx > 0)) return 0;
  const base = equalize ? mod(lengthPx, cellPx) / 2 : mod(originPx || 0, cellPx);
  return _applyRandConditie(lengthPx, cellPx, base, params, minPx);
}

// ── clippen van rasterlijnen op de contour ─────────────────────────────────

// Even-odd punt-in-polygon (halfopen randregel — consistent met de
// kruisingstellingen hieronder). Gebruikt om tangentiële "segmenten" die
// exact óp de contourrand liggen (lijn samenvallend met een randlijn op de
// AABB-max-zijde) uit de clip-uitvoer te filteren.
function _pointInPoly(pts, x, y) {
  let inside = false;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    if ((p.y > y) !== (q.y > y)) {
      const xi = p.x + (y - p.y) * (q.x - p.x) / (q.y - p.y);
      if (x < xi) inside = !inside;
    }
  }
  return inside;
}

// Snijd de verticale lijn x=c met de contour → gesorteerde, gepaarde
// y-intervallen (even-odd, halfopen randregel zodat een hoekpunt op de lijn
// niet dubbel telt). Segmenten waarvan het midden niet echt BINNEN de
// contour ligt (lijn valt samen met een contourrand) worden weggefilterd.
export function clipVerticalLine(pts, c) {
  const ys = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    if ((p.x < c) !== (q.x < c)) {
      ys.push(p.y + (c - p.x) * (q.y - p.y) / (q.x - p.x));
    }
  }
  ys.sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i + 1 < ys.length; i += 2) {
    if (ys[i + 1] - ys[i] > EDGE_EPS
        && _pointInPoly(pts, c, (ys[i] + ys[i + 1]) / 2)) {
      segs.push({ a: ys[i], b: ys[i + 1] });
    }
  }
  return segs;
}

/** Als clipVerticalLine, maar voor de horizontale lijn y=c (x-intervallen). */
export function clipHorizontalLine(pts, c) {
  const xs = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    if ((p.y < c) !== (q.y < c)) {
      xs.push(p.x + (c - p.y) * (q.x - p.x) / (q.y - p.y));
    }
  }
  xs.sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > EDGE_EPS
        && _pointInPoly(pts, (xs[i] + xs[i + 1]) / 2, c)) {
      segs.push({ a: xs[i], b: xs[i + 1] });
    }
  }
  return segs;
}

/** AABB van een puntenlijst. */
function _aabb(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Bouw de volledige systeemraster-geometrie.
 *
 * @param {object} ann  Annotatie met points[] (contour) + rasterparameters.
 * @param {object} [opts]
 * @param {number} [opts.pxPerMm]  App-px per werkelijke mm op de positie van
 *        het raster (schaalgebied-bewust, uit systeemraster-scale.js).
 *        Ontbreekt (0/ongeldig) → vaste 1:100-omrekening.
 * @param {(text:string,size:number)=>number} [opts.measureText]
 * @returns {{
 *   params:object, pxPerMm:number, contour:Array<{x,y}>,
 *   contourAabb:{x,y,width,height}, cellW:number, cellH:number,
 *   linesV:Array<{x:number,segs:Array<{a:number,b:number}>}>,
 *   linesH:Array<{y:number,segs:Array<{a:number,b:number}>}>,
 *   origin:{x:number,y:number},
 *   randMm:{links:number,rechts:number,boven:number,onder:number},
 *   tag:{text,x,y,fontSize,width}|null,
 *   aabb:{x,y,width,height}
 * }|null}
 */
export function buildSysteemraster(ann, opts = {}) {
  const params = resolveSysteemrasterParams(ann);
  const contour = systeemrasterContour(ann);
  if (!contour) return null;
  const k = Number(opts.pxPerMm) > 0 ? Number(opts.pxPerMm) : PX_PER_MM_1_100;
  const box = _aabb(contour);
  const cellW = params.plaatBreedteMm * k;
  const cellH = params.plaatHoogteMm * k;
  const minPx = params.minRandMm * k;

  const offX = computeAxisOffset({
    lengthPx: box.width, cellPx: cellW, originPx: params.originXMm * k,
    equalize: params.equalizeX, params, minPx,
  });
  const offY = computeAxisOffset({
    lengthPx: box.height, cellPx: cellH, originPx: params.originYMm * k,
    equalize: params.equalizeY, params, minPx,
  });

  // Verticale rasterlijnen: x = aabb.x + offX + i·cellW binnen de AABB,
  // geclipt op de contour. Lijnen die (vrijwel) op de AABB-rand vallen
  // leveren via de clip vanzelf niets of alleen echte binnen-segmenten op.
  const linesV = [];
  for (let x = box.x + offX; x < box.x + box.width + EDGE_EPS; x += cellW) {
    const segs = clipVerticalLine(contour, x);
    if (segs.length > 0) linesV.push({ x, segs });
    if (!(cellW > EDGE_EPS)) break;
  }
  const linesH = [];
  for (let y = box.y + offY; y < box.y + box.height + EDGE_EPS; y += cellH) {
    const segs = clipHorizontalLine(contour, y);
    if (segs.length > 0) linesH.push({ y, segs });
    if (!(cellH > EDGE_EPS)) break;
  }

  // Randstukken per zijde (mm; 0 = geen randstuk / volle plaat op de rand).
  const ex = _edges(box.width, cellW, offX);
  const ey = _edges(box.height, cellH, offY);
  const randMm = {
    links: ex.left / k,
    rechts: ex.right / k,
    boven: ey.left / k,
    onder: ey.right / k,
  };

  // Oorsprong: AABB-min + offsets. De GRIP ligt op de eerste rasterkruising
  // BINNEN de contour-AABB: valt een offset (vrijwel) op de rand, dan schuift
  // de grip één cel naar binnen zodat hij nooit samenvalt met een
  // contour-nodehandle (die zou de sleep anders wegkapen).
  const origin = { x: box.x + offX, y: box.y + offY };
  const originGrip = {
    x: origin.x + (offX < EDGE_EPS && cellW < box.width ? cellW : 0),
    y: origin.y + (offY < EDGE_EPS && cellH < box.height ? cellH : 0),
  };

  // Tag: plaatmaat "B×H" naast de oorsprong (inline bewerkbaar bij selectie).
  let tag = null;
  if (params.tagTonen) {
    const measure = typeof opts.measureText === 'function' ? opts.measureText : approxTextWidth;
    const text = systeemrasterTagTekst(params);
    tag = {
      text,
      x: origin.x + params.tagFontSize * 0.5,
      y: origin.y - params.tagFontSize * 0.5,
      fontSize: params.tagFontSize,
      width: measure(text, params.tagFontSize),
    };
  }

  // Volledige AABB (contour ∪ tagvak) — wordt de /Rect bij het opslaan.
  let aabb = { ...box };
  if (tag) {
    const tMinX = tag.x, tMaxX = tag.x + tag.width;
    const tMinY = tag.y - tag.fontSize, tMaxY = tag.y + tag.fontSize * 0.3;
    const minX = Math.min(aabb.x, tMinX);
    const minY = Math.min(aabb.y, tMinY);
    const maxX = Math.max(aabb.x + aabb.width, tMaxX);
    const maxY = Math.max(aabb.y + aabb.height, tMaxY);
    aabb = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  return {
    params,
    pxPerMm: k,
    contour,
    contourAabb: box,
    cellW,
    cellH,
    linesV,
    linesH,
    origin,
    originGrip,
    randMm,
    tag,
    aabb,
  };
}
