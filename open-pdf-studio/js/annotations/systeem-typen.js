// Systeemtypen — PURE datamodel- en migratie-module (geen UI-, DOM- of
// app-state-imports; los testbaar onder node --test).
//
// Een SYSTEEMTYPE is een benoemde, HERBRUIKBARE definitie van een
// vlakvullend systeem (systeemplafond, bandraster, platenveld, later
// wanden): celmaat, randprofiel en IFC-mapping. Zelfde ontwerpkeuzes als
// de tekeningtype-regelsets (js/drafting/tekeningtype.js):
//
//  1. TYPE ≠ INSTANCE. De getekende annotatie (instance) verwijst met
//     `systeemTypeId` naar de definitie en draagt zelf alleen
//     instantie-eigen data: contour, rasteroorsprong, rasterhoek en
//     paneel-OVERRIDES. Type bewerken → alle instanties veranderen mee.
//  2. STABIELE ID'S. Referentie op `id`, nooit op naam.
//  3. GEVERSIONEERDE DATA MET MIGRATIEKETEN (version + MIGRATIONS).
//  4. GENERIEK. 'plafond' is geen speciaal geval in de kernlogica: de
//     categorie en IFC-mapping zijn DATA op het type; latere categorieën
//     (wand, vloer) zijn gewoon nieuwe typen.
//
// Persistentie: de bibliotheek leeft in de app-preferences (zelfde
// mechanisme als tekeningtypen, zie systeem-typen-registry.js) én elke
// opgeslagen instantie draagt een JSON-SNAPSHOT van zijn type
// (OPS_SgTypeDef), zodat een PDF op een andere machine zijn typen
// meebrengt (de loader registreert onbekende typen bij).

/** Huidige versie van de opgeslagen systeemtype-data. */
export const SYSTEEMTYPE_VERSION = 1;

/** Randprofielen die een type kan voorschrijven (spiegel van
 *  SYSTEEM_EDGE_PROFIELEN in systeemraster.js — hier herhaald zodat deze
 *  module zelfstandig blijft). */
const EDGE_PROFIELEN = ['geen', 'hoeklijn', 'schaduwvoeg'];

/** Nieuw stabiel systeemtype-id. */
export function newSysteemTypeId() {
  return 'st-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Ingebouwde render-stijlen voor paneeltypes (spiegel van
 *  SYSTEEM_PANEEL_TYPES in systeemraster.js). */
const RENDER_STIJLEN = ['tegel', 'ventilatie', 'licht'];

/** Standaard-assortiment paneeltypes van een systeemtype. Het assortiment
 *  is DATA op het type: elk paneeltype = { id, naam, renderStijl }, zodat
 *  typen hun eigen paneel-aanbod hebben (bewerkbaar in de typebeheer-
 *  dialoog) en paneel-overrides op id verwijzen. */
export function createDefaultPaneelTypen() {
  return [
    { id: 'tegel', naam: 'Plafondtegel', renderStijl: 'tegel' },
    { id: 'ventilatie', naam: 'Ventilatiepaneel', renderStijl: 'ventilatie' },
    { id: 'licht', naam: 'Lichtpaneel', renderStijl: 'licht' },
  ];
}

/** Nieuw stabiel paneeltype-id. */
export function newPaneelTypeId() {
  return 'pt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Genormaliseerd assortiment: geldige entries, 'tegel' altijd aanwezig
// (dat is de default/reset-waarde van elke cel).
function _normalizePaneelTypen(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) continue;
    if (out.some(q => q.id === p.id)) continue;
    out.push({
      id: p.id,
      naam: String(p.naam || p.id),
      renderStijl: RENDER_STIJLEN.includes(p.renderStijl) ? p.renderStijl : 'tegel',
    });
  }
  if (out.length === 0) return createDefaultPaneelTypen();
  if (!out.some(p => p.id === 'tegel')) {
    out.unshift({ id: 'tegel', naam: 'Plafondtegel', renderStijl: 'tegel' });
  }
  return out;
}

