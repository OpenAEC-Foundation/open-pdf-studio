// Draagstructuur op een constructieraster — PURE module (geen UI-, DOM- of
// app-state-imports; los testbaar onder node --test).
//
// Uit een raster (zie raster.js) volgen de dragende delen:
//   - KOLOMMEN op de knopen,
//   - BALKEN op de rasterlijnen tussen twee knopen,
//   - VLOERVELDEN in de vakken, met een overspanningsrichting.
//
// Elk element krijgt een POSITIENUMMER dat uit de volgorde volgt en dus bij
// een tweede doorloop hetzelfde is. Niets wordt geraden.

import { RasterFout } from './raster.js';

/** Standaard-voorvoegsels per elementsoort (NL tekenkamer). */
export const VOORVOEGSELS = { kolom: 'K', balk: 'L', vloer: 'V' };

// Stalen profielfamilies: invoernaam → template-id + de `maat`-waarde die het
// parametrische symbool verwacht (zie symbols/templates/staalprofiel.js).
const STAAL_FAMILIES = {
  HEA: 'staal-hea',
  HEB: 'staal-heb',
  IPE: 'staal-ipe',
  UNP: 'staal-unp',
};

/**
 * Ontleed een profielaanduiding.
 *
 * Herkend:
 *   "HE200B", "HE 200 A"          → HEB 200 / HEA 200 (NL schrijfwijze)
 *   "HEB200", "HEB 200", "IPE300" → de familie met zijn maat
 *   "Koker 100x100x5"             → stalen koker
 *   "L 100x100x10"                → hoeklijn
 *   "300x500"                     → betondoorsnede breedte × hoogte (mm)
 *
 * @param {string} tekst
 * @returns {{soort:'staal'|'beton', naam:string, symbolId?:string, maat?:string,
 *            breedteMm?:number, hoogteMm?:number}}
 */
export function ontleedProfiel(tekst) {
  const ruw = String(tekst ?? '').trim();
  if (!ruw) throw new RasterFout('profiel', 'profielaanduiding ontbreekt');

  // NL schrijfwijze met de letter achteraan: HE200B, HE 200 A.
  const nl = ruw.match(/^HE\s*-?\s*(\d+)\s*([AB])$/i);
  if (nl) {
    const familie = `HE${nl[2].toUpperCase()}`;
    return staalProfiel(familie, nl[1]);
  }

  const familie = ruw.match(/^(HEA|HEB|IPE|UNP)\s*-?\s*(\d+)$/i);
  if (familie) return staalProfiel(familie[1].toUpperCase(), familie[2]);

  const koker = ruw.match(/^(?:koker|buis|SHS|RHS)\s*-?\s*(\d+\s*x\s*\d+\s*x\s*\d+(?:[.,]\d+)?)$/i);
  if (koker) {
    const maat = `Koker ${koker[1].replace(/\s+/g, '').replace(',', '.')}`;
    return { soort: 'staal', naam: maat, symbolId: 'staal-koker', maat };
  }

  const hoeklijn = ruw.match(/^(?:L|hoeklijn)\s*-?\s*(\d+\s*x\s*\d+\s*x\s*\d+(?:[.,]\d+)?)$/i);
  if (hoeklijn) {
    const maat = `L ${hoeklijn[1].replace(/\s+/g, '').replace(',', '.')}`;
    return { soort: 'staal', naam: maat, symbolId: 'staal-hoeklijn', maat };
  }

  const beton = ruw.match(/^(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)$/);
  if (beton) {
    const breedteMm = parseFloat(beton[1].replace(',', '.'));
    const hoogteMm = parseFloat(beton[2].replace(',', '.'));
    if (!(breedteMm > 0) || !(hoogteMm > 0)) {
      throw new RasterFout('profiel', `onbruikbare doorsnede: ${ruw}`);
    }
    return {
      soort: 'beton',
      naam: `${Math.round(breedteMm)}x${Math.round(hoogteMm)}`,
      breedteMm, hoogteMm,
    };
  }

  throw new RasterFout('profiel', `onbekend profiel: ${ruw} (verwacht bijvoorbeeld "HE200B", "IPE 300", "Koker 100x100x5" of "300x500")`);
}

function staalProfiel(familie, maatGetal) {
  const symbolId = STAAL_FAMILIES[familie];
  if (!symbolId) throw new RasterFout('profiel', `onbekende staalfamilie: ${familie}`);
  const maat = `${familie} ${Number(maatGetal)}`;
  return { soort: 'staal', naam: maat, symbolId, maat };
}

/** Peilmaat als tekenkamer-tekst: 3000 mm → "+3.000", -500 → "-0.500". */
export function peilTekst(peilMm) {
  if (peilMm == null || peilMm === '') return '';
  const n = Number(peilMm);
  if (!Number.isFinite(n)) return '';
  const teken = n < 0 ? '-' : '+';
  const meters = Math.abs(n) / 1000;
  const heel = Math.floor(meters);
  const rest = Math.round((meters - heel) * 1000);
  // Afronding kan 999,6 mm naar 1000 tillen; dan schuift de hele meter mee.
  if (rest === 1000) return `${teken}${heel + 1}.000`;
  return `${teken}${heel}.${String(rest).padStart(3, '0')}`;
}

function knoopOp(raster, ix, iy) {
  return raster.knopen.find(k => k.ix === ix && k.iy === iy) || null;
}

/**
 * Kolommen op de rasterknopen, genummerd in leesvolgorde (rij voor rij van
 * boven naar beneden, binnen een rij van links naar rechts).
 *
 * @param {object} raster        Uitvoer van maakRaster().
 * @param {object} [opts]
 * @param {string} [opts.profiel='HE200B']
 * @param {string} [opts.voorvoegsel='K']
 * @param {number} [opts.peilMm]      Bovenkant kolom (werkelijke mm t.o.v. peil).
 * @param {string[]} [opts.overslaan]  Knooplabels die leeg blijven (bv. ['A-1']).
 */
