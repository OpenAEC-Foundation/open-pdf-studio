// Schaalcontrole (#629): meet een tweede bekende maat na en toon hoeveel de
// schaal ernaast zit, in procenten en in eenheden.
//
// Werkwijze: na het kalibreren (of het invullen van een schaal) kiest de
// gebruiker twee punten op een maat waarvan hij de echte lengte kent. De app
// rekent die afstand om met de schaal die op die plek geldt (schaalgebied,
// viewport, schaalbalk, viewport uit de PDF, documentschaal) en vergelijkt
// met de bekende lengte. Binnen de "goed"-drempel is de schaal in orde,
// tussen de drempels een waarschuwing, daarboven fout.
//
// Een scan die in de ene richting meer is uitgerekt dan in de andere heeft
// twee schaalfactoren. De app rekent met één factor voor beide richtingen;
// staan er een horizontale en een verticale controle van dezelfde bron in de
// geschiedenis, dan meldt anisotropie() hoeveel ze verschillen.
//
// De geschiedenis per blad reist mee in het bestand (pdf/schaal-in-pdf.js,
// sleutel OPS_ScaleChecks op de pagina), zodat een controleur ziet dat de
// schaal is nagemeten.
//
// Puur: geen app-state, geen DOM.

import { MM_PER_UNIT } from './scale-from-measurement.js';
import { schaalBronOpPunt } from './schaal-op-punt.js';
import { pixelsPerUnitFor } from './scale-region-scale.js';

/** Drempels in procenten: tot `ok` goed, tot `waarschuwing` een waarschuwing. */
export const STANDAARD_DREMPELS = Object.freeze({ ok: 0.5, waarschuwing: 2 });

/** Zoveel controles per blad blijven in de geschiedenis (de nieuwste). */
export const MAX_CONTROLES_PER_BLAD = 20;

/** Hoek in graden waarbinnen een meting als horizontaal of verticaal telt. */
export const RICHTING_TOLERANTIE = 15;

/**
 * Geldige drempels: positief, en de waarschuwing niet kleiner dan "goed".
 * @param {{ok?: unknown, waarschuwing?: unknown}} [d]
 */
export function normaliseerDrempels(d) {
  const ok = Number(d?.ok);
  const w = Number(d?.waarschuwing);
  const okGoed = Number.isFinite(ok) && ok > 0 ? ok : STANDAARD_DREMPELS.ok;
  const wGoed = Number.isFinite(w) && w > 0 ? w : STANDAARD_DREMPELS.waarschuwing;
  return { ok: okGoed, waarschuwing: Math.max(okGoed, wGoed) };
}

/**
 * De afwijking van een controlemeting.
 * @param {{punten:number, bekend:number, pixelsPerUnit:number}} invoer
 *   punten: gemeten afstand in PDF-punten; bekend: de echte lengte in de
 *   eenheid van de schaal; pixelsPerUnit: de schaal op die plek
 * @returns {{gemeten:number, bekend:number, verschil:number, procent:number, factor:number} | null}
 *   verschil = gemeten - bekend (in de eenheid), procent = verschil / bekend,
 *   factor = bekend / gemeten (waarmee de huidige lengtes te vermenigvuldigen zijn)
 */
export function berekenAfwijking({ punten, bekend, pixelsPerUnit }) {
  const p = Number(punten);
  const b = Number(bekend);
  const ppu = Number(pixelsPerUnit);
  if (!(p > 0) || !(b > 0) || !(ppu > 0) || ![p, b, ppu].every(Number.isFinite)) return null;
  const gemeten = p / ppu;
  const verschil = gemeten - b;
  return { gemeten, bekend: b, verschil, procent: (verschil / b) * 100, factor: b / gemeten };
}

/**
 * Goed, waarschuwing of fout bij een afwijking in procenten.
 * @param {number} procent
 * @param {{ok:number, waarschuwing:number}} [drempels]
 * @returns {'ok'|'warn'|'fail'}
 */
export function classificeer(procent, drempels = STANDAARD_DREMPELS) {
  const { ok, waarschuwing } = normaliseerDrempels(drempels);
  const a = Math.abs(Number(procent));
  if (!Number.isFinite(a)) return 'fail';
  // Een kleine marge voor afrondingsruis: 0,5 % is nog goed.
  if (a <= ok + 1e-9) return 'ok';
  if (a <= waarschuwing + 1e-9) return 'warn';
  return 'fail';
}

