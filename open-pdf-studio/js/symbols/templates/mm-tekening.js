// Gedeelde hulpjes voor inrichtingssymbolen (sanitair, keuken) die in
// WERKELIJKE millimeters getekend worden.
//
// Werkwijze: een symbool bouwt zijn vormen in een lokaal mm-stelsel met de
// ACHTERKANT (wandzijde) aan de bovenrand, x naar rechts, y naar beneden —
// hetzelfde stelsel als het ongedraaide symboolvak. Spiegelen gebeurt in dat
// stelsel (x -> breedte - x), zodat tekst leesbaar blijft. Daarna zet
// `naarVak` alles in één keer om naar tekencommando's in het vak van de
// annotatie; draaien doet de renderer zelf (annotation.rotation).
//
// Vormen in mm:
//   { kind: 'polyline', points: [{x, y}], close?, stippel?, fill? }
//   { kind: 'line', x1, y1, x2, y2, stippel? }
//   { kind: 'circle', cx, cy, r }
//   { kind: 'text', x, y, text, size }            (size = teksthoogte in mm)

/** Positief getal, anders de standaard; daarna binnen [min, max]. */
export function maatWaarde(v, standaard, min = 0, max = Infinity) {
  const n = Number(v);
  const w = Number.isFinite(n) && n > 0 ? n : standaard;
  return Math.min(max, Math.max(min, w));
}

/** Afronden op een veelvoud (maten uit grepen: op 10 mm). */
export function rondAf(v, stap = 10) {
  return Math.round(v / stap) * stap;
}

export function rechthoek(x0, y0, x1, y1) {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/**
 * Punten op een ellips van hoek a0 naar a1 (radialen; 0 = rechts, PI/2 =
 * onder, want y wijst naar beneden). Begin- en eindpunt zitten erin.
 */
export function ellipsPunten(cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, n = 32) {
  // cos(PI/2) is 6e-17, geen 0: een boog die op een wand eindigt moet daar
  // ook precies eindigen.
  const schoon = (v) => (Math.abs(v) < 1e-12 ? 0 : v);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push({ x: cx + rx * schoon(Math.cos(a)), y: cy + ry * schoon(Math.sin(a)) });
  }
  return pts;
}

/** Gesloten ellips als polyline (het circle-commando kent geen ellips). */
export function ellips(cx, cy, rx, ry, n = 36) {
  const pts = ellipsPunten(cx, cy, rx, ry, 0, Math.PI * 2, n);
  pts.pop(); // laatste = eerste
  return { kind: 'polyline', points: pts, close: true };
}

/** Rechthoek met afgeronde hoeken (straal r, geklemd op de halve zijde). */
export function afgerondeRechthoek(x0, y0, x1, y1, r, n = 5) {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (rr === 0) return rechthoek(x0, y0, x1, y1);
  const hoek = (cx, cy, a0) => ellipsPunten(cx, cy, rr, rr, a0, a0 + Math.PI / 2, n);
  return [
    ...hoek(x1 - rr, y0 + rr, -Math.PI / 2),
    ...hoek(x1 - rr, y1 - rr, 0),
    ...hoek(x0 + rr, y1 - rr, Math.PI / 2),
    ...hoek(x0 + rr, y0 + rr, Math.PI),
  ];
}

function spiegelPunt(p, b) {
  return { ...p, x: b - p.x };
}

/** Eén vorm gespiegeld om de verticale middellijn van een vak `b` breed. */
export function spiegelVorm(v, b) {
  switch (v.kind) {
    case 'polyline': return { ...v, points: v.points.map((p) => spiegelPunt(p, b)) };
    case 'line': return { ...v, x1: b - v.x1, x2: b - v.x2 };
    case 'circle': return { ...v, cx: b - v.cx };
    case 'text': return { ...v, x: b - v.x };
    default: return v;
  }
}

/** Alle vormen gespiegeld wanneer `aan`; anders ongewijzigd. */
export function spiegel(vormen, b, aan) {
  return aan ? vormen.map((v) => spiegelVorm(v, b)) : vormen;
}

// Stippellijn in paginapunten: vast op papier, zoals een streepjeslijn hoort.
const STIPPEL = [3, 2];

/**
 * Vormen in mm (stelsel `maat.breedte` x `maat.diepte`) naar tekencommando's
 * in het vak van de annotatie. Past het vak niet precies bij de maat (net
 * versleept), dan rekt de tekening mee in plaats van buiten het vak te lopen.
 */
export function naarVak(vormen, maat, bbox) {
  const sx = bbox.width / (maat.breedte || 1);
  const sy = bbox.height / (maat.diepte || 1);
  const sr = Math.sqrt(Math.abs(sx * sy));
  const X = (x) => bbox.x + x * sx;
  const Y = (y) => bbox.y + y * sy;
  const cmds = [];
  for (const v of vormen) {
    switch (v.kind) {
      case 'polyline': {
        const c = { kind: 'polyline', points: v.points.map((p) => ({ x: X(p.x), y: Y(p.y) })) };
        if (v.close) c.close = true;
        if (v.fill) c.fill = v.fill;
        if (v.stippel) c.dash = STIPPEL;
        cmds.push(c);
        break;
      }
      case 'line': {
        const c = { kind: 'line', x1: X(v.x1), y1: Y(v.y1), x2: X(v.x2), y2: Y(v.y2) };
        if (v.stippel) c.dash = STIPPEL;
        cmds.push(c);
        break;
      }
      case 'circle':
        cmds.push({ kind: 'circle', cx: X(v.cx), cy: Y(v.cy), r: v.r * sr });
        break;
      case 'text':
        cmds.push({
          kind: 'text', x: X(v.x), y: Y(v.y), text: v.text,
          size: Math.max(1, v.size * Math.min(Math.abs(sx), Math.abs(sy))),
        });
        break;
      default:
        break;
    }
  }
  return cmds;
}

/** Alle x/y-coördinaten van een vormenlijst (voor tests en omhullenden). */
export function coordinaten(vormen) {
  const xs = [];
  const ys = [];
  for (const v of vormen) {
    if (v.kind === 'polyline') for (const p of v.points) { xs.push(p.x); ys.push(p.y); }
    if (v.kind === 'line') { xs.push(v.x1, v.x2); ys.push(v.y1, v.y2); }
    if (v.kind === 'circle') { xs.push(v.cx - v.r, v.cx + v.r); ys.push(v.cy - v.r, v.cy + v.r); }
    if (v.kind === 'text') { xs.push(v.x); ys.push(v.y); }
  }
  return { xs, ys };
}
