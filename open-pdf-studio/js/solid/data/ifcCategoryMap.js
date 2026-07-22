// IFC-categorie-mappinglaag voor toolpalette-symbolen.
//
// Doel: elk symbool op het toolpalette (NL IFC Bouw, NL Elektra,
// NL NEN 1414 — Brandbeveiliging, INB, built-in) een verdedigbare
// `ifcCategory` geven ZONDER 58 auto-gegenereerde elektra-entries met de
// hand te bewerken. De mapping werkt in twee lagen:
//
//   1. Grove default per herkomst/type (elektra, nen1414-prefix, wand,
//      parametrisch template, tool).
//   2. Verfijning op naam-/id-trefwoorden (stopcontact → IfcOutlet, enz.).
//
// Onbekend → een verdedigbare default: IfcBuildingElementProxy.
//
// Deze module is puur (geen UI-/state-deps) en wordt aangeroepen vanuit de
// SymbolPalette (bij selecteren) en de parametricSymbol-creator (bij plaatsen),
// zodat de `ifcCategory` op de geplaatste annotatie terechtkomt en de
// hoeveelheden-engine hem kan uitlezen.

export const IFC_DEFAULT = 'IfcBuildingElementProxy';

// --- Trefwoord-regels (NL), eerste match wint. Werken op de KLEINE-letter
// samenvoeging van naam + id, zodat zowel "Stopcontact" als het id
// "elektra-stopcontact" matcht. ---
const KEYWORD_RULES = [
  // Elektra — stopcontacten / aansluitpunten (stroom)
  [/stopcontact|wandcontactdoos|\bwcd\b/, 'IfcOutlet'],
  // Elektra — schakelaars / dimmers / drukkers
  [/schakelaar|dimmer|drukker|\bschakel/, 'IfcSwitchingDevice'],
  // Verlichting (incl. noodverlichting-armaturen)
  [/verlichtingstoestel|wandverlichting|\barmatuur|\bverlichting|noodverlichting|vluchtweg/, 'IfcLightFixture'],
  // Data / telecom / communicatie
  [/\bdata\b|telecom|\btel\b|intercom|\bic\b|antenne|\bcai\b|buisleiding/, 'IfcCommunicationsAppliance'],
  // Meterkast / verdeler / verdeelnet
  [/meterkast|verdeler|verdeelkast|verdeelnet|verdeelinrichting|groepenkast/, 'IfcElectricDistributionBoard'],
  // Sensoren / melders / detectoren
  [/bewegingsdetector|detector|rookmelder|\brm\b|melder|thermostaat|sensor|windmelder/, 'IfcSensor'],
  // Alarmen / signaalgevers / bellen / schellen
  [/\bbel\b|schel|\bsirene|signaalg|flitslicht|alarm|akoestisch|optisch/, 'IfcAlarm'],
  // Brandblus-terminals: sprinkler, brandslang, blusleiding, brandkraan
  [/sprinkler|brandslang|blusleiding|blusinstallatie|blussysteem|brandkraan|watermist|watermotor|jockeypump/, 'IfcFireSuppressionTerminal'],
  // Brandmeldcentrale / brandweerpaneel / handmelder (alarm-domein)
  [/brandmeldcentrale|\bbmc\b|handmelder|brandweer|brandbeveiliging/, 'IfcAlarm'],
  // Deuren / hekken / luiken
  [/\bdeur|nooddeur|roldeur|kanteldeur|vouwdeur|schuifdeur|draaihek|doorgeefluik|rookluik/, 'IfcDoor'],
  // Ramen
  [/\braam|venster|\bwindow\b/, 'IfcWindow'],
  // Ventilatie / RWA / kleppen / ventilatoren
  [/ventilat|\bmv\b|ventilator|rwa|rook-?\/?warmteafvoer|brandklep|overdrukklep|rookklep|afsluiter|terugslagklep|alarmklep/, 'IfcAirTerminal'],
  // Trappen
  [/\btrap|stairs|traptrede/, 'IfcStair'],
  // Ruimte (IfcSpace)
  [/\bruimte\b|ifc-?space|\bspace\b/, 'IfcSpace'],
  // Constructie — stalen profielen
  [/\bhea\b|\bheb\b|\bipe\b|\bunp\b|\bkoker\b|staalprofiel|staal-/, 'IfcMember'],
  // Constructie — houten balk / ligger
  [/houten balk|hout-?balk|\bligger\b|\bbalk\b/, 'IfcBeam'],
  // Constructie — palen / fundering
  [/\bpaal\b|paal-?aanzicht|heipaal|fundering/, 'IfcPile'],
  // Constructie — bout / anker / bevestiging
  [/\bbout\b|\banker\b|bevestiging/, 'IfcMechanicalFastener'],
  // Vloeren
  [/vloer|kanaalplaat|isolatieplaat|breedplaat/, 'IfcSlab'],
  // Wanden
  [/\bwand\b|muur|metselwerk|ifcwall/, 'IfcWall'],
  // Toestellen op aansluitpunt (witgoed/apparatuur)
  [/koelkast|vrieskast|vaatwasser|wasmachine|wasdroger|magnetron|kooktoestel|afzuigkap|boiler|warmtepomp|\bcv\b|centrale verwarming/, 'IfcElectricAppliance'],
  // Zonwering / gordijnen / rolluiken
  [/zonwering|gordijn|rolluik/, 'IfcShadingDevice'],
];

