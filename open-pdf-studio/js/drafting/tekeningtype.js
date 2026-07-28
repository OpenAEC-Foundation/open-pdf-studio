// Tekeningtype (regelset) — PURE datamodel- en resolutiemodule (geen UI-,
// DOM- of app-state-imports; los testbaar onder node --test).
//
// Een TEKENINGTYPE is een benoemde regelset die bepaalt hoe de NL-
// tekenwerkcomponenten (parametrische symbolen, stavenreeks, betonbalk)
// tekenen: teksthoogtes per tekstsoort en lijndikte per IFC-categorie.
// Regelsets zijn DATA (JSON in de app-preferences), geen code.
//
// Ontwerpkeuzes (overgenomen uit het Open 2D Studio 1.0-onderzoek, zie
// docs/superpowers/specs/2026-07-28-nl-ifc-tekenlaag-design.md):
//
//  1. PER-SCHAAL-TABELLEN. Schaalafhankelijke waarden staan als
//     `Record<schaalKey, waarde>` met schaalKey = 1/N als string
//     ("0.01" = 1:100, "0.02" = 1:50). Ontbreekt de gevraagde schaal, dan
//     geldt de DICHTSTBIJZIJNDE schaal in LOG-ruimte (nearest-scale-
//     terugval): log-afstand omdat schalen meetkundig lopen (1:50 ligt
//     even ver van 1:100 als 1:100 van 1:200).
//  2. TWEE-LAGEN-OVERERVING. `default` (categorie-laag) → specifieke
//     IFC-categorie (override-laag); een expliciet op de ANNOTATIE gezette
//     waarde wint altijd van beide (dat regelt de aanroeper: een gezette
//     `ann.lineWidth` betekent "eigen instelling").
//  3. STABIELE ID'S. Regelsets worden op `id` gerefereerd (schaalgebied →
//     tekeningtypeId), nooit op naam; hernoemen breekt niets.
//  4. GEVERSIONEERDE DATA MET MIGRATIEKETEN. `version` + MIGRATIONS zodat
//     latere uitbreidingen (arcering per categorie, meer tekstsoorten)
//     oude opgeslagen instellingen nooit breken.
//
// EENHEDEN: alle regelset-waarden zijn PAPIER-millimeters (de maat op de
// afdruk, onafhankelijk van de tekeningschaal). Omrekening naar app-px
// (PDF-punten op schaal 1) is de vaste constante MM_TO_PX = 72/25,4 — de
// pagina ís het papier. Het SCHAALGEBIED bepaalt dus niet de omrekening,
// maar WELKE kolom uit de per-schaal-tabel geldt (via scaleKey).

/** Huidige versie van de opgeslagen tekeningtype-data. */
export const TEKENINGTYPE_VERSION = 1;

/** Papier-mm → app-px (PDF-punten, 1 pt = 1/72 inch = 25,4/72 mm). */
export const MM_TO_PX = 72 / 25.4;

/** Tekstsoorten die een regelset kent (papier-mm hoofdletterhoogte). */
export const TEKST_SOORTEN = ['labels', 'maatvoering', 'titels'];

/** Standaard-schaalsleutel (1:100) — de gangbare tekeningschaal. */
export const DEFAULT_SCALE_KEY = '0.01';

/**
 * schaalKey uit een scaleString: "1:100" → "0.01". Ongeldige invoer →
 * DEFAULT_SCALE_KEY. De key is bewust een string (stabiel als object-sleutel,
 * geen float-drift in JSON).
 */
