// Het gevelelement als annotatie: de brug tussen de pure indeling (mm, assen
// van het element) en de parametricSymbol-annotatie op de pagina (twee
// eindpunten, een vak, een draaiing).
//
// Puur: werkt op gewone annotatie-objecten, kent geen registry, geen canvas
// en geen app-state. De template (symbols/templates/gevelelement.js), de
// selectietool, het toetsenbord en de MCP-opdracht rekenen allemaal hiermee.
//
// Transient op de annotatie (niet opgeslagen):
//   selectedSub  het geselecteerde onderdeel { soort, index } of null
//   _hoverSub    het onderdeel onder de aanwijzer (alleen voor oplichten)

import { twoPointEndpoints, syncTwoPointGeometry } from '../symbols/two-point.js';
import { indeling, verschuifStijl, rekUit } from './indeling.js';
import { onderdeelOp, geldigOnderdeel } from './onderdelen.js';
import { elementMaat, langsElement, puntOpElement, onderdeelVlak, vakNaarPagina } from './weergave.js';

/** Greeptype van de geselecteerde tussenstijl (handles.js / transforms.js). */
export const STIJL_GREEP = 'gevelelement_stijl';

export function elementLijn(ann) {
  return twoPointEndpoints(ann);
}

/** Paginapunten per mm langs het element (uit de getekende lengte). */
export function ptPerMm(ann, presetId) {
  const lay = indeling(ann?.params, presetId);
  const l = elementLijn(ann);
  const len = Math.hypot(l.endX - l.startX, l.endY - l.startY);
  return len > 0 ? len / lay.lengteMm : 0;
}

/** Paginapunt → { uMm, dMm } langs het element. */
export function positieOpElement(ann, presetId, punt) {
  const lay = indeling(ann?.params, presetId);
  return langsElement(elementLijn(ann), lay.lengteMm, punt);
}

/**
 * Het onderdeel onder een paginapunt. `margePt` is speling in paginapunten
 * (de selectietool geeft een paar schermpixels mee), zodat een dunne stijl
 * op een kleine schaal toch te raken is.
 */
export function onderdeelOnderPunt(ann, presetId, punt, margePt = 0) {
  const lay = indeling(ann?.params, presetId);
  const pos = langsElement(elementLijn(ann), lay.lengteMm, punt);
  if (!pos) return null;
  const k = ptPerMm(ann, presetId);
  return onderdeelOp(lay, pos.uMm, k > 0 ? margePt / k : 0);
}

/** Het vlak van een onderdeel in paginapunten (vier hoekpunten). */
export function onderdeelPaginaVlak(ann, presetId, sub) {
  const bbox = { x: ann.x, y: ann.y, width: ann.width, height: ann.height };
  const vlak = onderdeelVlak(ann?.params, presetId, bbox, sub);
  return vlak ? vlak.map((p) => vakNaarPagina(bbox, ann.rotation, p)) : null;
}

/** Greep van de geselecteerde TUSSENstijl (het kader verschuift niet), of null. */
export function stijlGreep(ann, presetId) {
  const lay = indeling(ann?.params, presetId);
  const sub = geldigOnderdeel(lay, ann?.selectedSub);
  if (!sub || sub.soort !== 'stijl' || sub.index === 0 || sub.index === lay.stijlen.length - 1) return null;
  const p = puntOpElement(elementLijn(ann), lay.lengteMm, lay.stijlen[sub.index].posMm);
  return { type: STIJL_GREEP, index: sub.index, x: p.x, y: p.y };
}

/**
 * Slepen aan de stijlgreep: de stijl volgt de projectie van de aanwijzer op
 * de elementlijn en blijft binnen zijn buurvelden (klemmen, niet weigeren).
 * `ann` is de werkkopie, `orig` de stand bij het begin van de sleep.
 */
export function sleepStijl(ann, orig, presetId, dx, dy) {
  const greep = stijlGreep(orig, presetId);
  if (!greep) return false;
  const pos = positieOpElement(orig, presetId, { x: greep.x + dx, y: greep.y + dy });
  if (!pos) return false;
  const r = verschuifStijl(orig.params, presetId, greep.index, pos.uMm, { klem: true });
  if (!r.ok) return false;
  ann.params = r.params;
  return true;
}

/**
 * Na het verslepen van een eindgreep: de stijlen blijven staan ten opzichte
 * van het uiteinde dat NIET bewoog; alleen het veld aan de bewegende kant
 * verandert. `ann.params.lengte` is dan al de nieuwe lengte.
 */
export function rekElement(ann, orig, presetId, vasteKant) {
  const r = rekUit(orig.params, presetId, ann?.params?.lengte, vasteKant);
  if (!r.ok) return false;
  ann.params = r.params;
  return true;
}

/**
 * Vak en eindpunten opnieuw afleiden na een parameterwijziging. Het
 * beginpunt en de richting blijven liggen; de lengte volgt params.lengte en
 * de hoogte van het vak volgt de indeling (diepte en de draaicirkel van een
 * deur). `k` = paginapunten per werkelijke mm op de plek van het element.
 */
export function geometrieNaParams(ann, presetId, k) {
  if (!(k > 0)) return ann;
  const l = elementLijn(ann);
  const maat = elementMaat(ann.params, presetId);
  const len = Math.hypot(l.endX - l.startX, l.endY - l.startY);
  const ux = len > 0 ? (l.endX - l.startX) / len : 1;
  const uy = len > 0 ? (l.endY - l.startY) / len : 0;
  const lengte = maat.lengteMm * k;
  syncTwoPointGeometry(ann, l.startX, l.startY, l.startX + ux * lengte, l.startY + uy * lengte, maat.bandMm * k);
  return ann;
}
