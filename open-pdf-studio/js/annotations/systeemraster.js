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

// ── Systeem (v1: systeemplafond) ───────────────────────────────────────────
// De annotatie kan naast de rasterparameters een `system`-object dragen:
//   ann.system = { type:'plafond', layers:[{ panels:{ "ix,iy":type }, edge:{ profiel } }] }
// v1 gebruikt uitsluitend layers[0]; de array is er alvast voor gelaagde
// systemen. `panels` bevat ALLEEN overrides (default 'tegel' wordt nooit
// opgeslagen); `edge.profiel` is het randprofiel langs de contour.

/** Randprofielen (edge conditions) van een systeem. */
export const SYSTEEM_EDGE_PROFIELEN = ['geen', 'hoeklijn', 'schaduwvoeg'];

/** Ingebouwde render-stijlen voor panelen. Paneeltype-ID's zijn DATA op het
 *  systeemtype (typeDef.paneelTypen: {id,naam,renderStijl}); deze drie zijn
 *  de ingebouwde stijlen én de terugval-id's voor typen zonder assortiment. */
export const SYSTEEM_PANEEL_TYPES = ['tegel', 'ventilatie', 'licht'];

/** Een paneel-override is óf een paneeltype-id (string), óf een verwijzing
 *  naar een COMPONENT uit de symbolenbibliotheek: {soort:'component',
 *  symbolId, naam?}. Genormaliseerd of null (ongeldig/default). */
export function normalizePaneelOverride(v) {
  if (typeof v === 'string') {
    return v && v !== 'tegel' ? v : null;
  }
  if (v && typeof v === 'object' && v.soort === 'component'
      && typeof v.symbolId === 'string' && v.symbolId) {
    const out = { soort: 'component', symbolId: v.symbolId };
    if (typeof v.naam === 'string' && v.naam) out.naam = v.naam;
    return out;
  }
  return null;
}

/** Inzet (werkelijke mm) van de schaduwvoeg-lijn t.o.v. de contour. */
export const SYSTEEM_SCHADUWVOEG_INSET_MM = 25;

/** Afstand (mm) van de pas-markering (dunne dubbele lijn) tot de paszijde
 *  van een passtrook in de strook-layout. */
export const SYSTEEM_PAS_OFFSET_MM = 80;

/** Raveelsymbool: offset (mm) tussen de dubbele lijnen en de steek van de
 *  korte dwarsstreepjes. */
export const SYSTEEM_RAVEEL_OFFSET_MM = 40;
export const SYSTEEM_RAVEEL_STREEP_MM = 200;

/** Default-sparingsregels (worden normaal door het systeemtype geleverd). */
export const SYSTEEM_SPARING_REGELS_DEFAULT = {
  kleineSparingMaxMm: 400,
  raveelVanafMm: 800,
};

// ── sparingen ──────────────────────────────────────────────────────────────
// Een SPARING is instantie-data: een rechthoekig gat in het systeem.
// Positie = linksboven t.o.v. de RASTERRUIMTE-AABB-min van de contour, in
// werkelijke mm (translatie-invariant: verhuist mee met de contour; draait
// mee met de rasterhoek). Opslag: ann.sparingen = [{id,xMm,yMm,bMm,hMm}].

/** Genormaliseerde sparing of null. */
export function normaliseSparing(s) {
  if (!s || typeof s !== 'object') return null;
  const x = Number(s.xMm), y = Number(s.yMm);
  const b = Number(s.bMm), h = Number(s.hMm);
  if (![x, y, b, h].every(Number.isFinite) || !(b > 0) || !(h > 0)) return null;
  return {
    id: typeof s.id === 'string' && s.id ? s.id : `sp-${Math.random().toString(36).slice(2, 9)}`,
    xMm: x, yMm: y, bMm: b, hMm: h,
  };
}

/** Gevalideerde sparingen van een annotatie (nooit null). */
export function systeemSparingen(ann) {
  const out = [];
  for (const s of (ann && ann.sparingen) || []) {
    const n = normaliseSparing(s);
    if (n) out.push(n);
  }
  return out;
}

/** Voeg een sparing toe (muteert ann.sparingen); geeft de sparing terug. */
export function addSparing(ann, sp) {
  const n = normaliseSparing({ ...sp, id: sp && sp.id });
  if (!ann || !n) return null;
  ann.sparingen = [...systeemSparingen(ann), n];
  return n;
}

/** Verwijder een sparing op id (muteert ann.sparingen). */
export function removeSparing(ann, id) {
  if (!ann) return;
  ann.sparingen = systeemSparingen(ann).filter(s => s.id !== id);
}

/** Werk een sparing bij (muteert ann.sparingen). */
export function updateSparing(ann, id, patch) {
  if (!ann) return;
  ann.sparingen = systeemSparingen(ann).map(s =>
    s.id === id ? (normaliseSparing({ ...s, ...patch, id }) || s) : s);
}

/**
 * Sparingsregime op basis van de GROOTSTE zijde en de regels van het type:
 * 'klein' (t/m kleineSparingMaxMm: gewoon gat), 'raveel' (vanaf
 * raveelVanafMm — alléén zinvol in de strook-layout; bij raster degradeert
 * de aanroeper naar 'verzwaard'), anders 'verzwaard' (gat met verzwaarde
 * randlijn). Grenswaarden horen bij de buitenste regimes (≤ resp. ≥).
 */
