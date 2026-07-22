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
  // Pootlengte in app-px (schaal 1). 36 ≈ 1,5× de oude 24: de poot moet
  // duidelijk zichtbaar zijn tussen de reekslijn en de punt, zoals in het
  // wapeningsdetail waarnaar de vorm gemodelleerd is. Instelbaar in het
  // eigenschappen-paneel (bereik 1–200).
  legLength: 36,
  labelSide: 'end',
  fontSize: 12,
};

/**
 * Hoek van een poot t.o.v. de REEKSLIJN, in graden.
 *
 * 90° = loodrecht op de reekslijn, 45° = de oude "diagonaal". In het
 * wapeningsdetail waar de vorm op gemodelleerd is lopen de poten duidelijk
 * steiler dan 45°, maar niet loodrecht: de poot moet zichtbaar "achterover"
 * hellen zodat de reeks een richting houdt. 68° is de gekozen middenweg —
 * de tangentiële component is dan cos68° ≈ 0.37 (bij pootlengte 36 dus ~13 px
 * horizontaal tegenover ~33 px loodrecht), wat de referentie het dichtst
 * benadert zonder dat de poten loodrecht ogen.
 */
export const STAVENREEKS_LEG_ANGLE_DEG = 68;

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
 * Tangentiële component van een poot: |cos θ| met θ de pootbouw uit
 * STAVENREEKS_LEG_ANGLE_DEG. Dit is de fractie van de pootlengte die LANGS de
 * reekslijn wordt afgelegd — gebruikt voor de vrijloop van het label.
 */
export function legTangentFraction(angleDeg = STAVENREEKS_LEG_ANGLE_DEG) {
  return Math.abs(Math.cos((Number(angleDeg) || 0) * Math.PI / 180));
}

/**
 * Eenheidsvector van een poot: θ graden t.o.v. de reekslijn, samengesteld uit
 * de loodrechte (boven/onder) en de tangent (links/rechts hellend).
 *
 * De loodrechte krijgt gewicht sin θ en de tangent cos θ, zodat de hoek tussen
 * poot en reekslijn exact θ is. Bij θ = 45° zijn beide gewichten gelijk (het
 * oude gedrag); bij de huidige default 68° overheerst de loodrechte en staat
 * de poot dus steiler. De vier richtingen spiegelen via de twee tekens en
 * blijven daardoor onderling symmetrisch.
 */