export function kolommen(raster, opts = {}) {
  const profiel = ontleedProfiel(opts.profiel ?? 'HE200B');
  const voorvoegsel = opts.voorvoegsel || VOORVOEGSELS.kolom;
  const overslaan = new Set((opts.overslaan || []).map(String));
  const peilMm = Number.isFinite(Number(opts.peilMm)) ? Number(opts.peilMm) : null;

  const uit = [];
  for (const knoop of raster.knopen) {
    if (overslaan.has(knoop.label)) continue;
    uit.push({
      soort: 'kolom',
      id: `${voorvoegsel}${uit.length + 1}`,
      knoop: knoop.label,
      x: knoop.x, y: knoop.y,
      profiel, peilMm,
      ifcCategory: 'IfcColumn',
    });
  }
  return uit;
}

/**
 * Balken op de rasterlijnen, tussen elk paar naast elkaar liggende knopen.
 * `richting` bepaalt welke lijnen meedoen: 'x' (langs de horizontale
 * rasterlijnen), 'y' (langs de verticale) of 'beide'.
 *
 * @param {object} raster
 * @param {object} [opts]
 * @param {string} [opts.profiel='300x500']
 * @param {'x'|'y'|'beide'} [opts.richting='beide']
 * @param {string} [opts.voorvoegsel='L']
 * @param {number} [opts.peilMm]
 * @param {boolean} [opts.alleenRand=false]  Alleen de buitenste lijnen (rand-
 *        liggers); binnenliggende rasterlijnen blijven leeg.
 */
export function balken(raster, opts = {}) {
  const profiel = ontleedProfiel(opts.profiel ?? '300x500');
  const voorvoegsel = opts.voorvoegsel || VOORVOEGSELS.balk;
  const richting = opts.richting || 'beide';
  if (!['x', 'y', 'beide'].includes(richting)) {
    throw new RasterFout('richting', `onbekende balkrichting: ${richting} (verwacht 'x', 'y' of 'beide')`);
  }
  const peilMm = Number.isFinite(Number(opts.peilMm)) ? Number(opts.peilMm) : null;
  const alleenRand = opts.alleenRand === true;

  const uit = [];
  const laatsteX = raster.lijnenX.length - 1;
  const laatsteY = raster.lijnenY.length - 1;

  const voegToe = (a, b, as, overspanningMm) => {
    uit.push({
      soort: 'balk',
      id: `${voorvoegsel}${uit.length + 1}`,
      as, van: a.label, naar: b.label,
      startX: a.x, startY: a.y, endX: b.x, endY: b.y,
      overspanningMm, profiel, peilMm,
      ifcCategory: 'IfcBeam',
    });
  };

  if (richting === 'x' || richting === 'beide') {
    for (let iy = 0; iy <= laatsteY; iy++) {
      if (alleenRand && iy !== 0 && iy !== laatsteY) continue;
      for (let ix = 0; ix < laatsteX; ix++) {
        voegToe(knoopOp(raster, ix, iy), knoopOp(raster, ix + 1, iy), 'x', raster.veldenX[ix]);
      }
    }
  }
  if (richting === 'y' || richting === 'beide') {
    for (let ix = 0; ix <= laatsteX; ix++) {
      if (alleenRand && ix !== 0 && ix !== laatsteX) continue;
      for (let iy = 0; iy < laatsteY; iy++) {
        voegToe(knoopOp(raster, ix, iy), knoopOp(raster, ix, iy + 1), 'y', raster.veldenY[iy]);
      }
    }
  }
  return uit;
}

/**
 * Vloervelden in de rastervakken, met overspanningsrichting en overspanning.
 *
 * @param {object} raster
 * @param {object} [opts]
 * @param {'x'|'y'|'kortste'} [opts.richting='kortste']  'kortste' laat de vloer
 *        overspannen over de kleinste vakmaat — wat een vloer in de praktijk doet.
 * @param {number} [opts.dikteMm]
 * @param {number} [opts.peilMm]     Bovenkant vloer (werkelijke mm).
 * @param {string} [opts.voorvoegsel='V']
 */
export function vloervelden(raster, opts = {}) {
  const richting = opts.richting || 'kortste';
  if (!['x', 'y', 'kortste'].includes(richting)) {
    throw new RasterFout('richting', `onbekende overspanningsrichting: ${richting} (verwacht 'x', 'y' of 'kortste')`);
  }
  const voorvoegsel = opts.voorvoegsel || VOORVOEGSELS.vloer;
  const dikteMm = Number.isFinite(Number(opts.dikteMm)) ? Number(opts.dikteMm) : null;
  const peilMm = Number.isFinite(Number(opts.peilMm)) ? Number(opts.peilMm) : null;

  return raster.velden.map((veld, i) => {
    const as = richting === 'kortste'
      ? (veld.breedteMm <= veld.hoogteMm ? 'x' : 'y')
      : richting;
    return {
      soort: 'vloer',
      id: `${voorvoegsel}${i + 1}`,
      veld: veld.label,
      x: veld.x, y: veld.y, breedte: veld.breedte, hoogte: veld.hoogte,
      midden: { ...veld.midden },
      overspanningsrichting: as,
      overspanningMm: as === 'x' ? veld.breedteMm : veld.hoogteMm,
      breedteMm: veld.breedteMm, hoogteMm: veld.hoogteMm,
      dikteMm, peilMm,
      ifcCategory: 'IfcSlab',
    };
  });
}
