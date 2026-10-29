// Wapening — pure rekenkern voor staven, buigvormen en de buigstaat
// (GEEN UI/DOM-deps). Eén bron voor:
//   * de notatie op tekening ("12Ø10-150", "4Ø12"),
//   * de staaflengte (knip-/ontwikkelde lengte) per buigvorm,
//   * het gewicht per diameter (0,00617·d² kg/m),
//   * het verzamelen van staven uit annotaties (stavenreeks, parametrische
//     wapeningssymbolen) en het samenvoegen tot buigstaat-regels.
//
// De tekensymbolen (symbols/templates/: wapeningsdetail, staaf-plattegrond,
// wapeningsnet, vloer-vorstrand, wapeningskorf) en de hoeveelhedenstaat
// (quantities/categories.js) rekenen allebei via deze module, zodat de
// tekening en de staat per definitie hetzelfde getal tonen.
//
// Uitgangspunten staan in docs/constructie/wapening-en-staalverbindingen.md
// (in de hoofdmap van de repository).

import { leesGetal } from '../core/getal-invoer.js';

/** Gangbare betonstaalkwaliteiten (NEN 6008 / NEN-EN 10080). */
export const STAALKWALITEITEN = ['B500B', 'B500A', 'B500C'];
export const STANDAARD_STAALKWALITEIT = 'B500B';

/** Leverbare staafdiameters (mm). */
export const STAAF_DIAMETERS = [6, 8, 10, 12, 16, 20, 25, 32, 40];

/**
 * Massa per meter in kg/m = MASSA_FACTOR × d² (d in mm). 0,00617 is de
 * afgeronde waarde van π/4 · 7850 kg/m³ · 10⁻⁶ (= 0,006165).
 */
export const MASSA_FACTOR = 0.00617;

/** Afronding van de staaflengte op de buigstaat (naar boven, in mm). */
export const LENGTE_AFRONDING_MM = 5;

function num(v, def = 0, min = -Infinity) {
  const n = typeof v === 'string' ? leesGetal(v) : Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
}

function geheel(v, def = 0, min = 0) {
  return Math.max(min, Math.round(num(v, def, min)));
}