// --- Grove defaults per herkomst. Wordt gebruikt als GEEN trefwoord matcht. ---
// Elektra-symbolen zonder specifieke match → generiek elektrisch toestel.
const ELEKTRA_DEFAULT = 'IfcElectricAppliance';

// NEN 1414-prefix → domein-default (id begint met `nen1414-<prefix>`).
const NEN1414_PREFIX_DEFAULT = {
  Tbk: 'IfcFireSuppressionTerminal', // blussystemen (Tbk vóór Tb!)
  Tb: 'IfcAlarm',                    // brandbeveiliging (melders/signaalgevers)
  Td: 'IfcDoor',                     // deuren
  Tn: 'IfcLightFixture',             // noodverlichting
  Tr: 'IfcAirTerminal',             // rook-/warmteafvoer
  Tv: 'IfcAirTerminal',             // ventilatie
  Tw: 'IfcFireSuppressionTerminal', // water/sprinkler
};

// Parametrisch template-id → default (fijnmazige overrides bovenop trefwoorden).
const PARAMETRIC_ID_DEFAULT = {
  'door': 'IfcDoor',
  'window': 'IfcWindow',
  'stairs': 'IfcStair',
  'north': IFC_DEFAULT,     // noordpijl = annotatie, geen bouwelement
  'stramien': 'IfcGrid',
  'peilmaat': 'IfcAnnotation',
  'ifc-space': 'IfcSpace',
  'hout-balk': 'IfcBeam',
  'bout': 'IfcMechanicalFastener',
  'staal-hea': 'IfcMember', 'staal-heb': 'IfcMember', 'staal-ipe': 'IfcMember',
  'staal-unp': 'IfcMember', 'staal-koker': 'IfcMember',
  'paal-aanzicht-type-1': 'IfcPile', 'paal-aanzicht-type-2': 'IfcPile',
  'vloer-kanaalplaatvloer': 'IfcSlab',
  'vloer-isolatieplaatvloer': 'IfcSlab',
  'vloer-ps-isolatievloer': 'IfcSlab',
  'wandarcering': 'IfcWall',
  'wapening-verdeling': 'IfcReinforcingBar',
  'beugel': 'IfcReinforcingBar',
  'wapeningskorf': 'IfcReinforcingBar',
  'wapeningsstaaf': 'IfcReinforcingBar',
  'netwapening': 'IfcReinforcingBar',
  'sondering': 'IfcAnnotation',
  'paalpuntniveau': 'IfcAnnotation',
  'overspanningspijl-vloer': 'IfcAnnotation',
};

function keywordMatch(text) {
  for (const [re, cat] of KEYWORD_RULES) {
    if (re.test(text)) return cat;
  }
  return null;
}

function nen1414Prefix(id) {
  // id-vorm: 'nen1414-Tbk5.001' → prefix 'Tbk'. Langste prefix eerst.
  const m = /^nen1414-(Tbk|Tb|Td|Tn|Tr|Tv|Tw)/.exec(id || '');
  return m ? m[1] : null;
}

/**
 * Bepaal de IFC-categorie voor een toolpalette-symbool.
 * @param {object} symbol  Een palette-entry: { id, name, parametricId, wall, tool, svg }.
 * @returns {string} IFC-categorienaam (bv. 'IfcOutlet').
 */
export function ifcCategoryForSymbol(symbol) {
  if (!symbol || typeof symbol !== 'object') return IFC_DEFAULT;
  const id = String(symbol.id || '');
  const name = String(symbol.name || '');
  const text = `${name} ${id}`.toLowerCase();

  // 1. Wand-entry → altijd IfcWall (materiaal/dikte doen er niet toe).
  if (symbol.wall) return 'IfcWall';

  // 2. Parametrisch template: eerst fijnmazige id-default, dan trefwoord.
  if (symbol.parametricId) {
    const byId = ifcCategoryForParametric(symbol.parametricId);
    if (byId !== IFC_DEFAULT) return byId;
    return keywordMatch(text) || IFC_DEFAULT;
  }

  // 3. Generieke tool-entry (bv. 'mask'): geen bouwelement.
  if (symbol.tool) return keywordMatch(text) || IFC_DEFAULT;

  // 4. Trefwoord-verfijning (werkt voor elektra én nen1414 statische stempels).
  const kw = keywordMatch(text);
  if (kw) return kw;

  // 5. Herkomst-defaults als geen trefwoord matchte.
  const nen = nen1414Prefix(id);
  if (nen) return NEN1414_PREFIX_DEFAULT[nen] || IFC_DEFAULT;
  if (/^elektra-/.test(id)) return ELEKTRA_DEFAULT;

  return IFC_DEFAULT;
}