/** Genormaliseerd type-object (puur): defaults ingevuld, rommel eruit. */
export function normalizeSysteemType(t) {
  if (!t || typeof t !== 'object' || !t.id) return null;
  const num = (v, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  return {
    id: String(t.id),
    naam: String(t.naam || t.id),
    // Categorie is DATA (plafond/vloer/wand/…): kernlogica switcht er niet op.
    categorie: String(t.categorie || 'plafond'),
    ifcCategory: String(t.ifcCategory || 'IfcCovering'),
    ifcPredefinedType: t.ifcPredefinedType ? String(t.ifcPredefinedType) : undefined,
    celXMm: num(t.celXMm, 600),
    celYMm: num(t.celYMm, 600),
    edgeProfiel: EDGE_PROFIELEN.includes(t.edgeProfiel) ? t.edgeProfiel : 'geen',
    // LAYOUT-VORM: 'raster' (cellen in twee richtingen) of 'strook'
    // (stroken van strookBreedteMm die in ÉÉN richting — de rasterhoek —
    // over de volledige overspanning lopen; kanaalplaatvloer).
    layout: t.layout === 'strook' ? 'strook' : 'raster',
    strookBreedteMm: num(t.strookBreedteMm, 1200),
    // SPARINGSREGELS (data op het type): t/m kleineSparingMaxMm = gewoon
    // gat; vanaf raveelVanafMm = raveelijzer (strook-layout); ertussen =
    // gat met verzwaarde randlijn.
    sparingRegels: {
      kleineSparingMaxMm: num(t.sparingRegels && t.sparingRegels.kleineSparingMaxMm, 400),
      raveelVanafMm: num(t.sparingRegels && t.sparingRegels.raveelVanafMm, 800),
    },
    // Paneel-assortiment van dit type (paneeltype-id's waar overrides naar
    // verwijzen); 'tegel' is altijd aanwezig.
    paneelTypen: _normalizePaneelTypen(t.paneelTypen),
    // Gereserveerd voor gelaagde systemen (v1: één impliciete laag).
    lagen: Array.isArray(t.lagen) ? t.lagen : [],
  };
}

/** Meegeleverde standaardtypen. */
export function createDefaultSysteemTypen() {
  return {
    version: SYSTEEMTYPE_VERSION,
    typen: [
      normalizeSysteemType({
        id: 'st-plafond-600x600', naam: 'Systeemplafond 600x600',
        categorie: 'plafond', ifcCategory: 'IfcCovering', ifcPredefinedType: 'CEILING',
        celXMm: 600, celYMm: 600, edgeProfiel: 'geen',
      }),
      normalizeSysteemType({
        id: 'st-plafond-600x1200', naam: 'Systeemplafond 600x1200',
        categorie: 'plafond', ifcCategory: 'IfcCovering', ifcPredefinedType: 'CEILING',
        celXMm: 600, celYMm: 1200, edgeProfiel: 'geen',
      }),
      normalizeSysteemType({
        id: 'st-bandraster-300x1200', naam: 'Bandraster 300x1200',
        categorie: 'plafond', ifcCategory: 'IfcCovering', ifcPredefinedType: 'CEILING',
        celXMm: 300, celYMm: 1200, edgeProfiel: 'geen',
      }),
      normalizeSysteemType({
        id: 'st-stelcon-2000x2000', naam: 'Stelconplaten 2000x2000',
        categorie: 'vloer', ifcCategory: 'IfcCovering', ifcPredefinedType: 'FLOORING',
        celXMm: 2000, celYMm: 2000, edgeProfiel: 'geen',
      }),
      // Kanaalplaatvloer: STROOK-layout — stroken van 1200 mm die in één
      // richting (de rasterhoek) over de volledige overspanning lopen;
      // sparingsregels volgens de gangbare praktijk (t/m 400 mm gewoon
      // gat, vanaf 800 mm raveelijzer).
      normalizeSysteemType({
        id: 'st-kanaalplaat-1200', naam: 'Kanaalplaatvloer 1200',
        categorie: 'vloer', ifcCategory: 'IfcSlab', ifcPredefinedType: 'FLOOR',
        layout: 'strook', strookBreedteMm: 1200,
        celXMm: 1200, celYMm: 1200, edgeProfiel: 'geen',
        sparingRegels: { kleineSparingMaxMm: 400, raveelVanafMm: 800 },
      }),
    ],
  };
}

// MIGRATIONS[n] migreert data van versie n naar n+1 (zelfde skelet als
// tekeningtype.js — latere versies breken oude opgeslagen typen nooit).
const MIGRATIONS = {
  // 1: (data) => ({ ...data, version: 2, ... })
};

/**
 * Normaliseer/migreer opgeslagen systeemtype-data. Ontbrekend/onbruikbaar →
 * verse defaults; nieuwer dan deze build kent → ongemoeid terug. Puur.
 */
export function migrateSysteemTypen(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.typen)) {
    return createDefaultSysteemTypen();
  }
  let d = data;
  let v = Number(d.version) || 1;
  if (v > SYSTEEMTYPE_VERSION) return d;
  while (v < SYSTEEMTYPE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break;
    d = step(d);
    v = Number(d.version) || v + 1;
  }
  const typen = d.typen.map(normalizeSysteemType).filter(Boolean);
  if (typen.length === 0) return createDefaultSysteemTypen();
  if (d === data && d.version === SYSTEEMTYPE_VERSION
      && typen.length === d.typen.length) {
    return data;
  }
  return { version: SYSTEEMTYPE_VERSION, typen };
}

