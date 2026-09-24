// De ruimte en haar tag (#477).
//
// De RUIMTE - het ruimtevlak dat `app_floorplan {action:"rooms", place:true}`
// neerzet (een meetvlak met een zaadpunt) - is het object met naam, nummer en
// netto oppervlakte:
//   opsRuimteNaam    de naam (ook als measureName, voor de hoeveelheden)
//   opsRuimteNummer  het nummer
//   measureValue     de netto oppervlakte (volgt uit de wanden)
// De ruimtetag toont wat de ruimte heeft; zijn eigen params zijn alleen een
// reservekopie voor een tag zonder ruimte. Een naam die je in de tag wijzigt,
// gaat naar de ruimte.
//
// Selecteren: de rand van een ruimte ligt op de wandvlakken en haar
// binnenkant is waar je een selectierechthoek begint. Een klik pakt dus nooit
// de ruimte - wanden, kozijnen en maten winnen altijd - maar je bereikt haar
// via haar tag (contextmenu of Tab). Een sleepvak pakt een ruimte alleen als
// ze er helemaal in ligt.
//
// Puur: geen app-state; de aanroepers geven de annotatielijst mee.

import { RUIMTETAG_ID } from '../symbols/templates/ruimtetag.js';
import { puntInPolygoon } from './ruimte.js';

const eindig = (...v) => v.every((n) => Number.isFinite(n));

/** Een ruimte uit de plattegrond (en geen gewoon meetvlak)? */
export function isRuimteVlak(a) {
  if (a?.type !== 'measureArea') return false;
  const z = a.opsRuimteZaad;
  return !!(z && eindig(z.x, z.y)) || (typeof a.opsRuimteNaam === 'string' && a.opsRuimteNaam !== '');
}

/** Een ruimtetag? */
export function isRuimteTag(a) {
  return a?.type === 'parametricSymbol' && a.symbolId === RUIMTETAG_ID;
}

/** Mag een klik deze annotatie selecteren? Een ruimte niet (zie boven). */
export function raakbaarBijKlik(a) {
  return !isRuimteVlak(a);
}

/**
 * Hoort de annotatie bij een sleepvak? `bounds` en `vak`: {x, y, width,
 * height}; `mode` 'window' (helemaal erin) of 'crossing' (raakt). Een ruimte
 * alleen als ze er helemaal in ligt, in beide standen.
 */
export function inSelectieVak(ann, bounds, vak, mode) {
  if (!bounds || !vak) return false;
  const helemaal = bounds.x >= vak.x && bounds.x + bounds.width <= vak.x + vak.width
    && bounds.y >= vak.y && bounds.y + bounds.height <= vak.y + vak.height;
  if (isRuimteVlak(ann) || mode === 'window') return helemaal;
  return bounds.x < vak.x + vak.width && bounds.x + bounds.width > vak.x
    && bounds.y < vak.y + vak.height && bounds.y + bounds.height > vak.y;
}

function tagZaad(tag) {
  const x = Number(tag?.params?.zaadX), y = Number(tag?.params?.zaadY);
  return eindig(x, y) ? { x, y } : null;
}

function tagMidden(tag) {
  return eindig(tag?.x, tag?.y)
    ? { x: tag.x + (Number(tag.width) || 0) / 2, y: tag.y + (Number(tag.height) || 0) / 2 }
    : null;
}

/**
 * De ruimte van een tag: dezelfde pagina, en eerst het zaadpunt (gelijk aan
 * dat van de ruimte, of erbinnen), anders de ruimte waar de tag in staat.
 * Bij ruimten binnen ruimten wint de kleinste.
 */