export function sparingRegime(bMm, hMm, regels, layout) {
  const r = regels || SYSTEEM_SPARING_REGELS_DEFAULT;
  const maat = Math.max(Number(bMm) || 0, Number(hMm) || 0);
  if (maat <= r.kleineSparingMaxMm) return 'klein';
  if (maat >= r.raveelVanafMm) {
    return layout === 'strook' ? 'raveel' : 'verzwaard';
  }
  return 'verzwaard';
}

/** Sparingen → JSON (persistentie) en terug (gevalideerd). */
export function sparingenToJson(ann) {
  const list = systeemSparingen(ann);
  return list.length > 0 ? JSON.stringify(list) : null;
}
export function sparingenFromJson(json) {
  if (typeof json !== 'string' || !json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(normaliseSparing).filter(Boolean) : [];
  } catch (_) { return []; }
}

// Trek het interval [a,b] van een lijst gesorteerde segmenten af — voor
// rasterlijnen/naden die op een sparingsrand moeten stoppen.
export function subtractInterval(segs, a, b) {
  const out = [];
  for (const s of segs) {
    if (b <= s.a + EDGE_EPS || a >= s.b - EDGE_EPS) { out.push(s); continue; }
    if (a > s.a + EDGE_EPS) out.push({ a: s.a, b: Math.min(a, s.b) });
    if (b < s.b - EDGE_EPS) out.push({ a: Math.max(b, s.a), b: s.b });
  }
  return out;
}

/** Veiligheidsplafond op het aantal doorgerekende panelen per systeem. */
export const SYSTEEM_MAX_PANELEN = 20000;

/** Sleutel van een paneel-override: celindex t.o.v. de rasteroorsprong. */
export function paneelKey(ix, iy) {
  return `${ix},${iy}`;
}

/** Genormaliseerd systeem-object (puur; muteert niets). Overrides worden
 *  gevalideerd: kapotte sleutels/waarden vallen weg.
 *  - panels: celindex → paneeltype-id (string, assortiment = data op het
 *    systeemtype) of component-verwijzing {soort:'component', symbolId};
 *  - edges: contoursegment-index → randprofiel-override per SEGMENT. */
export function resolveSysteem(ann) {
  const sys = (ann && ann.system) || {};
  const layer0 = (Array.isArray(sys.layers) && sys.layers[0]) || {};
  const panels = {};
  const raw = layer0.panels;
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (!/^-?\d+,-?\d+$/.test(k)) continue;
      const norm = normalizePaneelOverride(v);
      if (norm) panels[k] = norm;
    }
  }
  const edges = {};
  const rawE = layer0.edges;
  if (rawE && typeof rawE === 'object') {
    for (const [k, v] of Object.entries(rawE)) {
      if (/^\d+$/.test(k) && SYSTEEM_EDGE_PROFIELEN.includes(v)) edges[k] = v;
    }
  }
  const profiel = SYSTEEM_EDGE_PROFIELEN.includes(layer0.edge && layer0.edge.profiel)
    ? layer0.edge.profiel : 'geen';
  return {
    type: sys.type === 'plafond' ? 'plafond' : 'raster',
    layers: [{ panels, edges, edge: { profiel } }],
  };
}

/** Zet het paneeltype (paneeltype-id) van cel (ix,iy) op de annotatie
 *  (muteert ann.system; 'tegel' verwijdert de override — dat is meteen de
 *  Delete-reset). Elk niet-leeg id is geldig: het assortiment is data op
 *  het systeemtype (typeDef.paneelTypen). */
export function setPaneelType(ann, ix, iy, type) {
  if (!ann || typeof type !== 'string' || !type) return;
  const sys = resolveSysteem(ann);
  const key = paneelKey(ix, iy);
  if (type === 'tegel') delete sys.layers[0].panels[key];
  else sys.layers[0].panels[key] = type;
  ann.system = sys;
}

/** Vervang het paneel in cel (ix,iy) door een COMPONENT uit de
 *  symbolenbibliotheek (muteert ann.system). Het component hoort bij het
 *  systeem: het reist mee met contour, oorsprong en rasterhoek en
 *  round-tript via dezelfde paneel-overrides. */
export function setPaneelComponent(ann, ix, iy, symbolId, naam) {
  const norm = normalizePaneelOverride({ soort: 'component', symbolId, naam });
  if (!ann || !norm) return;
  const sys = resolveSysteem(ann);
  sys.layers[0].panels[paneelKey(ix, iy)] = norm;
  ann.system = sys;
}

/** Zet (of wis, met null/'' ) de randprofiel-override van contoursegment
 *  `seg` op de annotatie (muteert ann.system). 'geen' is een geldige
 *  override: dat segment krijgt dan géén randprofiel. */
export function setRandProfiel(ann, seg, profiel) {
  if (!ann || !Number.isInteger(seg) || seg < 0) return;
  const sys = resolveSysteem(ann);
  if (profiel == null || profiel === '') {
    delete sys.layers[0].edges[String(seg)];
  } else if (SYSTEEM_EDGE_PROFIELEN.includes(profiel)) {
    sys.layers[0].edges[String(seg)] = profiel;
  } else {
    return;
  }
  ann.system = sys;
}