/** Type op id uit een datastructuur, of null. */
export function findSysteemType(data, id) {
  if (!id || !data || !Array.isArray(data.typen)) return null;
  return data.typen.find(t => t && t.id === id) || null;
}

/**
 * Voeg een type(-snapshot) toe of vervang niets als het id al bestaat
 * (bestaande lokale definitie wint — de gebruiker kan hem bewust bewerkt
 * hebben). Puur: geeft nieuwe data terug (of dezelfde referentie als er
 * niets te doen is). Gebruikt door de loader voor PDF-meegereisde typen.
 */
export function mergeSysteemType(data, def) {
  const d = migrateSysteemTypen(data);
  const norm = normalizeSysteemType(def);
  if (!norm) return d;
  if (findSysteemType(d, norm.id)) return d;
  return { ...d, typen: [...d.typen, norm] };
}

/**
 * Werk een bestaand type bij (puur): geeft nieuwe data terug. Onbekend id →
 * ongewijzigde data. `patch` wordt genormaliseerd over het bestaande type.
 */
export function updateSysteemTypeIn(data, id, patch) {
  const d = migrateSysteemTypen(data);
  const idx = d.typen.findIndex(t => t && t.id === id);
  if (idx < 0) return d;
  const next = normalizeSysteemType({ ...d.typen[idx], ...patch, id });
  const typen = d.typen.slice();
  typen[idx] = next;
  return { ...d, typen };
}

/** Diepe kopie van een type onder een nieuw stabiel id/naam (puur) —
 *  zelfde patroon als duplicateRegelset in drafting/tekeningtype.js. */
export function duplicateSysteemType(t, naam) {
  const copy = normalizeSysteemType(t) || normalizeSysteemType({ id: 'st-x' });
  copy.id = newSysteemTypeId();
  copy.naam = String(naam || `${t?.naam || 'Systeemtype'} (kopie)`);
  return copy;
}

/** Verwijder een type (puur). Het laatste type kan niet weg (er moet altijd
 *  iets te kiezen blijven) — dan komt dezelfde data terug. */
export function removeSysteemTypeFrom(data, id) {
  const d = migrateSysteemTypen(data);
  if (!findSysteemType(d, id) || d.typen.length <= 1) return d;
  return { ...d, typen: d.typen.filter(t => t.id !== id) };
}

/** Aantal instanties (systeemraster-annotaties) dat naar een type verwijst.
 *  Puur: werkt op een platte annotatielijst (aanroeper levert alle docs). */
export function typeUsageCount(annotations, id) {
  if (!id) return 0;
  let n = 0;
  for (const a of annotations || []) {
    if (a && a.type === 'systeemraster' && a.systeemTypeId === id) n++;
  }
  return n;
}

/** Zet alle instanties met type `fromId` om naar type `toDef` (muteert de
 *  annotaties: verwijzing + IFC-mapping volgen het nieuwe type; contour,
 *  oorsprong, hoek en paneel-overrides blijven staan). @returns aantal. */
export function reassignSysteemType(annotations, fromId, toDef) {
  const doel = normalizeSysteemType(toDef);
  if (!fromId || !doel) return 0;
  let n = 0;
  for (const a of annotations || []) {
    if (a && a.type === 'systeemraster' && a.systeemTypeId === fromId) {
      a.systeemTypeId = doel.id;
      a.ifcCategory = doel.ifcCategory;
      a.ifcPredefinedType = doel.ifcPredefinedType;
      a.modifiedAt = new Date().toISOString();
      n++;
    }
  }
  return n;
}

/** Type → JSON-snapshot (voor OPS_SgTypeDef) en terug. */
export function systeemTypeToJson(t) {
  const norm = normalizeSysteemType(t);
  return norm ? JSON.stringify(norm) : null;
}
export function systeemTypeFromJson(json) {
  if (typeof json !== 'string' || !json) return null;
  try { return normalizeSysteemType(JSON.parse(json)); } catch (_) { return null; }
}