export function scaleKeyFromScaleString(scaleString) {
  const m = String(scaleString || '').match(/^\s*(\d+(?:[.,]\d+)?)\s*[:/]\s*(\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return DEFAULT_SCALE_KEY;
  const a = parseFloat(m[1].replace(',', '.'));
  const b = parseFloat(m[2].replace(',', '.'));
  if (!(a > 0) || !(b > 0)) return DEFAULT_SCALE_KEY;
  const ratio = a / b;
  if (!Number.isFinite(ratio) || !(ratio > 0)) return DEFAULT_SCALE_KEY;
  // Compact decimaal (geen wetenschappelijke notatie voor gangbare schalen).
  return String(ratio);
}

/**
 * Dichtstbijzijnde aanwezige schaalsleutel, in LOG-ruimte.
 * @param {string[]} keys       Aanwezige sleutels ("0.01", "0.02", …).
 * @param {string} targetKey    Gevraagde sleutel.
 * @returns {string|null}       Beste sleutel, of null bij lege lijst.
 */
export function nearestScaleKey(keys, targetKey) {
  const valid = (keys || []).filter(k => Number(k) > 0);
  if (valid.length === 0) return null;
  const t = Number(targetKey);
  if (!(t > 0)) return valid[0];
  const logT = Math.log(t);
  let best = valid[0];
  let bestD = Infinity;
  for (const k of valid) {
    const d = Math.abs(Math.log(Number(k)) - logT);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

/**
 * Waarde uit een per-schaal-tabel met nearest-scale-terugval.
 * @param {Record<string, number>} table
 * @param {string} scaleKey
 * @returns {number|null}
 */
export function resolveScaleValue(table, scaleKey) {
  if (!table || typeof table !== 'object') return null;
  const exact = Number(table[scaleKey]);
  if (Number.isFinite(exact) && exact > 0) return exact;
  const k = nearestScaleKey(Object.keys(table), scaleKey);
  if (k == null) return null;
  const v = Number(table[k]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Lijndikte (PAPIER-mm) voor een IFC-categorie op een schaal.
 * Twee-lagen-overerving: specifieke categorie-tabel → `default`-tabel.
 * @returns {number|null} mm, of null als de regelset niets voorschrijft.
 */
export function resolveLineWidthMm(regelset, ifcCategory, scaleKey = DEFAULT_SCALE_KEY) {
  const tables = regelset?.lineWidthsMm;
  if (!tables || typeof tables !== 'object') return null;
  const cat = String(ifcCategory || '');
  const specific = resolveScaleValue(tables[cat], scaleKey);
  if (specific != null) return specific;
  return resolveScaleValue(tables.default, scaleKey);
}

/**
 * Teksthoogte (PAPIER-mm) voor een tekstsoort ('labels' | 'maatvoering' |
 * 'titels'). Teksthoogtes zijn papier-constant en dus NIET per schaal.
 * @returns {number|null}
 */
export function resolveTextHeightMm(regelset, soort) {
  const v = Number(regelset?.textHeightsMm?.[soort]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Standaard-regelset "Constructieplattegrond"
// ---------------------------------------------------------------------------

/**
 * Meegeleverde NL-standaardwaarden. Lijndiktes volgen de gangbare
 * tekenkamer-pennenreeks (0,13/0,18/0,25/0,35/0,50/0,70): dragende
 * betondelen (balk/kolom/wand) op 0,50; staal, vloeren en palen op 0,35;
 * wapening en overige elementen op 0,25; maat-/annotatiewerk op 0,18.
 * Alle tabellen zijn geseed op 1:100; andere schalen erven via de
 * nearest-scale-terugval tot de gebruiker per schaal differentieert.
 */
export function createDefaultRegelset() {
  const at100 = (mm) => ({ [DEFAULT_SCALE_KEY]: mm });
  return {
    id: 'tt-constructieplattegrond',
    name: 'Constructieplattegrond',
    textHeightsMm: { labels: 2.5, maatvoering: 2.0, titels: 3.5 },
    lineWidthsMm: {
      default: at100(0.25),
      IfcBeam: at100(0.5),
      IfcColumn: at100(0.5),
      IfcWall: at100(0.5),
      IfcSlab: at100(0.35),
      IfcMember: at100(0.35),
      IfcPile: at100(0.35),
      IfcMechanicalFastener: at100(0.25),
      IfcReinforcingBar: at100(0.25),
      IfcGrid: at100(0.18),
      IfcAnnotation: at100(0.18),
    },
    // Gereserveerde plek voor fase 2+ (arcering per IFC-categorie).
    hatchByCategory: {},
  };
}

/** Volledige standaard-datastructuur (version 1). */
export function createDefaultTekeningtypenData() {
  const std = createDefaultRegelset();
  return {
    version: TEKENINGTYPE_VERSION,
    defaultId: std.id,
    regelsets: [std],
  };
}

// ---------------------------------------------------------------------------
// Migratieketen
// ---------------------------------------------------------------------------

// MIGRATIONS[n] migreert data van versie n naar versie n+1. Versie 1 is de
// eerste; het skelet staat er zodat een latere versie 2 alleen een functie
// hoeft toe te voegen — oude opgeslagen presets breken dan nooit.
const MIGRATIONS = {
  // 1: (data) => ({ ...data, version: 2, ... })
};

/**
 * Normaliseer/migreer opgeslagen tekeningtype-data naar de huidige versie.
 * Ontbrekende of onbruikbare data → verse defaults. Een NIEUWERE versie dan
 * deze build kent wordt ongemoeid teruggegeven (nooit destructief afwaarderen).
 * Puur: muteert de invoer niet.
 */
export function migrateTekeningtypen(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.regelsets)) {
    return createDefaultTekeningtypenData();
  }
  let d = data;
  let v = Number(d.version) || 1;
  if (v > TEKENINGTYPE_VERSION) return d; // nieuwer dan wij kennen: laten staan
  while (v < TEKENINGTYPE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break;
    d = step(d);
    v = Number(d.version) || v + 1;
  }
  // Sanering (idempotent): geldige regelsets, defaultId moet bestaan.
  const regelsets = d.regelsets.filter(r => r && typeof r === 'object' && r.id);
  if (regelsets.length === 0) return createDefaultTekeningtypenData();
  const defaultId = regelsets.some(r => r.id === d.defaultId)
    ? d.defaultId : regelsets[0].id;
  if (d === data && d.version === TEKENINGTYPE_VERSION
      && defaultId === d.defaultId && regelsets.length === d.regelsets.length) {
    return data; // niets te doen — zelfde referentie terug (goedkope no-op)
  }
  return { ...d, version: TEKENINGTYPE_VERSION, defaultId, regelsets };
}

// ---------------------------------------------------------------------------
// Kleine pure hulpjes voor het instellingenpaneel
// ---------------------------------------------------------------------------

/** Nieuw stabiel regelset-id. */
export function newRegelsetId() {
  return 'tt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Diepe kopie van een regelset onder een nieuw id/naam (puur). */
export function duplicateRegelset(regelset, name) {
  const copy = JSON.parse(JSON.stringify(regelset || {}));
  copy.id = newRegelsetId();
  copy.name = String(name || `${regelset?.name || 'Regelset'} (kopie)`);
  return copy;
}