/** Zet het randprofiel van het systeem (muteert ann.system). */
export function setEdgeProfiel(ann, profiel) {
  if (!ann || !SYSTEEM_EDGE_PROFIELEN.includes(profiel)) return;
  const sys = resolveSysteem(ann);
  sys.layers[0].edge.profiel = profiel;
  ann.system = sys;
}

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

/** Geldige contourpunten van de annotatie (≥ 3, opeenvolgende dubbelen weg).
 *  Behoudt per punt de boogvlag/bulge (zelfde conventie als filledArea:
 *  `arc` op punt j betekent dat het segment van punt j-1 NAAR punt j een
 *  boog is; de vlag op punt 0 hoort bij het sluitsegment laatste→eerste). */
export function systeemrasterContour(ann) {
  const out = [];
  for (const p of (ann && ann.points) || []) {
    const x = Number(p && p.x), y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.hypot(x - prev.x, y - prev.y) < 1e-9) continue;
    const node = { x, y };
    if (p.arc === true) {
      node.arc = true;
      node.bulge = Number.isFinite(Number(p.bulge)) ? Number(p.bulge) : 0.3;
    }
    out.push(node);
  }
  // Gesloten aangeleverde contour (laatste == eerste): sluitpunt weglaten.
  if (out.length >= 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-9) out.pop();
  }
  return out.length >= 3 ? out : null;
}

// ── boogsegmenten ──────────────────────────────────────────────────────────
// Zelfde wiskunde als arcControlPoint()/expandArcPoints() in
// annotations/measurement.js (kwadratische Bézier met controlepunt loodrecht
// op de koorde, offset = bulge × koordelengte) — hier lokaal herhaald zodat
// deze module puur blijft (measurement.js hangt aan app-state).

/** Controlepunt van het boogsegment prev→cur (bulge op cur). */
export function arcControl(prev, cur) {
  const bulge = Number.isFinite(Number(cur.bulge)) ? Number(cur.bulge) : 0.3;
  const mx = (prev.x + cur.x) / 2, my = (prev.y + cur.y) / 2;
  const dx = cur.x - prev.x, dy = cur.y - prev.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: mx + (-dy / dist) * bulge * dist, y: my + (dx / dist) * bulge * dist };
}

/** Punt op het segment s (nodes[s]→nodes[s+1], boogdata op het EINDpunt)
 *  bij parameter t — voor grips en flattening. */
export function segmentPoint(nodes, s, t) {
  const n = nodes.length;
  const a = nodes[s], b = nodes[(s + 1) % n];
  if (b.arc === true) {
    const cp = arcControl(a, b);
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * cp.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * cp.y + t * t * b.y,
    };
  }
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Aantal flatten-stappen per boogsegment. */
export const ARC_FLATTEN_STEPS = 16;

/** Contour-nodes → vlakke polygoon (bogen uitgeslagen naar rechte stukjes)
 *  PLUS de afbeelding vlak-punt → contoursegment: segOf[i] is de index van
 *  het NODE-segment waar het sub-randje vanaf pts[i] bij hoort. Daarmee
 *  kunnen randprofiel-overrides en de rand-hittest per SEGMENT werken. */
export function flattenContourMap(nodes) {
  const pts = [];
  const segOf = [];
  if (!nodes || nodes.length < 3) return { pts, segOf };
  const n = nodes.length;
  for (let s = 0; s < n; s++) {
    const b = nodes[(s + 1) % n];
    if (b.arc === true) {
      for (let i = 0; i < ARC_FLATTEN_STEPS; i++) {
        pts.push(segmentPoint(nodes, s, i / ARC_FLATTEN_STEPS));
        segOf.push(s);
      }
    } else {
      pts.push({ x: nodes[s].x, y: nodes[s].y });
      segOf.push(s);
    }
  }
  return { pts, segOf };
}

/** Alleen de vlakke polygoon (compat-vorm van flattenContourMap). */
export function flattenContour(nodes) {
  return flattenContourMap(nodes).pts;
}

/** Vlakke (uitgeslagen) contour van de annotatie — voor hit-tests. */
export function systeemrasterFlatContour(ann) {
  const nodes = systeemrasterContour(ann);
  return nodes ? flattenContour(nodes) : null;
}

/** Puntkopie op een nieuwe positie die de boogvelden (arc/bulge) BEHOUDT —
 *  voor node-sleep: een hoekpunt verslepen mag de boog van de aangrenzende
 *  segmenten niet wissen (de boog vervormt gewoon mee met de nieuwe koorde). */