function compact(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

/** kg/m voor staafdiameter d (mm). */
export function massaPerMeter(diameter) {
  const d = num(diameter, 0, 0);
  return MASSA_FACTOR * d * d;
}

/**
 * Doorndiameter (binnendiameter van de buiging) volgens NEN-EN 1992-1-1
 * tabel 8.1N voor staven en beugels: Ø ≤ 16 → 4Ø, Ø > 16 → 7Ø.
 */
export function buigdoornDiameter(diameter) {
  const d = num(diameter, 0, 0);
  return d <= 16 ? 4 * d : 7 * d;
}

/**
 * Notatie van een staaf of reeks op tekening:
 *   aantal + afstand → "12Ø10-150"
 *   alleen aantal    → "4Ø12"
 *   alleen afstand   → "Ø10-150"
 */
export function staafNotatie({ aantal, diameter, afstand } = {}) {
  const n = geheel(aantal, 0, 0);
  const d = compact(num(diameter, 0, 0));
  const s = num(afstand, 0, 0);
  return `${n > 0 ? n : ''}Ø${d}${s > 0 ? `-${compact(s)}` : ''}`;
}

/** Volledig staaflabel: "12Ø10-150 lg=2450" (lengte optioneel). */
export function staafLabel({ aantal, diameter, afstand, lengteMm } = {}) {
  const basis = staafNotatie({ aantal, diameter, afstand });
  const L = num(lengteMm, 0, 0);
  return L > 0 ? `${basis} lg=${compact(L)}` : basis;
}

/** Aantal staven over een verdeelbreedte bij een h.o.h.-afstand (incl. beide randen). */
export function aantalOverBreedte(breedteMm, afstandMm) {
  const b = num(breedteMm, 0, 0);
  const s = num(afstandMm, 0, 0);
  if (!(s > 0) || !(b >= 0)) return 0;
  return Math.floor(b / s + 1e-9) + 1;
}

// ─── Buigvormen ──────────────────────────────────────────────────────────
// Vormcodes volgen het nummerprincipe van NEN-EN ISO 3766: het eerste cijfer
// is het aantal bochten, het tweede het type. Maten zijn BUITENmaten.

export const BUIGVORMEN = {
  '00': { naam: 'Recht', naamEn: 'Straight', segmenten: ['a'] },
  '11': { naam: 'Haakstaaf (L, 90°)', naamEn: 'L-bar (90°)', segmenten: ['a', 'b'] },
  '21': { naam: 'U-staaf (2 × 90°)', naamEn: 'U-bar (2 × 90°)', segmenten: ['a', 'b', 'c'] },
  '51': { naam: 'Gesloten beugel (135°-haken)', naamEn: 'Closed stirrup (135° hooks)', segmenten: ['a', 'b'] },
};

// Vaste volgorde: '00' is geen array-index en zou anders achteraan komen.
export const VORMCODES = ['00', '11', '21', '51'];

export function normaliseerVormcode(code) {
  const c = String(code ?? '').trim().padStart(2, '0');
  return BUIGVORMEN[c] ? c : '00';
}

/**
 * Lengteaftrek per 90°-bocht bij buitenmaten: 2(r+d) − π/2·(r+d/2),
 * met r = de halve doorndiameter.
 */
export function bochtAftrek90(diameter, doornDiameter = buigdoornDiameter(diameter)) {
  const d = num(diameter, 0, 0);
  const r = num(doornDiameter, 0, 0) / 2;
  return 2 * (r + d) - (Math.PI / 2) * (r + d / 2);
}

/** Standaard haakverlengte van een 135°-beugelhaak: 10Ø (≥ EC2-minimum 5Ø, 50 mm). */
export function standaardHaaklengte(diameter) {
  return Math.max(10 * num(diameter, 0, 0), 50);
}

/**
 * Ontwikkelde staaflengte (mm, naar boven afgerond op LENGTE_AFRONDING_MM).
 *
 * @param {string} vormcode  '00' | '11' | '21' | '51'
 * @param {{a?:number,b?:number,c?:number}} seg  buitenmaten in mm
 * @param {number} diameter  staafdiameter in mm
 * @param {{doorn?:number, haaklengte?:number, afronden?:boolean}} [opts]
 */
export function staafLengte(vormcode, seg = {}, diameter = 10, opts = {}) {
  const code = normaliseerVormcode(vormcode);
  const d = num(diameter, 10, 0);
  const doorn = num(opts.doorn, 0, 0) > 0 ? num(opts.doorn) : buigdoornDiameter(d);
  const a = num(seg.a, 0, 0);
  const b = num(seg.b, 0, 0);
  const c = num(seg.c, 0, 0);
  const aftrek = bochtAftrek90(d, doorn);
  let L;
  switch (code) {
    case '11': L = a + b - aftrek; break;
    case '21': L = a + b + c - 2 * aftrek; break;
    case '51': {
      // Rondom vier zijden (buitenmaat a × b), drie hoeken van 90° en twee
      // haken van 135° in dezelfde hoek, elk met een rechte verlenging.
      const r = doorn / 2;
      const haak = num(opts.haaklengte, 0, 0) > 0 ? num(opts.haaklengte) : standaardHaaklengte(d);
      const recht = 2 * a + 2 * b - 8 * (r + d);
      const boog90 = (Math.PI / 2) * (r + d / 2);
      const boog135 = (3 * Math.PI / 4) * (r + d / 2);
      L = recht + 3 * boog90 + 2 * (boog135 + haak);
      break;
    }
    default: L = a;
  }
  L = Math.max(0, L);
  if (opts.afronden === false) return L;
  return Math.ceil(L / LENGTE_AFRONDING_MM - 1e-9) * LENGTE_AFRONDING_MM;
}

// ─── Staven verzamelen ───────────────────────────────────────────────────

/**
 * Eén staafpositie in genormaliseerde vorm.
 * @returns {{staafnummer:string, diameter:number, aantal:number, lengteMm:number,
 *   vormcode:string, staalkwaliteit:string, afstand:number, omschrijving:string}}
 */
export function normaliseerStaaf(s = {}) {
  const kw = String(s.staalkwaliteit || '').trim().toUpperCase();
  return {
    staafnummer: String(s.staafnummer ?? '').trim(),
    diameter: num(s.diameter, 0, 0),
    aantal: geheel(s.aantal, 0, 0),
    lengteMm: Math.round(num(s.lengteMm, 0, 0)),
    vormcode: normaliseerVormcode(s.vormcode),
    staalkwaliteit: kw || STANDAARD_STAALKWALITEIT,
    afstand: num(s.afstand, 0, 0),
    omschrijving: String(s.omschrijving ?? ''),
  };
}

/**
 * Staven uit één annotatie. Een stavenreeks draagt zijn waarden zelf
 * (aantal, diameter, staaflengte, staafnummer `barMark` en staalkwaliteit
 * `steelGrade`, beide in te stellen in het eigenschappenpaneel); een
 * parametrisch symbool levert ze via `template.rebarItems(params)`. Een staaf
 * zonder lengte (een stavenreeks zonder staaflengte) komt niet in de staat:
 * een regel van 0 mm en 0 kg zegt niets.
 * @param {object} ann
 * @param {(id:string)=>object|null} getTemplate
 */
export function stavenVanAnnotatie(ann, getTemplate) {
  if (!ann || typeof ann !== 'object') return [];
  let ruw = [];
  if (ann.type === 'stavenreeks') {
    ruw = [{
      staafnummer: ann.barMark ?? '',
      diameter: ann.diameter ?? 12,
      aantal: ann.count ?? 3,
      lengteMm: ann.barLengthMm ?? 0,
      vormcode: '00',
      staalkwaliteit: ann.steelGrade || STANDAARD_STAALKWALITEIT,
    }];
  } else if (ann.type === 'parametricSymbol' && typeof getTemplate === 'function') {
    const tpl = getTemplate(ann.symbolId);
    if (tpl && typeof tpl.rebarItems === 'function') {
      try { ruw = tpl.rebarItems(ann.params || {}) || []; } catch { ruw = []; }
    }
  }
  return ruw
    .map(normaliseerStaaf)
    .filter((s) => s.aantal > 0 && s.diameter > 0 && s.lengteMm > 0)
    .map((s) => ({ ...s, bron: { id: ann.id ?? null, page: ann.page || 1, type: ann.type, symbolId: ann.symbolId || null } }));
}

/** Alle staven uit een annotatielijst. */
export function stavenVanAnnotaties(annotaties, getTemplate) {
  const uit = [];
  for (const a of annotaties || []) uit.push(...stavenVanAnnotatie(a, getTemplate));
  return uit;
}

function vormSleutel(s) {
  return `${s.diameter}|${s.vormcode}|${s.lengteMm}|${s.staalkwaliteit}`;
}

/**
 * Geeft staven zonder eigen staafnummer een vrij volgnummer. Gelijke staven
 * (zelfde Ø, vorm, lengte en kwaliteit) krijgen hetzelfde nummer; de
 * nummering begint na het hoogste handmatige nummer.
 */
export function nummerStaven(staven) {
  const lijst = (staven || []).map((s) => ({ ...s }));
  let hoogste = 0;
  const bestaand = new Map();
  for (const s of lijst) {
    if (!s.staafnummer) continue;
    const n = Number(s.staafnummer);
    if (Number.isInteger(n) && n > hoogste) hoogste = n;
    if (!bestaand.has(vormSleutel(s))) bestaand.set(vormSleutel(s), s.staafnummer);
  }
  const toegekend = new Map();
  for (const s of lijst) {
    if (s.staafnummer) continue;
    const k = vormSleutel(s);
    if (!toegekend.has(k)) {
      hoogste += 1;
      toegekend.set(k, String(hoogste));
    }
    s.staafnummer = toegekend.get(k);
    s.automatischNummer = true;
  }
  return lijst;
}

function nummerVolgorde(a, b) {
  const na = Number(a), nb = Number(b);
  const ia = Number.isFinite(na), ib = Number.isFinite(nb);
  if (ia && ib) return na - nb;
  if (ia) return -1;
  if (ib) return 1;
  return String(a).localeCompare(String(b));
}

/**
 * Buigstaat: staven samengevoegd per positie (staafnummer + Ø + vorm +
 * lengte + kwaliteit). Draagt één staafnummer verschillende staven, dan
 * krijgen die regels `conflict: true`.
 * @returns {Array<{staafnummer, diameter, vormcode, lengteMm, aantal,
 *   staalkwaliteit, totaleLengteM, massaPerMeter, massaKg, paginas, conflict}>}
 */
export function buigstaatRegels(staven) {
  const genummerd = nummerStaven(staven);
  const regels = new Map();
  for (const s of genummerd) {
    const k = `${s.staafnummer}#${vormSleutel(s)}`;
    let r = regels.get(k);
    if (!r) {
      r = {
        staafnummer: s.staafnummer,
        diameter: s.diameter,
        vormcode: s.vormcode,
        lengteMm: s.lengteMm,
        staalkwaliteit: s.staalkwaliteit,
        aantal: 0,
        paginas: [],
        bronnen: [],
        conflict: false,
      };
      regels.set(k, r);
    }
    r.aantal += s.aantal;
    const p = s.bron?.page;
    if (p && !r.paginas.includes(p)) r.paginas.push(p);
    if (s.bron?.id != null && !r.bronnen.includes(s.bron.id)) r.bronnen.push(s.bron.id);
  }
  const lijst = [...regels.values()];
  const perNummer = new Map();
  for (const r of lijst) perNummer.set(r.staafnummer, (perNummer.get(r.staafnummer) || 0) + 1);
  for (const r of lijst) {
    r.conflict = perNummer.get(r.staafnummer) > 1;
    r.paginas.sort((a, b) => a - b);
    r.massaPerMeter = massaPerMeter(r.diameter);
    r.totaleLengteM = (r.aantal * r.lengteMm) / 1000;
    r.massaKg = r.totaleLengteM * r.massaPerMeter;
  }
  return lijst.sort((a, b) => nummerVolgorde(a.staafnummer, b.staafnummer)
    || a.diameter - b.diameter || a.lengteMm - b.lengteMm);
}

/**
 * Gewichtsstaat per diameter uit buigstaat-regels.
 * @returns {{perDiameter: Array<{diameter, totaleLengteM, massaPerMeter, massaKg}>, totaalKg:number, totaleLengteM:number}}
 */
export function gewichtPerDiameter(regels) {
  const m = new Map();
  for (const r of regels || []) {
    const d = r.diameter;
    const lengteM = typeof r.totaleLengteM === 'number' ? r.totaleLengteM : (r.aantal * r.lengteMm) / 1000;
    const e = m.get(d) || { diameter: d, totaleLengteM: 0, massaPerMeter: massaPerMeter(d), massaKg: 0 };
    e.totaleLengteM += lengteM;
    e.massaKg = e.totaleLengteM * e.massaPerMeter;
    m.set(d, e);
  }
  const perDiameter = [...m.values()].sort((a, b) => a.diameter - b.diameter);
  return {
    perDiameter,
    totaleLengteM: perDiameter.reduce((s, e) => s + e.totaleLengteM, 0),
    totaalKg: perDiameter.reduce((s, e) => s + e.massaKg, 0),
  };
}

/**
 * Pseudo-elementen voor de hoeveelheden-engine: één per buigstaat-regel, in
 * de categorie 'reinforcement'. Zo vullen de standaardsjablonen "Buigstaat"
 * en "Wapeningsstaat" zich met dezelfde regels als buigstaatRegels().
 */
export function wapeningsElementen(annotaties, getTemplate) {
  const regels = buigstaatRegels(stavenVanAnnotaties(annotaties, getTemplate));
  return regels.map((r, i) => ({
    id: `rebar-${r.staafnummer}-${i}`,
    __category: 'reinforcement',
    type: 'rebarPosition',
    page: r.paginas[0] || 1,
    label: staafLabel({ aantal: r.aantal, diameter: r.diameter, lengteMm: r.lengteMm }),
    rebar: r,
  }));
}