// --- Annotatie-TYPE → IFC-categorie. Voor niet-parametrische constructie-
// objecten die hun eigen annotatietype hebben (dus geen symbolId dragen). ---
const ANNOTATION_TYPE_DEFAULT = {
  // Wapeningsstaven-reeks → generieke wapening (label: "Wapening").
  stavenreeks: 'IfcReinforcingBar',
  wall: 'IfcWall',
};

/**
 * IFC-categorie voor een annotatie op basis van zijn `type`.
 * Gebruikt door creators van constructie-objecten die geen template-id hebben
 * (bv. de stavenreeks), zodat de hoeveelheden-engine de categorie kan uitlezen.
 * @param {string} annotationType  Annotatietype (bv. 'stavenreeks').
 * @returns {string} IFC-categorienaam.
 */
export function ifcCategoryForAnnotationType(annotationType) {
  return ANNOTATION_TYPE_DEFAULT[String(annotationType || '')] || IFC_DEFAULT;
}

/**
 * IFC-categorie voor een parametrisch symbool op basis van zijn template-id
 * (gebruikt door de parametricSymbol-creator, die alleen de symbolId kent).
 * @param {string} parametricId  Template-id (bv. 'staal-hea', 'ifc-space').
 * @returns {string} IFC-categorienaam.
 */
export function ifcCategoryForParametric(parametricId) {
  const id = String(parametricId || '');
  if (PARAMETRIC_ID_DEFAULT[id]) return PARAMETRIC_ID_DEFAULT[id];
  // Gedownloade staalcatalogus-templates (symbols/steel-catalog.js) dragen
  // het 'steel-'-prefix -> zelfde categorie als de NL staalprofielen.
  if (/^steel-/.test(id)) return 'IfcMember';
  return keywordMatch(id.toLowerCase()) || IFC_DEFAULT;
}

/**
 * IFC-categorie voor een opgeslagen annotatie. Een expliciet gekozen waarde
 * heeft voorrang; oudere documenten zonder dat veld worden via type/symbolId
 * opnieuw geclassificeerd. Gewone tekenannotaties vallen terug op
 * IfcAnnotation in plaats van op een bouwelement-proxy.
 */
export function ifcCategoryForAnnotation(annotation) {
  if (!annotation || typeof annotation !== 'object') return 'IfcAnnotation';
  const explicit = String(annotation.ifcCategory || '').trim();
  if (explicit) return explicit;
  if (annotation.type === 'parametricSymbol') {
    return ifcCategoryForParametric(annotation.symbolId);
  }
  const byType = ifcCategoryForAnnotationType(annotation.type);
  return byType === IFC_DEFAULT ? 'IfcAnnotation' : byType;
}

// --- Leesbare NL-omschrijving per IFC-categorie, alleen voor weergave.
// De OPGESLAGEN waarde blijft de IFC-entiteitsnaam (interoperabel voor BIM/IFC-
// export); dit is puur de menstaal ernaast, zodat "IfcOutlet" ook als
// "Stopcontact / wandcontactdoos" leesbaar is. ---
export const IFC_LABELS = {
  IfcOutlet: 'Stopcontact / wandcontactdoos',
  IfcSwitchingDevice: 'Schakelaar / dimmer',
  IfcLightFixture: 'Verlichtingsarmatuur',
  IfcCommunicationsAppliance: 'Data / telecom',
  IfcElectricDistributionBoard: 'Meterkast / verdeelkast',
  IfcSensor: 'Sensor / melder / detector',
  IfcAlarm: 'Alarm / signaalgever / bel',
  IfcFireSuppressionTerminal: 'Blusinstallatie / sprinkler',
  IfcDoor: 'Deur',
  IfcWindow: 'Raam',
  IfcAirTerminal: 'Ventilatie / luchtrooster',
  IfcStair: 'Trap',
  IfcSpace: 'Ruimte',
  IfcMember: 'Staalprofiel / staafelement',
  IfcBeam: 'Balk / ligger',
  IfcPile: 'Paal / fundering',
  IfcMechanicalFastener: 'Bout / anker / bevestiging',
  IfcSlab: 'Vloer / plaat',
  IfcWall: 'Wand / muur',
  IfcElectricAppliance: 'Elektrisch toestel / apparaat',
  IfcShadingDevice: 'Zonwering',
  IfcGrid: 'Stramien / raster',
  IfcAnnotation: 'Annotatie / maatvoering',
  IfcReinforcingBar: 'Wapening',
  IfcBuildingElementProxy: 'Overig bouwelement',
};

/** Leesbare NL-omschrijving voor een IFC-categorie (lege string als onbekend). */
export function ifcCategoryLabel(cat) {
  if (!cat) return '';
  return IFC_LABELS[cat] || '';
}
