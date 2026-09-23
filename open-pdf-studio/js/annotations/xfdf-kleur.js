// Kleur-attributen in XFDF (zie annotations/xfdf.js).
//
// Een vorm zonder rand ("geen rand" in de lijnkleurkiezer, strokeColor 'none')
// kreeg hier color="NONE" — geen geldige XFDF-kleur, en elke andere lezer
// maakt er zwart van. De XFDF-afspraak is: laat het attribuut wég. Bij het
// inlezen telt zowel een ontbrekend attribuut als de waarde NONE (of
// TRANSPARENT, hoofdletterongevoelig) als "geen rand", maar alleen voor
// soorten waarvan de omtrek weg kan — een lijn zonder color-attribuut hoort
// gewoon zwart te zijn.

import { hasStroke, kanZonderRand } from './fill-utils.js';

// Hex-kleur → XFDF-kleurwaarde.
export function colorToXFDF(hex) {
  if (!hex) return '#000000';
  return hex.toUpperCase();
}

// XFDF-kleurwaarde → hex. Accepteert '#rrggbb' en 'r,g,b' (0..1).
export function xfdfColorToHex(color) {
  if (!color) return '#000000';
  if (color.startsWith('#')) return color;
  // Handle comma-separated RGB (0-1 range)
  const parts = color.split(',').map(Number);
  if (parts.length === 3) {
    const r = Math.round(parts[0] * 255);
    const g = Math.round(parts[1] * 255);
    const b = Math.round(parts[2] * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return color;
}

// Het ` color="..."` attribuut van een vorm, of '' als de vorm geen rand heeft.
// Aanroepers plakken het resultaat achter de gedeelde attributen.
export function randkleurAttribuut(ann) {
  if (ann && !hasStroke(ann.strokeColor) && kanZonderRand(ann.type)) return '';
  const kleur = ann && (ann.strokeColor || ann.color);
  return ` color="${colorToXFDF(hasStroke(kleur) ? kleur : null)}"`;
}

// Randkleur uit het color-attribuut. Ontbreekt het attribuut of staat er NONE
// / TRANSPARENT, dan is de vorm randloos — voor zover die soort dat kent.
export function randkleurUitAttribuut(raw, type) {
  const tekst = raw == null ? '' : String(raw).trim();
  const geenRand = tekst === '' || !hasStroke(tekst.toLowerCase());
  if (geenRand) return kanZonderRand(type) ? 'none' : '#000000';
  return xfdfColorToHex(tekst);
}

// Vulkleur uit het interior-color-attribuut. Ontbreekt het attribuut, dan is er
// GEEN vulling: xfdfColorToHex() zou er zwart van maken en een onopgevulde
// vorm als zwart blok terugzetten.
export function vulkleurUitAttribuut(raw) {
  const tekst = raw == null ? '' : String(raw).trim();
  if (tekst === '' || !hasStroke(tekst.toLowerCase())) return null;
  return xfdfColorToHex(tekst);
}