export function copyPointKeepArc(p, nx, ny) {
  return p && p.arc === true
    ? { x: nx, y: ny, arc: true, bulge: p.bulge }
    : { x: nx, y: ny };
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

/** Punt-in-contour (even-odd) op de vlakke polygoon — publiek voor tests. */
export function pointInContour(flatPts, x, y) {
  return _pointInPoly(flatPts, x, y);
}

// ── panelen ────────────────────────────────────────────────────────────────

// Classificeer één cel-rechthoek t.o.v. de contour via 9 monsterpunten
// (hoeken, zijmiddens, centrum), iets naar binnen gezet zodat een cel die
// exact op de contourrand eindigt niet op randruis kiept.
// → 'vol' (alle punten binnen), 'rand' (deels), null (buiten).
function _classifyCell(flatPts, x0, y0, w, h) {
  const d = Math.min(w, h) * 1e-3;
  const xs = [x0 + d, x0 + w / 2, x0 + w - d];
  const ys = [y0 + d, y0 + h / 2, y0 + h - d];
  let inside = 0;
  for (const sx of xs) {
    for (const sy of ys) {
      if (_pointInPoly(flatPts, sx, sy)) inside++;
    }
  }
  if (inside === 9) return 'vol';
  return inside > 0 ? 'rand' : null;
}

/** Render-stijl van een paneeltype-id: eerst het assortiment van het
 *  systeemtype (typeDef.paneelTypen), dan de ingebouwde stijlen, anders
 *  'tegel' (onbekend id degradeert stil). Puur. */
export function paneelStijlVoor(typeId, typeDef) {
  if (typeDef && Array.isArray(typeDef.paneelTypen)) {
    const pt = typeDef.paneelTypen.find(p => p && p.id === typeId);
    if (pt && SYSTEEM_PANEEL_TYPES.includes(pt.renderStijl)) return pt.renderStijl;
  }
  return SYSTEEM_PANEEL_TYPES.includes(typeId) ? typeId : 'tegel';
}

// Alle panelen (cellen die de contour raken) met celindex t.o.v. de
// rasteroorsprong. Overrides uit het systeem bepalen het type:
// paneeltype-id (→ stijl via het assortiment) of component-in-cel.
function _buildPanels(flatPts, box, origin, cellW, cellH, overrides, typeDef) {
  const panels = [];
  if (!(cellW > EDGE_EPS) || !(cellH > EDGE_EPS)) return panels;
  const ixFrom = origin.x - box.x > EDGE_EPS ? -1 : 0;
  const iyFrom = origin.y - box.y > EDGE_EPS ? -1 : 0;
  const nx = Math.ceil((box.x + box.width - origin.x) / cellW - EDGE_EPS);
  const ny = Math.ceil((box.y + box.height - origin.y) / cellH - EDGE_EPS);
  if ((nx - ixFrom) * (ny - iyFrom) > SYSTEEM_MAX_PANELEN) return panels;
  for (let iy = iyFrom; iy < ny; iy++) {
    for (let ix = ixFrom; ix < nx; ix++) {
      const x0 = origin.x + ix * cellW;
      const y0 = origin.y + iy * cellH;
      const klasse = _classifyCell(flatPts, x0, y0, cellW, cellH);
      if (!klasse) continue;
      const ov = overrides[paneelKey(ix, iy)] || null;
      const isComp = ov && typeof ov === 'object';
      panels.push({
        ix, iy, x: x0, y: y0, w: cellW, h: cellH,
        rand: klasse === 'rand',
        // `type` = paneeltype-id ('tegel' default) of 'component';
        // `stijl` = ingebouwde render-stijl; `component` = symboolinfo.
        type: isComp ? 'component' : (ov || 'tegel'),
        stijl: isComp ? 'tegel' : paneelStijlVoor(ov || 'tegel', typeDef),
        component: isComp ? ov : null,
      });
    }
  }
  return panels;
}

// ── rasterrotatie ──────────────────────────────────────────────────────────
// De rasterhoek draait het RASTER (cellen, lijnen, panelen) om het midden
// van de contour-AABB; de contour zelf blijft in wereldruimte. Alle
// rasterwiskunde (offsets, clipping, paneel-classificatie) gebeurt in de
// RASTERRUIMTE: wereld → raster = rotatie om de pivot met -hoek.

/** Rotatiecontext voor een hoek (graden) om een pivot, of null bij ~0°. */
export function rotFor(deg, pivot) {
  const d = Number(deg) || 0;
  const norm = ((d % 360) + 360) % 360;
  if (norm < 1e-9 || 360 - norm < 1e-9) return null;
  const rad = norm * Math.PI / 180;
  return { deg: norm, rad, cos: Math.cos(rad), sin: Math.sin(rad), pivot };
}

/** Rasterruimte → wereld (rotatie +hoek om de pivot). */
export function rotToWorld(rot, p) {
  if (!rot) return { x: p.x, y: p.y };
  const dx = p.x - rot.pivot.x, dy = p.y - rot.pivot.y;
  return {
    x: rot.pivot.x + dx * rot.cos - dy * rot.sin,
    y: rot.pivot.y + dx * rot.sin + dy * rot.cos,
  };
}

/** Wereld → rasterruimte (rotatie -hoek om de pivot). */
export function rotToRaster(rot, p) {
  if (!rot) return { x: p.x, y: p.y };
  const dx = p.x - rot.pivot.x, dy = p.y - rot.pivot.y;
  return {
    x: rot.pivot.x + dx * rot.cos + dy * rot.sin,
    y: rot.pivot.y - dx * rot.sin + dy * rot.cos,
  };
}

/** Paneel (celindex) op WERELD-positie (x,y) binnen de geometrie, of null.
 *  Rasterhoek-bewust: het punt wordt eerst naar de rasterruimte gebracht. */
export function paneelAt(geom, x, y) {
  if (!geom || !geom.panels) return null;
  const q = rotToRaster(geom.rot, { x, y });
  for (const p of geom.panels) {
    if (q.x >= p.x && q.x < p.x + p.w && q.y >= p.y && q.y < p.y + p.h) {
      return { ix: p.ix, iy: p.iy };
    }
  }
  return null;
}

// Afstand punt→lijnstuk (app-px).
function _distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * SUB-ELEMENT op WERELD-positie (x,y): het onderdeel dat een "tweede klik"
 * binnen een geselecteerd systeem zou pakken. Prioriteit bij overlap:
 * RAND (contoursegment) vóór SPARING vóór RASTERLIJN vóór PANEEL/STROOK.
 * @returns {{kind:'rand',seg,profiel,lengthMm}
 *         |{kind:'sparing',id,index,xMm,yMm,bMm,hMm,regime}
 *         |{kind:'lijn',as:'v'|'h',index,posMm}
 *         |{kind:'paneel',ix,iy}
 *         |{kind:'strook',index,breedteMm,lengteMm,posMm,pas}|null}
 */
export function subElementAt(geom, x, y, tol = 4) {
  if (!geom) return null;
  // 1) Rand: afstand tot de (wereld-)contoursegmenten.
  for (const es of geom.edgeSegs || []) {
    for (let i = 0; i + 1 < es.pts.length; i++) {
      if (_distToSeg(x, y, es.pts[i].x, es.pts[i].y,
        es.pts[i + 1].x, es.pts[i + 1].y) <= tol) {
        return { kind: 'rand', seg: es.seg, profiel: es.profiel, lengthMm: es.lengthMm };
      }
    }
  }
  const q = rotToRaster(geom.rot, { x, y });
  const k = geom.pxPerMm || PX_PER_MM_1_100;
  // 2) Sparing (rasterruimte-rechthoek).
  for (const sp of geom.sparingen || []) {
    if (q.x >= sp.x - tol && q.x <= sp.x + sp.w + tol
        && q.y >= sp.y - tol && q.y <= sp.y + sp.h + tol) {
      return {
        kind: 'sparing', id: sp.id, index: sp.index,
        xMm: sp.xMm, yMm: sp.yMm, bMm: sp.bMm, hMm: sp.hMm,
        regime: sp.regime,
      };
    }
  }
  // 3) Rasterlijn: in de RASTERRUIMTE (hoek-bewust); index t.o.v. de
  //    oorsprong, positie in werkelijke mm vanaf de oorsprong.
  for (const l of geom.linesV || []) {
    if (Math.abs(q.x - l.x) <= tol
        && l.segs.some(s => q.y >= s.a - tol && q.y <= s.b + tol)) {
      return {
        kind: 'lijn', as: 'v',
        index: Math.round((l.x - geom.origin.x) / geom.cellW),
        posMm: (l.x - geom.origin.x) / k,
      };
    }
  }
  for (const l of geom.linesH || []) {
    if (Math.abs(q.y - l.y) <= tol
        && l.segs.some(s => q.x >= s.a - tol && q.x <= s.b + tol)) {
      return {
        kind: 'lijn', as: 'h',
        index: Math.round((l.y - geom.origin.y) / geom.cellH),
        posMm: (l.y - geom.origin.y) / k,
      };
    }
  }
  // 4) Paneel (raster-layout) of strook (strook-layout).
  if (geom.layout === 'strook') {
    for (const st of geom.stroken || []) {
      if (q.x >= st.x0 && q.x < st.x1
          && _pointInPoly(geom.contourR || geom.contour, q.x, q.y)) {
        return {
          kind: 'strook', index: st.index,
          breedteMm: st.breedteMm, lengteMm: st.lengteMm, posMm: st.posMm,
          pas: st.pas === true,
        };
      }
    }
    return null;
  }
  const cel = paneelAt(geom, x, y);
  return cel ? { kind: 'paneel', ix: cel.ix, iy: cel.iy } : null;
}

// ── randprofiel (schaduwvoeg-inzet) ────────────────────────────────────────

// Naïeve miter-inzet van een gesloten polygoon: elke rand schuift `d` naar
// binnen (binnenzijde via het teken van de oppervlakte), hoekpunten als
// snijpunt van de aangrenzende verschoven randen. Bij (bijna) parallelle
// randen valt hij terug op punt + normaal. Goed genoeg voor de dunne
// schaduwvoeg-lijn; géén zelfsnijdings-opruiming (v1).
export function insetPolygon(pts, d) {
  const n = pts.length;
  if (n < 3 || !(d > 0)) return pts;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    area2 += p.x * q.y - q.x * p.y;
  }
  const sign = area2 >= 0 ? 1 : -1; // binnen-normaal van rand (dx,dy): sign·(-dy,dx)
  const off = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = sign * (-dy / len) * d, ny = sign * (dx / len) * d;
    off.push({ ax: p.x + nx, ay: p.y + ny, bx: q.x + nx, by: q.y + ny });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const e1 = off[(i - 1 + n) % n], e2 = off[i];
    const d1x = e1.bx - e1.ax, d1y = e1.by - e1.ay;
    const d2x = e2.bx - e2.ax, d2y = e2.by - e2.ay;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-9) {
      out.push({ x: e2.ax, y: e2.ay });
    } else {
      const t = ((e2.ax - e1.ax) * d2y - (e2.ay - e1.ay) * d2x) / den;
      out.push({ x: e1.ax + t * d1x, y: e1.ay + t * d1y });
    }
  }
  return out;
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
  // SYSTEEMTYPE (opts.typeDef, geresolved door systeemrasterBuildOpts uit de
  // registry): de TYPE-definitie levert celmaat en randprofiel; de annotatie
  // (instance) draagt alleen contour, oorsprong, rasterhoek en overrides.
  // Zonder typeDef (legacy raster) gelden de vlakke instance-velden.
  const typeDef = opts.typeDef || null;
  const params = resolveSysteemrasterParams(typeDef
    ? { ...ann, plaatBreedteMm: typeDef.celXMm, plaatHoogteMm: typeDef.celYMm }
    : ann);
  const nodes = systeemrasterContour(ann);
  if (!nodes) return null;
  // Alle veld-geometrie (AABB, clipping, panelen) rekent op de VLAKKE
  // contour; `nodes` (met boogdata) blijft beschikbaar voor de grips en
  // `segOf` koppelt elk vlak sub-randje aan zijn contoursegment.
  const flatMap = flattenContourMap(nodes);
  const contour = flatMap.pts;
  const segOf = flatMap.segOf;
  const systeem = resolveSysteem(ann);
  const k = Number(opts.pxPerMm) > 0 ? Number(opts.pxPerMm) : PX_PER_MM_1_100;
  // Rasterrotatie: raster in RASTERRUIMTE rekenen (contour met -hoek om het
  // AABB-midden gedraaid), uitkomsten bij het tekenen met +hoek terug.
  const worldBox = _aabb(contour);
  const rot = rotFor(params.rasterHoek, {
    x: worldBox.x + worldBox.width / 2,
    y: worldBox.y + worldBox.height / 2,
  });
  const contourR = rot ? contour.map(p => rotToRaster(rot, p)) : contour;
  const box = _aabb(contourR);
  // LAYOUT-VORM (data op het type): 'raster' = cellen in twee richtingen;
  // 'strook' = stroken van strookBreedteMm die in de raster-Y-richting (de
  // overspanning, gedraaid door de rasterhoek) over de volle lengte lopen —
  // alleen langsnaden, geen dwarsnaden.
  const layout = typeDef && typeDef.layout === 'strook' ? 'strook' : 'raster';
  const cellW = (layout === 'strook' && typeDef
    ? typeDef.strookBreedteMm : params.plaatBreedteMm) * k;
  const cellH = params.plaatHoogteMm * k;
  const minPx = params.minRandMm * k;

  // SPARINGEN (instantie-data, rasterruimte): positie in mm t.o.v. de
  // raster-AABB-min; regime volgens de sparingsregels van het type.
  const sparingRegels = (typeDef && typeDef.sparingRegels)
    || SYSTEEM_SPARING_REGELS_DEFAULT;
  const sparingen = systeemSparingen(ann).map((s, i) => ({
    ...s,
    index: i,
    x: box.x + s.xMm * k,
    y: box.y + s.yMm * k,
    w: s.bMm * k,
    h: s.hMm * k,
    regime: sparingRegime(s.bMm, s.hMm, sparingRegels, layout),
  }));
  // Rasterlijnen/naden stoppen op de sparingsranden.
  const knipSparingenV = (x, segs) => {
    let out = segs;
    for (const sp of sparingen) {
      if (x > sp.x - EDGE_EPS && x < sp.x + sp.w + EDGE_EPS) {
        out = subtractInterval(out, sp.y, sp.y + sp.h);
      }
    }
    return out;
  };
  const knipSparingenH = (y, segs) => {
    let out = segs;
    for (const sp of sparingen) {
      if (y > sp.y - EDGE_EPS && y < sp.y + sp.h + EDGE_EPS) {
        out = subtractInterval(out, sp.x, sp.x + sp.w);
      }
    }
    return out;
  };

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
  // In RASTERRUIMTE (contourR): bij hoek 0 is dat identiek aan de wereld.
  // Sparingen knippen gaten in de lijnen (naden stoppen op de sparingsrand).
  const linesV = [];
  for (let x = box.x + offX; x < box.x + box.width + EDGE_EPS; x += cellW) {
    const segs = knipSparingenV(x, clipVerticalLine(contourR, x));
    if (segs.length > 0) linesV.push({ x, segs });
    if (!(cellW > EDGE_EPS)) break;
  }
  // Dwarslijnen alleen in de raster-layout; een strook loopt over de volle
  // overspanning (geen dwarsnaden).
  const linesH = [];
  if (layout === 'raster') {
    for (let y = box.y + offY; y < box.y + box.height + EDGE_EPS; y += cellH) {
      const segs = knipSparingenH(y, clipHorizontalLine(contourR, y));
      if (segs.length > 0) linesH.push({ y, segs });
      if (!(cellH > EDGE_EPS)) break;
    }
  }

  // STROKEN (strook-layout): kolommen van cellW breed; randstroken die door
  // de contour-AABB versmald worden zijn PASSTROKEN (pas = true) en krijgen
  // een dunne dubbele lijn aan de paszijde (pasLijnen). De lengte is de
  // som van de contoursegmenten op de strookas.
  const stroken = [];
  const pasLijnen = [];
  if (layout === 'strook' && cellW > EDGE_EPS) {
    const iFrom = offX > EDGE_EPS ? -1 : 0;
    const nCols = Math.ceil((box.width - offX) / cellW - EDGE_EPS);
    for (let i = iFrom; i < nCols; i++) {
      const x0 = box.x + offX + i * cellW;
      const bx0 = Math.max(x0, box.x);
      const bx1 = Math.min(x0 + cellW, box.x + box.width);
      if (bx1 - bx0 <= EDGE_EPS) continue;
      const midSegs = clipVerticalLine(contourR, (bx0 + bx1) / 2);
      if (midSegs.length === 0) continue;
      let lenPx = 0;
      for (const s of midSegs) lenPx += s.b - s.a;
      const pas = bx1 - bx0 < cellW - EDGE_EPS;
      stroken.push({
        index: i,
        x0: bx0,
        x1: bx1,
        breedteMm: (bx1 - bx0) / k,
        lengteMm: lenPx / k,
        posMm: (bx0 - box.x) / k,
        pas,
      });
      if (pas) {
        // Paszijde = de kant die door de AABB is afgesneden.
        const buitenLinks = x0 < box.x - EDGE_EPS;
        const px = buitenLinks
          ? bx0 + SYSTEEM_PAS_OFFSET_MM * k
          : bx1 - SYSTEEM_PAS_OFFSET_MM * k;
        if (px > bx0 + EDGE_EPS && px < bx1 - EDGE_EPS) {
          const segs = knipSparingenV(px, clipVerticalLine(contourR, px));
          if (segs.length > 0) pasLijnen.push({ x: px, segs });
        }
      }
    }
  }

  // RAVEELS (strook-layout, regime 'raveel'): aan boven- en onderzijde van
  // de sparing, haaks op de overspanningsrichting, doorlopend tot de
  // eerstvolgende strooknaad aan weerszijden.
  const raveels = [];
  if (layout === 'strook') {
    const naden = linesV.map(l => l.x);
    for (const sp of sparingen) {
      if (sp.regime !== 'raveel') continue;
      let x1 = box.x, x2 = box.x + box.width;
      for (const nx of naden) {
        if (nx <= sp.x + EDGE_EPS && nx > x1) x1 = nx;
        if (nx >= sp.x + sp.w - EDGE_EPS && nx < x2) x2 = nx;
      }
      raveels.push({ y: sp.y, x1, x2, sparingId: sp.id });
      raveels.push({ y: sp.y + sp.h, x1, x2, sparingId: sp.id });
    }
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
  // `origin` is de rasterruimte-oorsprong; de grips leven in WERELD-coords.
  const origin = { x: box.x + offX, y: box.y + offY };
  const originGripR = {
    x: origin.x + (offX < EDGE_EPS && cellW < box.width ? cellW : 0),
    y: origin.y + (offY < EDGE_EPS && cellH < box.height ? cellH : 0),
  };
  const originWorld = rotToWorld(rot, origin);
  const originGrip = rotToWorld(rot, originGripR);
  // Hoekgrip: op de (gedraaide) raster-x-as, ruim voorbij de origin-grip —
  // slepen zet de rasterhoek (zie transforms.js).
  const hoekGrip = rotToWorld(rot, {
    x: originGripR.x + Math.min(cellW * 1.5, box.width),
    y: originGripR.y,
  });

  // Tag: plaatmaat "B×H" naast de oorsprong (inline bewerkbaar bij
  // selectie) — horizontaal in wereldruimte, verankerd aan de gedraaide
  // oorsprong.
  let tag = null;
  if (params.tagTonen) {
    const measure = typeof opts.measureText === 'function' ? opts.measureText : approxTextWidth;
    const text = systeemrasterTagTekst(params);
    tag = {
      text,
      x: originWorld.x + params.tagFontSize * 0.5,
      y: originWorld.y - params.tagFontSize * 0.5,
      fontSize: params.tagFontSize,
      width: measure(text, params.tagFontSize),
    };
  }

  // Volledige AABB (contour ∪ tagvak) in WERELDRUIMTE — de /Rect.
  let aabb = { ...worldBox };
  if (tag) {
    const tMinX = tag.x, tMaxX = tag.x + tag.width;
    const tMinY = tag.y - tag.fontSize, tMaxY = tag.y + tag.fontSize * 0.3;
    const minX = Math.min(aabb.x, tMinX);
    const minY = Math.min(aabb.y, tMinY);
    const maxX = Math.max(aabb.x + aabb.width, tMaxX);
    const maxY = Math.max(aabb.y + aabb.height, tMaxY);
    aabb = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  // Panelen: elke cel die (deels) binnen de contour valt, met type-override
  // uit het systeem. Randpanelen (gesneden door de contour) krijgen rand:true
  // en worden bij het tekenen op de contour geclipt.
  // Panelen alleen in de raster-layout; de strook-layout heeft STROKEN.
  const panels = layout === 'raster'
    ? _buildPanels(contourR, box, origin, cellW, cellH,
      systeem.layers[0].panels, typeDef)
    : [];

  // Randprofiel: het TYPE schrijft de basis voor (generiek systeem); zonder
  // type geldt het instance-niveau (legacy). Per contoursegment kan de
  // instantie de basis overschrijven (edges-overrides, incl. 'geen').
  const edgeProfiel = typeDef && SYSTEEM_EDGE_PROFIELEN.includes(typeDef.edgeProfiel)
    ? typeDef.edgeProfiel
    : systeem.layers[0].edge.profiel;
  const edgeOverrides = systeem.layers[0].edges;
  const nSeg = nodes.length;
  const segProfiel = [];
  let anySchaduw = false;
  for (let s = 0; s < nSeg; s++) {
    const p = edgeOverrides[String(s)] ?? edgeProfiel;
    segProfiel.push(p);
    if (p === 'schaduwvoeg') anySchaduw = true;
  }
  // Schaduwvoeg-inzet: de volledige miter-inzet heeft 1:1 punt-
  // correspondentie met de vlakke contour, dus per segment kunnen we er
  // exact de bijbehorende punten uit snijden (hoeken blijven verstek).
  const insetAll = anySchaduw
    ? insetPolygon(contour, SYSTEEM_SCHADUWVOEG_INSET_MM * k)
    : null;
  // Rand-SEGMENTEN: per contoursegment de vlakke puntenreeks (wereld),
  // het effectieve profiel, de lengte (mm) en evt. de schaduwvoeg-lijn.
  const edgeSegs = [];
  for (let s = 0; s < nSeg; s++) {
    const idx = [];
    for (let i = 0; i < segOf.length; i++) {
      if (segOf[i] === s) idx.push(i);
    }
    if (idx.length === 0) continue;
    const run = idx.map(i => contour[i]);
    run.push(contour[(idx[idx.length - 1] + 1) % contour.length]);
    let lengthPx = 0;
    for (let i = 0; i + 1 < run.length; i++) {
      lengthPx += Math.hypot(run[i + 1].x - run[i].x, run[i + 1].y - run[i].y);
    }
    const insetPts = segProfiel[s] === 'schaduwvoeg' && insetAll
      ? [...idx.map(i => insetAll[i]), insetAll[(idx[idx.length - 1] + 1) % insetAll.length]]
      : null;
    edgeSegs.push({
      seg: s,
      profiel: segProfiel[s],
      pts: run,
      insetPts,
      lengthMm: lengthPx / k,
    });
  }
  const schaduwvoeg = edgeProfiel === 'schaduwvoeg'
    ? (insetAll || insetPolygon(contour, SYSTEEM_SCHADUWVOEG_INSET_MM * k))
    : null;

  return {
    params,
    systeem,
    typeDef,
    pxPerMm: k,
    nodes,
    contour,
    // Contour in RASTERRUIMTE (voor strook-/sparing-hittests) + zijn AABB.
    contourR,
    rasterAabb: box,
    // Wereld-AABB van de contour (de raster-AABB is een intern gegeven).
    contourAabb: worldBox,
    cellW,
    cellH,
    // Rasterlijnen en panelen zijn RASTERRUIMTE-coördinaten; `rot` (of null)
    // brengt ze bij het tekenen/queryen terug naar de wereld.
    rot,
    linesV,
    linesH,
    origin,
    originWorld,
    originGrip,
    hoekGrip,
    randMm,
    panels,
    layout,
    stroken,
    pasLijnen,
    sparingen,
    sparingRegels,
    raveels,
    edgeProfiel,
    edgeSegs,
    schaduwvoeg,
    tag,
    aabb,
  };
}

// ── persistentie-helpers (model ⇄ OPS-sleutels) ────────────────────────────
// Pure vertaling tussen het annotatiemodel en de privé-OPS-waarden die de
// saver wegschrijft en de loader terugleest. Eén plek, zodat de round-trip
// (open → save → heropen) in een unittest bewezen kan worden zonder
// pdf-lib/PDF.js erbij.

/** Model → OPS-waarden (bogen, systeemtype, randprofiel, paneel-overrides). */
export function systeemToOps(ann) {
  const pts = (ann && ann.points) || [];
  const arcFlags = pts.map(p => (p && p.arc === true ? 1 : 0));
  const arcBulges = pts.map(p => (p && p.arc === true
    ? (Number.isFinite(Number(p.bulge)) ? Number(p.bulge) : 0.3) : 0));
  const sys = resolveSysteem(ann);
  const panels = sys.layers[0].panels;
  const edges = sys.layers[0].edges;
  return {
    hasArcs: arcFlags.some(f => f === 1),
    arcFlags,
    arcBulges,
    sysType: sys.type,
    edgeProfiel: sys.layers[0].edge.profiel,
    panelsJson: Object.keys(panels).length > 0 ? JSON.stringify(panels) : null,
    // Randprofiel-overrides per contoursegment (naast de paneel-overrides).
    edgesJson: Object.keys(edges).length > 0 ? JSON.stringify(edges) : null,
  };
}

/** OPS-waarden → modelvelden: muteert `points` (boogvlaggen) en levert het
 *  `system`-object. Kapotte/afwezige waarden degraderen stil naar defaults. */
export function systeemFromOps(points, ops) {
  const o = ops || {};
  if (Array.isArray(points) && Array.isArray(o.arcFlags)
      && o.arcFlags.length === points.length) {
    for (let i = 0; i < points.length; i++) {
      if (Number(o.arcFlags[i]) === 1) {
        points[i].arc = true;
        const b = Array.isArray(o.arcBulges) ? Number(o.arcBulges[i]) : NaN;
        points[i].bulge = Number.isFinite(b) && b !== 0 ? b : 0.3;
      }
    }
  }
  let panels = {};
  if (typeof o.panelsJson === 'string' && o.panelsJson) {
    try { panels = JSON.parse(o.panelsJson) || {}; } catch (_) { panels = {}; }
  }
  let edges = {};
  if (typeof o.edgesJson === 'string' && o.edgesJson) {
    try { edges = JSON.parse(o.edgesJson) || {}; } catch (_) { edges = {}; }
  }
  return resolveSysteem({ system: {
    type: o.sysType,
    layers: [{ panels, edges, edge: { profiel: o.edgeProfiel } }],
  } });
}
