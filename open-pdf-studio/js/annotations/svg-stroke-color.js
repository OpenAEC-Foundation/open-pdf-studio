// Kleur van een SVG-symbool herschrijven — pure module, geen app-imports.
//
// Een geplaatst symbool is een rasterafbeelding: `ctx.drawImage()` kent geen
// tekenkleur, dus de kleur moet IN de SVG staan voordat er gerasterd wordt.
// Zelfde motivatie en beperkingen als svg-stroke-width.js: alleen
// ATTRIBUTEN (`stroke`/`fill`), geen CSS in een <style>-blok.
//
// Herkleurregel: alle zichtbare lijn- en vulkleuren krijgen de doelkleur;
// `none` en wit blijven staan. Wit is in symbolen vrijwel altijd achtergrond
// of uitsparing — die mee-verven zou het symbool dichtsmeren.

const ROOT_TAG = /<svg\b[^>]*>/i;
const PAINT_ATTR = /\b(stroke|fill)\s*=\s*"([^"]*)"/gi;

const WIT = new Set(['#fff', '#ffffff', 'white', 'rgb(255,255,255)', 'rgb(255, 255, 255)']);

function isHerkleurbaar(waarde) {
  const v = waarde.trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent') return false;
  if (WIT.has(v)) return false;
  // url(#…)-verwijzingen (gradiënten/patronen) ongemoeid laten.
  if (v.startsWith('url(')) return false;
  return true;
}

/**
 * De dominante (meest voorkomende) herkleurbare kleur van de bron, of null
 * als er geen enkele expliciete kleur in staat.
 */
export function svgDominantColor(svg) {
  if (!svg || typeof svg !== 'string') return null;
  const counts = new Map();
  for (const m of svg.matchAll(PAINT_ATTR)) {
    const v = m[2].trim().toLowerCase();
    if (isHerkleurbaar(v)) counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [kleur, c] of counts) {
    if (c > bestCount) { best = kleur; bestCount = c; }
  }
  return best;
}

/**
 * Herkleur de bron naar `color`: elke zichtbare stroke/fill die niet none of
 * wit is krijgt de doelkleur. Heeft de bron geen enkel paint-attribuut (alles
 * erft de SVG-standaard fill:black), dan wordt de kleur op de root gezet.
 * Bij onbruikbare invoer komt de bron ongewijzigd terug.
 */
export function recolorSvg(svg, color) {
  if (!svg || typeof svg !== 'string') return svg;
  if (!color || typeof color !== 'string' || !color.trim()) return svg;
  const doel = color.trim();

  PAINT_ATTR.lastIndex = 0;
  let geraakt = false;
  const uit = svg.replace(PAINT_ATTR, (heel, attr, waarde) => {
    if (!isHerkleurbaar(waarde)) return heel;
    geraakt = true;
    return `${attr}="${doel}"`;
  });
  if (geraakt) return uit;

  // Geen expliciete kleuren: alles tekent met de standaard fill:black — de
  // doelkleur op de root zetten zodat elk element hem erft.
  return svg.replace(ROOT_TAG, (tag) => tag.replace(/>$/, ` fill="${doel}">`));
}