export function legUnitVector(frame, legDir, angleDeg = STAVENREEKS_LEG_ANGLE_DEG) {
  const dir = STAVENREEKS_LEG_DIRS.includes(legDir) ? legDir : STAVENREEKS_DEFAULTS.legDir;
  const perpSign = dir.startsWith('down') ? 1 : -1;
  const leanSign = dir.endsWith('right') ? 1 : -1;
  const th = (Number(angleDeg) || 0) * Math.PI / 180;
  const wPerp = Math.sin(th);
  const wTan = Math.cos(th);
  const vx = perpSign * frame.nx * wPerp + leanSign * frame.ux * wTan;
  const vy = perpSign * frame.ny * wPerp + leanSign * frame.uy * wTan;
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
 * Maatvoering van het WAPENINGS-diameterteken, uitgedrukt in eenheden van de
 * cirkelstraal `r` (= 0.28 × fontSize, zie labelLayout).
 *
 * Het teken is de gebruikelijke doorstreepte cirkel, maar met TWEE korte
 * dwarsstreepjes ("vlaggetjes") op de schuine streep — het symbool dat in
 * wapeningsdetails de staafdiameter aanduidt.
 *
 * Keuze van de maten (bij de standaard fontSize 12 is r = 3.36 px):
 *  - `slashHalfLength` 1.7·r — de streep steekt duidelijk buiten de cirkel uit,
 *    zodat de vlaggetjes er nog vóór het uiteinde op passen.
 *  - `flagDistance` 1.35·r — de vlaggetjes zitten NET BUITEN de cirkelrand,
 *    symmetrisch aan weerszijden van het middelpunt. Precies ÓP de rand (1.0·r)
 *    is geprobeerd maar valt visueel weg tegen de cirkellijn: de streepjes
 *    lezen dan als bobbels op de cirkel in plaats van als losse vlaggetjes.
 *  - `flagHalfLength` 0.5·r — volle streepjeslengte 1.0·r = 0.28 × fontSize,
 *    binnen de bandbreedte 0,25–0,35 × tekengrootte uit de referentie.
 *    Bij fontSize 12 is dat ~3.4 px: kort, maar duidelijk herkenbaar.
 */
// Maatvoering van het wapenings-diameterteken, in eenheden van de cirkelstraal
// r. Afgemeten aan het referentiesymbool:
//  - de schuine streep staat STEIL (70° t.o.v. de tekstregel) en is asymmetrisch:
//    hij steekt ver boven de cirkel uit en maar kort eronder;
//  - de twee vlaggetjes zitten ALLEBEI op dat bovenstuk, staan HORIZONTAAL
//    (evenwijdig aan de tekstregel, niet loodrecht op de streep) en zijn
//    gecentreerd op de streep.
export const DIAMETER_SIGN_METRICS = {
  slashAngleDeg: 70,
  slashUp: 3.45,      // hoever de streep boven het middelpunt uitsteekt
  slashDown: 2.2,     // en hoever eronder
  flagAt: [2.4, 3.05], // afstanden langs de streep waar de vlaggetjes kruisen
  flagHalfLength: 0.8, // halve lengte; volle vlaggetjeslengte = 1.6 r
};

/**
 * Lijnstukken van het wapenings-diameterteken t.o.v. het MIDDELPUNT van de
 * cirkel, in een frame met y OMHOOG (PDF-conventie). Het canvas (y omlaag)
 * spiegelt de y-waarden; daardoor tekenen canvas en PDF-appearance per
 * definitie exact hetzelfde symbool.
 *
 * De cirkel zelf zit niet in deze lijst (die tekenen beide consumenten als
 * boog/Bézier); `r` wordt wel meegeleverd.
 *
 * Volgorde: [0] = de schuine streep, [1] en [2] = de twee vlaggetjes.
 *
 * @param {number} signRadius  Cirkelstraal (labelLayout().signRadius).
 * @returns {{r:number, segments: Array<{x1:number,y1:number,x2:number,y2:number}>}}
 */
export function diameterSignSegments(signRadius) {
  const r = Number(signRadius) > 0 ? Number(signRadius) : 0;
  const M = DIAMETER_SIGN_METRICS;
  // Richting van de schuine streep: steil, linksonder → rechtsboven.
  const th = (M.slashAngleDeg * Math.PI) / 180;
  const ux = Math.cos(th), uy = Math.sin(th);

  // De streep loopt asymmetrisch door het middelpunt: kort naar beneden,
  // ver naar boven (daar zitten de vlaggetjes op).
  const up = r * M.slashUp;
  const down = r * M.slashDown;
  const segments = [
    { x1: -ux * down, y1: -uy * down, x2: ux * up, y2: uy * up },
  ];
  // Vlaggetjes: horizontaal (evenwijdig aan de tekstregel), gecentreerd op de
  // streep, allebei op het bovenstuk.
  const fh = r * M.flagHalfLength;
  for (const t of M.flagAt) {
    const cx = ux * r * t;
    const cy = uy * r * t;
    segments.push({ x1: cx - fh, y1: cy, x2: cx + fh, y2: cy });
  }
  return { r, segments };
}

/**
 * Indeling van het label "N ⌀ D" in losse onderdelen.
 *
 * Het diameterteken wordt als VECTOR getekend (cirkel + schuine streep met
 * twee vlaggetjes — het wapeningssymbool), niet als glyph. Reden: U+2300 zit
 * niet in WinAnsiEncoding, dus een standaard Helvetica in de PDF-appearance
 * kan hem niet weergeven, en het wapeningssymbool bestaat sowieso in geen
 * enkel standaardfont. Door hem in ZOWEL het canvas als de PDF-stream als
 * vector te tekenen, zijn scherm en PDF identiek en is er geen
 * font-afhankelijkheid.
 *
 * @returns {{parts: Array, width: number, signRadius: number, signSegments: Array}}
 *   parts: [{kind:'text'|'dia', text?, dx, w}] — dx is de x-offset vanaf het
 *   begin van het label, langs de tekstrichting.
 */
export function labelLayout(count, diameter, fontSize, measure = approxTextWidth) {
  const p = resolveParams({ count, diameter });
  const left = String(p.count);
  const right = String(p.diameter);
  const gap = fontSize * 0.22;
  // Vak voor het diameterteken: breed genoeg voor de schuine streep met
  // vlaggetjes (2·1.7·r·cos45° ≈ 0.67 × fontSize) plus wat lucht.
  // Horizontale ruimte: van de cirkelrand links (-1 r) tot het uiteinde van
  // het bovenste vlaggetje (+1,84 r) = 2,84 r, plus wat lucht.
  const signW = fontSize * 0.68;
  const wl = measure(left, fontSize);
  const wr = measure(right, fontSize);
  const parts = [
    { kind: 'text', text: left, dx: 0, w: wl },
    { kind: 'dia', dx: wl + gap, w: signW },
    { kind: 'text', text: right, dx: wl + gap + signW + gap, w: wr },
  ];
  // Kleinere cirkel dan een gewoon diameterteken: de steile streep steekt ver
  // boven de cirkel uit, dus bij r = 0.28 zou het teken de cijfers ver
  // overheersen. Bij 0.22 is de totale hoogte ~1,2 x de tekengrootte.
  const signRadius = fontSize * 0.22;
  return {
    parts,
    width: wl + gap + signW + gap + wr,
    signRadius,
    // Streep + twee vlaggetjes, gedeeld door canvas én PDF-appearance.
    signSegments: diameterSignSegments(signRadius).segments,
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
  // Vrijloop langs de lijn. Standaard een halve tekengrootte. Hellen de poten
  // NAAR de labelzijde toe, dan steken de poot en zijn punt langs de
  // lijnrichting voorbij het ankerpunt (legLength × de TANGENTIËLE component
  // van de pootrichting + puntstraal); het label schuift dan precies zoveel
  // op, zodat het nooit tegen de eerste poot of punt botst. Die component
  // beweegt mee met STAVENREEKS_LEG_ANGLE_DEG: bij een steilere poot is de
  // benodigde vrijloop kleiner. In de referentie hellen de poten van het label
  // WEG en is de extra vrijloop nul: het label staat net voorbij het uiteinde.
  const leansToLabel = atEnd === params.legDir.endsWith('right');
  const legReach = leansToLabel ? params.legLength * legTangentFraction() + r : 0;
  const gap = fontSize * 0.5 + legReach;
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
  // Normaliseer naar (-π, π]. Zonder dit levert een exact naar links wijzende
  // uitloop (atan2 = +π) na de flip 2π op: rekenkundig hetzelfde, maar een
  // verwarrende waarde voor controles en voor de AP-stream.
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle <= -Math.PI) angle += 2 * Math.PI;

  const label = {
    text, x: labelX, y: labelY, angle, align,
    fontSize, width: textW,
    // Onderdelen (tekst + vector-⌀) — gedeeld door canvas en PDF-appearance.
    parts: layout.parts, signRadius: layout.signRadius,
    signSegments: layout.signSegments,
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
      signSegments: layout.signSegments,
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