/**
 * De richting van een meting op het blad (app-ruimte, y omlaag).
 * @returns {{hoek:number, as:'x'|'y'|'schuin'}}  hoek 0..90 graden ten opzichte van horizontaal
 */
export function richtingVan(p1, p2, tolerantie = RICHTING_TOLERANTIE) {
  const dx = Math.abs(Number(p2?.x) - Number(p1?.x));
  const dy = Math.abs(Number(p2?.y) - Number(p1?.y));
  const hoek = (Math.atan2(dy, dx) * 180) / Math.PI;
  const as = hoek <= tolerantie ? 'x' : (hoek >= 90 - tolerantie ? 'y' : 'schuin');
  return { hoek, as };
}

/**
 * De schaalbron van een meting: die op het midden, en of begin- en eindpunt
 * in dezelfde bron liggen. Liggen ze in verschillende schaalgebieden, dan
 * zegt de controle weinig: de dialoog meldt het.
 * @param {object} doc
 * @param {number} page
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @returns {{bron: ReturnType<typeof schaalBronOpPunt>, gelijk: boolean,
 *   begin: ReturnType<typeof schaalBronOpPunt>, eind: ReturnType<typeof schaalBronOpPunt>}}
 */
export function bronVoorPunten(doc, page, p1, p2) {
  const op = (x, y) => schaalBronOpPunt(doc, page, x, y, pixelsPerUnitFor);
  const begin = op(p1.x, p1.y);
  const eind = op(p2.x, p2.y);
  const midden = op((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
  const sleutel = (b) => b?.sleutel || 'geen';
  const gelijk = sleutel(begin) === sleutel(eind) && sleutel(begin) === sleutel(midden);
  return { bron: midden || begin || eind, gelijk, begin, eind };
}

/**
 * Hoe de gebruiker de schaal kan bijstellen vanuit deze bron. Een schaalgebied,
 * een viewport-annotatie en de documentschaal zijn aan te passen; een
 * schaalbalk tekent zijn eigen lengte en een viewport uit de PDF is van het
 * bestand, die blijven zoals ze zijn.
 * @param {{method?: string} | null} bron
 */
export function kanHerkalibreren(bron) {
  return !bron || bron.method === 'scaleRegion' || bron.method === 'viewport' || bron.method === 'document';
}

/**
 * De nieuwe schaal (punten per eenheid) na een controle.
 * @param {number} ppuHuidig  de schaal die nu geldt
 * @param {number} punten     gemeten afstand in PDF-punten
 * @param {number} bekend     de echte lengte, in de eenheid van de schaal
 * @param {'vervang'|'gemiddeld'} modus
 *   vervang: de controlemeting wordt de schaal; gemiddeld: het gemiddelde van
 *   de huidige schaal (de eerste meting) en de controlemeting
 * @returns {number|null}
 */
export function herkalibreer(ppuHuidig, punten, bekend, modus) {
  const p = Number(punten);
  const b = Number(bekend);
  if (!(p > 0) || !(b > 0)) return null;
  const nieuw = p / b;
  if (modus !== 'gemiddeld') return nieuw;
  const huidig = Number(ppuHuidig);
  return huidig > 0 && Number.isFinite(huidig) ? (huidig + nieuw) / 2 : nieuw;
}

/** De noemer N van 1:N bij een schaal in punten per eenheid. */
export function noemerVoorPpu(ppu, unit) {
  const mm = MM_PER_UNIT[unit] || 1;
  const p = Number(ppu);
  if (!(p > 0)) return null;
  return ((72 / 25.4) * mm) / p;
}

/** "1:N" bij een schaal in punten per eenheid, met zes significante cijfers. */
export function schaalTekstVoorPpu(ppu, unit) {
  const n = noemerVoorPpu(ppu, unit);
  return n ? `1:${Number(n.toPrecision(6))}` : null;
}

/**
 * Hoe verschillen de horizontale en de verticale schaal van dezelfde bron?
 * Neemt de nieuwste horizontale en de nieuwste verticale controle.
 * @param {Array<object>} controles  van één blad (nieuwste achteraan)
 * @param {string} sleutel           bron-sleutel (schaalBronOpPunt().sleutel)
 * @returns {{factorX:number, factorY:number, procent:number} | null}
 *   procent: (factorX - factorY) ten opzichte van hun gemiddelde
 */
export function anisotropie(controles, sleutel) {
  let x = null;
  let y = null;
  for (const c of Array.isArray(controles) ? controles : []) {
    if (!c || c.bron?.sleutel !== sleutel || !(c.gemeten > 0) || !(c.bekend > 0)) continue;
    if (c.as === 'x') x = c;
    else if (c.as === 'y') y = c;
  }
  if (!x || !y) return null;
  const factorX = x.bekend / x.gemeten;
  const factorY = y.bekend / y.gemeten;
  return { factorX, factorY, procent: ((factorX - factorY) / ((factorX + factorY) / 2)) * 100 };
}

const rond = (n, d = 6) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);

/**
 * Eén regel voor de geschiedenis.
 * @param {object} m
 * @returns {object}
 */
export function maakControle({
  datum, auteur, bron, p1, p2, punten, bekend, eenheid, pixelsPerUnit, drempels, actie = 'none',
}) {
  const afwijking = berekenAfwijking({ punten, bekend, pixelsPerUnit });
  if (!afwijking) return null;
  const d = normaliseerDrempels(drempels);
  const { as } = richtingVan(p1, p2);
  return {
    datum: typeof datum === 'string' ? datum : new Date().toISOString(),
    auteur: typeof auteur === 'string' ? auteur : '',
    bron: {
      soort: bron?.method || 'none',
      sleutel: bron?.sleutel || 'geen',
      label: typeof bron?.label === 'string' ? bron.label : '',
    },
    p1: { x: rond(p1.x, 3), y: rond(p1.y, 3) },
    p2: { x: rond(p2.x, 3), y: rond(p2.y, 3) },
    as,
    punten: rond(Number(punten), 4),
    eenheid: eenheid || 'mm',
    schaal: schaalTekstVoorPpu(pixelsPerUnit, eenheid || 'mm'),
    gemeten: rond(afwijking.gemeten),
    bekend: rond(afwijking.bekend),
    procent: rond(afwijking.procent, 4),
    status: classificeer(afwijking.procent, d),
    drempels: d,
    actie: ['none', 'vervang', 'gemiddeld'].includes(actie) ? actie : 'none',
  };
}

/** Is dit een bruikbare geschiedenisregel (uit een bestand)? */
export function isControle(c) {
  if (!c || typeof c !== 'object') return false;
  const getal = (v) => typeof v === 'number' && Number.isFinite(v);
  const punt = (p) => p && getal(p.x) && getal(p.y);
  return typeof c.datum === 'string' && punt(c.p1) && punt(c.p2)
    && getal(c.gemeten) && c.gemeten > 0 && getal(c.bekend) && c.bekend > 0 && getal(c.procent)
    && ['ok', 'warn', 'fail'].includes(c.status) && typeof c.eenheid === 'string'
    && c.bron && typeof c.bron.sleutel === 'string';
}

/**
 * De geschiedenis met een controle erbij, de nieuwste achteraan, hooguit
 * `max` per blad. Het origineel blijft ongemoeid.
 * @param {Record<number, object[]> | undefined} geschiedenis  per paginanummer
 */
export function voegControleToe(geschiedenis, page, controle, max = MAX_CONTROLES_PER_BLAD) {
  const uit = { ...(geschiedenis || {}) };
  if (!controle) return uit;
  const lijst = [...(uit[page] || []), controle];
  uit[page] = lijst.slice(Math.max(0, lijst.length - max));
  return uit;
}

/** De laatste controle van een blad, of null. */
export function laatsteControle(geschiedenis, page) {
  const lijst = geschiedenis?.[page];
  return Array.isArray(lijst) && lijst.length ? lijst[lijst.length - 1] : null;
}

/** De tekst voor de paginasleutel. */
export function schrijfControlesJson(lijst) {
  return JSON.stringify({ version: 1, checks: (lijst || []).filter(isControle) });
}

/** Controles uit de paginasleutel; [] bij alles wat niet klopt. */
export function leesControlesJson(tekst) {
  try {
    const data = JSON.parse(String(tekst));
    const lijst = Array.isArray(data?.checks) ? data.checks : [];
    return lijst.filter(isControle).slice(-MAX_CONTROLES_PER_BLAD);
  } catch {
    return [];
  }
}

/**
 * De geschiedenis na een wijziging in de paginavolgorde (oud → nieuw
 * paginanummer, null = verdwenen), zoals herschikViewports.
 */
export function herschikControles(geschiedenis, pageMapping) {
  if (!geschiedenis) return geschiedenis;
  const uit = {};
  for (const [pagina, lijst] of Object.entries(geschiedenis)) {
    const naar = pageMapping?.[pagina];
    if (naar == null) continue;
    uit[naar] = lijst;
  }
  return uit;
}