export function ruimteVanTag(tag, annotaties, tol = 0.5) {
  if (!isRuimteTag(tag)) return null;
  const page = tag.page ?? 1;
  const ruimten = (annotaties || []).filter((a) => isRuimteVlak(a) && (a.page ?? 1) === page);
  const zaad = tagZaad(tag);
  if (zaad) {
    const zelfde = ruimten.find((r) => r.opsRuimteZaad
      && Math.hypot(r.opsRuimteZaad.x - zaad.x, r.opsRuimteZaad.y - zaad.y) <= tol);
    if (zelfde) return zelfde;
  }
  for (const p of [zaad, tagMidden(tag)]) {
    if (!p) continue;
    let beste = null, kleinste = Infinity;
    for (const r of ruimten) {
      if (!Array.isArray(r.points) || r.points.length < 3 || !puntInPolygoon(p, r.points)) continue;
      const opp = Math.abs(r.points.reduce((s, a, i) => {
        const b = r.points[(i + 1) % r.points.length];
        return s + a.x * b.y - b.x * a.y;
      }, 0));
      if (opp < kleinste) { beste = r; kleinste = opp; }
    }
    if (beste) return beste;
  }
  return null;
}

/** De tags die bij deze ruimte horen. */
export function tagsVanRuimte(ruimte, annotaties) {
  if (!isRuimteVlak(ruimte)) return [];
  return (annotaties || []).filter((a) => isRuimteTag(a) && ruimteVanTag(a, annotaties) === ruimte);
}

const NAAR_M2 = { 'mm²': 1e-6, 'cm²': 1e-4, 'dm²': 1e-2, 'm²': 1 };

/** Netto oppervlakte van de ruimte in m², uit haar meting; null als onbekend. */
export function oppervlakteM2Van(ruimte) {
  const v = Number(ruimte?.measureValue);
  const f = NAAR_M2[ruimte?.measureUnit];
  return Number.isFinite(v) && f ? Math.round(v * f * 1e6) / 1e6 : null;
}

/**
 * De params waarmee een tag getekend wordt: naam, nummer en oppervlakte van
 * zijn ruimte, de opmaak (decimalen, oppervlakte tonen) van de tag zelf.
 * Andere symbolen en een tag zonder ruimte: hun eigen params.
 */
export function tagWeergaveParams(ann, annotaties) {
  if (!isRuimteTag(ann)) return ann?.params;
  const r = ruimteVanTag(ann, annotaties);
  if (!r) return ann.params;
  const opp = oppervlakteM2Van(r);
  return {
    ...ann.params,
    naam: r.opsRuimteNaam ?? '',
    nummer: r.opsRuimteNummer ?? '',
    ...(opp !== null ? { oppervlakteM2: opp } : {}),
  };
}

const tekst = (v) => (v === null || v === undefined ? undefined : String(v).trim());

/** De velden om naam en/of nummer van een ruimte te zetten (undefined = ongemoeid). */
export function ruimteNaamPatch(naam, nummer) {
  const uit = {};
  const n = tekst(naam);
  if (n !== undefined) { uit.opsRuimteNaam = n; uit.measureName = n; }
  if (nummer !== null && nummer !== undefined) uit.opsRuimteNummer = String(nummer).trim();
  return uit;
}

/**
 * Een wijziging van de tag-params (vanuit het eigenschappenpaneel): naam en
 * nummer gaan naar de ruimte, de rest blijft op de tag. De tag houdt een
 * reservekopie van naam en nummer.
 * @returns {{ ruimtePatch: object|null, tagParams: object }}
 */
export function tagWijziging(tag, ruimte, nieuweParams) {
  const tagParams = { ...(tag?.params || {}), ...(nieuweParams || {}) };
  if (!ruimte) return { ruimtePatch: null, tagParams };
  const naam = tekst(nieuweParams?.naam) ?? '';
  const nummer = tekst(nieuweParams?.nummer) ?? '';
  const anders = naam !== (ruimte.opsRuimteNaam ?? '') || nummer !== (ruimte.opsRuimteNummer ?? '');
  return { ruimtePatch: anders ? ruimteNaamPatch(naam, nummer) : null, tagParams };
}
