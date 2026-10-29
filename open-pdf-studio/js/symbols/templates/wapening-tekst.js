// Gedeelde tekenhulpen voor de wapenings- en staalverbindingssymbolen:
// passend schalen van een lokale mm-tekening in de bbox, tekst met het
// wapenings-diameterteken (als vector, uit annotations/stavenreeks.js), een
// staafnummer in een cirkel en een eenvoudige maatlijn.
//
// Alle functies zijn puur en leveren draw-commands voor de parametricSymbol-
// renderer (line / circle / polyline / text / rings).

import { leesGetal } from '../../core/getal-invoer.js';
import { approxTextWidth, diameterSignSegments } from '../../annotations/stavenreeks.js';

export { approxTextWidth };

export function getal(v, def, min = -Infinity) {
  const n = typeof v === 'string' ? leesGetal(v) : Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
}

export function geheelGetal(v, def, min = 0) {
  return Math.max(min, Math.round(getal(v, def, min)));
}

/**
 * Past een lokale tekening (breedte W × hoogte H, y omlaag) gecentreerd in de
 * bbox. Levert de schaal S en de mappers X/Y naar canvas-coördinaten.
 */
export function pasIn(W, H, bbox) {
  const w = W > 0 ? W : 1;
  const h = H > 0 ? H : 1;
  const S = Math.min(bbox.width / w, bbox.height / h);
  const x0 = bbox.x + (bbox.width - w * S) / 2;
  const y0 = bbox.y + (bbox.height - h * S) / 2;
  return { S, X: (v) => x0 + v * S, Y: (v) => y0 + v * S };
}

const TEKEN_BREEDTE = 0.68; // vak voor het diameterteken, × tekengrootte
const TUSSENRUIMTE = 0.18;

/** Breedte van een tekst met diametertekens ('Ø' wordt als vector getekend). */
export function tekstBreedte(tekst, size) {
  const delen = String(tekst ?? '').split('Ø');
  let w = 0;
  delen.forEach((deel, i) => {
    if (i > 0) w += size * (TEKEN_BREEDTE + 2 * TUSSENRUIMTE);
    if (deel) w += approxTextWidth(deel, size);
  });
  return w;
}

/**
 * Tekst gecentreerd op (cx, cy). Elke 'Ø' wordt het wapenings-diameterteken
 * (cirkel + steile streep met twee vlaggetjes), net als in stavenreeks en
 * wapeningskorf — zo is het teken in de PDF-appearance font-onafhankelijk.
 */
export function tekstMetDiameter(tekst, cx, cy, size, extra = {}) {
  const cmds = [];
  const delen = String(tekst ?? '').split('Ø');
  const totaal = tekstBreedte(tekst, size);
  let x = cx - totaal / 2;
  const lw = Math.max(0.3, Math.min(0.8, size * 0.06));
  delen.forEach((deel, i) => {
    if (i > 0) {
      x += size * TUSSENRUIMTE;
      const r = size * 0.22;
      const sx = x + (size * TEKEN_BREEDTE) / 2;
      cmds.push({ kind: 'circle', cx: sx, cy, r, lineWidth: lw, role: 'diameterteken' });
      for (const s of diameterSignSegments(r).segments) {
        cmds.push({
          kind: 'line', x1: sx + s.x1, y1: cy - s.y1, x2: sx + s.x2, y2: cy - s.y2,
          lineWidth: lw, role: 'diameterteken',
        });
      }
      x += size * (TEKEN_BREEDTE + TUSSENRUIMTE);
    }
    if (deel) {
      const w = approxTextWidth(deel, size);
      cmds.push({ kind: 'text', x: x + w / 2, y: cy, text: deel, size, ...extra });
      x += w;
    }
  });
  return cmds;
}

/** Staafnummer in een cirkel (positienummer), gecentreerd op (cx, cy). */
export function staafnummerBol(nummer, cx, cy, size) {
  const tekst = String(nummer ?? '');
  const r = Math.max(size * 0.72, approxTextWidth(tekst, size) / 2 + size * 0.25);
  return [
    { kind: 'circle', cx, cy, r, lineWidth: Math.max(0.3, size * 0.07), role: 'staafnummer' },
    { kind: 'text', x: cx, y: cy, text: tekst, size, role: 'staafnummer' },
  ];
}

/** Straal van staafnummerBol (voor de opmaak). */
export function staafnummerStraal(nummer, size) {
  return Math.max(size * 0.72, approxTextWidth(String(nummer ?? ''), size) / 2 + size * 0.25);
}

/** Klein gevuld rondje (staaf in doorsnede) als veelhoek. */
export function stip(cx, cy, r, lineWidth) {
  const points = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  const c = { kind: 'polyline', fill: true, close: true, points, role: 'staaf' };
  if (lineWidth != null) c.lineWidth = lineWidth;
  return c;
}

/** Gesloten rechthoek als polyline. */
export function rechthoek(x, y, w, h, extra = {}) {
  return {
    kind: 'polyline', close: true,
    points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
    ...extra,
  };
}

/**
 * Maatlijn tussen (x1,y1) en (x2,y2) (canvas), met schuine maatstreepjes en
 * het maatgetal in het midden; `kant` (±1) kiest de zijde langs de normaal
 * (-uy, ux) van de lijnrichting.
 */
export function maatlijn(x1, y1, x2, y2, tekst, size, kant = -1) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const nx = -uy, ny = ux;
  const t = size * 0.35;
  const streep = (px, py) => ({
    kind: 'line',
    x1: px - (ux + nx) * t * 0.7, y1: py - (uy + ny) * t * 0.7,
    x2: px + (ux + nx) * t * 0.7, y2: py + (uy + ny) * t * 0.7,
    role: 'maatlijn',
  });
  // Afstand tot de lijn: bij een liggende maatlijn de halve tekenhoogte, bij
  // een staande de halve tekstbreedte (het getal staat altijd horizontaal).
  const afstand = Math.abs(nx) * (approxTextWidth(String(tekst), size) / 2 + size * 0.35)
    + Math.abs(ny) * size * 0.75;
  const mx = (x1 + x2) / 2 + nx * kant * afstand;
  const my = (y1 + y2) / 2 + ny * kant * afstand;
  return [
    { kind: 'line', x1, y1, x2, y2, role: 'maatlijn' },
    streep(x1, y1),
    streep(x2, y2),
    { kind: 'text', x: mx, y: my, text: String(tekst), size, role: 'maatgetal' },
  ];
}

/** Standaard snappunten op de bbox (midden, hoeken, middens van de randen). */
export function bboxSnapPunten(_params, bbox) {
  const { x, y, width: w, height: h } = bbox;
  return [
    { kind: 'center', x: x + w / 2, y: y + h / 2 },
    { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
    { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
    { kind: 'midpoint', x: x + w / 2, y }, { kind: 'midpoint', x: x + w / 2, y: y + h },
    { kind: 'midpoint', x, y: y + h / 2 }, { kind: 'midpoint', x: x + w, y: y + h / 2 },
  ];
}
