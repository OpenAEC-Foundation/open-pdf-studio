// IFC-mapping voor de statische NEN 1414-stempelsymbolen op het toolpalette.
//
// Elke entry: NEN-symbool-id (zonder 'nen1414-'-prefix) →
//   { name, ifcCategory, ifcPredefinedType? }
//
// - `ifcCategory` is een IFC4-entiteitsnaam (dezelfde conventie als
//   ifcCategoryMap.js gebruikt voor parametrische componenten).
// - `ifcPredefinedType` is de bijbehorende IFC4 PredefinedType-enumwaarde
//   waar die zinvol en gestandaardiseerd is; weggelaten waar IFC4 geen
//   passende enumwaarde kent (dan geldt impliciet NOTDEFINED).
// - `name` is de weergavenaam (gelijk aan nen1414Library.js) zodat oudere
//   PDF's — die alleen OPS_StampName (de naam) dragen, nog geen
//   OPS_SymbolId — bij het laden alsnog geclassificeerd kunnen worden.
//
// Deze module is bewust puur (geen imports, geen window/import.meta) zodat
// hij ook onder node --test draait.

export const NEN_IFC_MAP = {
  // --- Brandbeveiliging (Tb) ---
  'Tb0.003': { name: 'Brandbeveiligingsinstallatie', ifcCategory: 'IfcController' },
  'Tb01':    { name: 'Brandmeldcentrale (BMC)', ifcCategory: 'IfcController' },
  'Tb02':    { name: 'Onderdeel BMC', ifcCategory: 'IfcController' },
  'Tb04':    { name: 'Brandweeringang', ifcCategory: 'IfcDoor', ifcPredefinedType: 'DOOR' },
  'Tb05':    { name: 'Brandweerpaneel', ifcCategory: 'IfcController' },
  'Tb1.001': { name: 'Automatische melder', ifcCategory: 'IfcSensor', ifcPredefinedType: 'FIRESENSOR' },
  'Tb1.002': { name: 'Thermische melder', ifcCategory: 'IfcSensor', ifcPredefinedType: 'HEATSENSOR' },
  'Tb1.003': { name: 'Rookmelder', ifcCategory: 'IfcSensor', ifcPredefinedType: 'SMOKESENSOR' },
  'Tb1.004': { name: 'Vlammelder', ifcCategory: 'IfcSensor', ifcPredefinedType: 'FIRESENSOR' },
  'Tb1.004a': { name: 'Vlammelder (alternatief)', ifcCategory: 'IfcSensor', ifcPredefinedType: 'FIRESENSOR' },
  'Tb1.005': { name: 'Lijnmelder', ifcCategory: 'IfcSensor', ifcPredefinedType: 'SMOKESENSOR' },
  'Tb1.006': { name: 'Aspiratiemeldsysteem', ifcCategory: 'IfcSensor', ifcPredefinedType: 'SMOKESENSOR' },
  'Tb1.007': { name: 'Gasmelder', ifcCategory: 'IfcSensor', ifcPredefinedType: 'GASSENSOR' },
  'Tb1.008': { name: 'Multisensormelder', ifcCategory: 'IfcSensor' },
  'Tb1.009': { name: 'Handmelder', ifcCategory: 'IfcAlarm', ifcPredefinedType: 'MANUALPULLBOX' },
  'Tb2.001': { name: 'Optische signaalg. (flitslicht)', ifcCategory: 'IfcAlarm', ifcPredefinedType: 'LIGHT' },
  'Tb2.002': { name: 'Akoestische signaalg. (sirene)', ifcCategory: 'IfcAlarm', ifcPredefinedType: 'SIREN' },
  'Tb2.003': { name: 'Optisch/akoestisch signaal', ifcCategory: 'IfcAlarm' },
  'Tb2.004': { name: 'Spraakinstallatie', ifcCategory: 'IfcAudioVisualAppliance', ifcPredefinedType: 'SPEAKER' },
  'Tb2.005': { name: 'Gesproken bericht', ifcCategory: 'IfcAudioVisualAppliance', ifcPredefinedType: 'SPEAKER' },
  'Tb2.021': { name: 'Deur/raamcontact', ifcCategory: 'IfcSensor', ifcPredefinedType: 'CONTACTSENSOR' },
  'Tb2.022': { name: 'Houdmagneet', ifcCategory: 'IfcActuator', ifcPredefinedType: 'ELECTRICACTUATOR' },
  'Tb2.023': { name: 'Deurdranger', ifcCategory: 'IfcActuator' },
  'Tb2.041': { name: 'Brandklep', ifcCategory: 'IfcDamper', ifcPredefinedType: 'FIREDAMPER' },
  'Tb2.042': { name: 'Overdrukklep', ifcCategory: 'IfcDamper', ifcPredefinedType: 'RELIEFDAMPER' },
  'Tb2.043': { name: 'Rookklep', ifcCategory: 'IfcDamper', ifcPredefinedType: 'SMOKEDAMPER' },
  'Tb4.001': { name: 'Brandslangshaspel', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'HOSEREEL' },
  'Tb4.002': { name: 'Droge blusleiding', ifcCategory: 'IfcPipeSegment' },
  'Tb4.003': { name: 'Natte blusleiding', ifcCategory: 'IfcPipeSegment' },
  'Tb4.021': { name: 'Sprinklerinstallatie', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tb4.022': { name: 'Sprinkler (hangend)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tb4.023': { name: 'Sprinkler (staand)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tb4.024': { name: 'Sprinkler (wand)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tb4.025': { name: 'Sprinkler (vlak)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tb5.001': { name: 'Blussysteem', ifcCategory: 'IfcFireSuppressionTerminal' },

  // --- Blussystemen (Tbk) ---
  'Tbk5.001': { name: 'CO2-blusinstallatie', ifcCategory: 'IfcFireSuppressionTerminal' },
  'Tbk5.002': { name: 'Schuimblusinstallatie', ifcCategory: 'IfcFireSuppressionTerminal' },
  'Tbk5.003': { name: 'Waterblusinstallatie', ifcCategory: 'IfcFireSuppressionTerminal' },
  'Tbk5.004': { name: 'Poederblusinstallatie', ifcCategory: 'IfcFireSuppressionTerminal' },
  'Tbk7.001': { name: 'Brandbeveiligingsnet', ifcCategory: 'IfcPipeSegment' },
  'Tbk7.002': { name: 'Brandbestrijdingsnet', ifcCategory: 'IfcPipeSegment' },
  'Tbk7.003': { name: 'Ringnet', ifcCategory: 'IfcPipeSegment' },
  'Tbk7.004': { name: 'Verdeelnet', ifcCategory: 'IfcPipeSegment' },

  // --- Deuren (Td) ---
  'Td01': { name: 'Enkele deur', ifcCategory: 'IfcDoor', ifcPredefinedType: 'DOOR' },
  'Td02': { name: 'Dubbele deur', ifcCategory: 'IfcDoor', ifcPredefinedType: 'DOOR' },
  'Td03': { name: 'Schuifdeur', ifcCategory: 'IfcDoor', ifcPredefinedType: 'DOOR' },
  'Td04': { name: 'Draaihek', ifcCategory: 'IfcDoor', ifcPredefinedType: 'GATE' },
  'Td05': { name: 'Roldeur (boven)', ifcCategory: 'IfcDoor', ifcPredefinedType: 'DOOR' },
  'Td06': { name: 'Roldeur (onder)', ifcCategory: 'IfcDoor', ifcPredefinedType: 'DOOR' },
  'Td07': { name: 'Kanteldeur', ifcCategory: 'IfcDoor', ifcPredefinedType: 'DOOR' },
  'Td08': { name: 'Vouwdeur', ifcCategory: 'IfcDoor', ifcPredefinedType: 'DOOR' },
  'Td09': { name: 'Doorgeefluik', ifcCategory: 'IfcDoor', ifcPredefinedType: 'TRAPDOOR' },
  'Td10': { name: 'Nooddeur', ifcCategory: 'IfcDoor', ifcPredefinedType: 'DOOR' },

  // --- Noodverlichting (Tn) ---
  'Tn01': { name: 'Noodverlichting armatuur', ifcCategory: 'IfcLightFixture', ifcPredefinedType: 'SECURITYLIGHTING' },
  'Tn02': { name: 'Noodverlichting (zelf voorzien)', ifcCategory: 'IfcLightFixture', ifcPredefinedType: 'SECURITYLIGHTING' },
  'Tn03': { name: 'Vluchtwegaanduiding', ifcCategory: 'IfcLightFixture', ifcPredefinedType: 'SECURITYLIGHTING' },
  'Tn04': { name: 'Transparant verlicht', ifcCategory: 'IfcLightFixture', ifcPredefinedType: 'SECURITYLIGHTING' },
  'Tn05': { name: 'Noodverlichting (centraal)', ifcCategory: 'IfcLightFixture', ifcPredefinedType: 'SECURITYLIGHTING' },
  'Tn06': { name: 'Anti-paniekverlichting', ifcCategory: 'IfcLightFixture', ifcPredefinedType: 'SECURITYLIGHTING' },
  'Tn07': { name: 'Werkplekverlichting', ifcCategory: 'IfcLightFixture' },
  'Tn08': { name: 'Veiligheidsverlichting', ifcCategory: 'IfcLightFixture', ifcPredefinedType: 'SECURITYLIGHTING' },
  'Tn09': { name: 'Noodvoeding', ifcCategory: 'IfcElectricFlowStorageDevice' },
  'Tn10': { name: 'Accu-eenheid', ifcCategory: 'IfcElectricFlowStorageDevice', ifcPredefinedType: 'BATTERY' },
  'Tn11': { name: 'Aggregaat', ifcCategory: 'IfcElectricGenerator' },
  'Tn12': { name: 'UPS', ifcCategory: 'IfcElectricFlowStorageDevice', ifcPredefinedType: 'UPS' },

  // --- Rook/Warmteafvoer (Tr) ---
  'Tr01': { name: 'RWA-installatie', ifcCategory: 'IfcFan' },
  'Tr02': { name: 'Rookluik (dak)', ifcCategory: 'IfcDamper', ifcPredefinedType: 'SMOKEDAMPER' },
  'Tr03': { name: 'Rookluik (gevel)', ifcCategory: 'IfcDamper', ifcPredefinedType: 'SMOKEDAMPER' },
  'Tr04': { name: 'Rookklep (kanaal)', ifcCategory: 'IfcDamper', ifcPredefinedType: 'SMOKEDAMPER' },
  'Tr05': { name: 'Rook-/warmteafvoer', ifcCategory: 'IfcDamper', ifcPredefinedType: 'SMOKEDAMPER' },
  'Tr06': { name: 'Toevoer buitenlucht', ifcCategory: 'IfcAirTerminal', ifcPredefinedType: 'LOUVRE' },
  'Tr07': { name: 'Overdrukinstallatie', ifcCategory: 'IfcFan' },
  'Tr08': { name: 'Bedieningspaneel RWA', ifcCategory: 'IfcController' },
  'Tr09': { name: 'Rookmelder (RWA)', ifcCategory: 'IfcSensor', ifcPredefinedType: 'SMOKESENSOR' },
  'Tr10': { name: 'Thermische melder (RWA)', ifcCategory: 'IfcSensor', ifcPredefinedType: 'HEATSENSOR' },
  'Tr11': { name: 'Handmelder (RWA)', ifcCategory: 'IfcAlarm', ifcPredefinedType: 'MANUALPULLBOX' },
  'Tr12': { name: 'Windmelder', ifcCategory: 'IfcSensor', ifcPredefinedType: 'WINDSENSOR' },
  'Tr501': { name: 'Rook-/warmteafvoer (mech.)', ifcCategory: 'IfcFan' },
  'Tr502': { name: 'Ventilator (RWA)', ifcCategory: 'IfcFan' },
  'Tr503': { name: 'Toevoerventilator', ifcCategory: 'IfcFan' },
  'Tr504': { name: 'Afvoerventilator', ifcCategory: 'IfcFan' },

  // --- Ventilatie (Tv) ---
  'Tv017': { name: 'Ventilatiesysteem', ifcCategory: 'IfcAirTerminal' },

  // --- Water/Sprinkler (Tw) ---
  'Tw01': { name: 'Sprinklerinstallatie (water)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tw02': { name: 'Sprinklerkop (hangend)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tw03': { name: 'Sprinklerkop (staand)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tw04': { name: 'Sprinklerkop (wand)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tw05': { name: 'Sprinklerkop (vlak)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tw07': { name: 'Alarmklep', ifcCategory: 'IfcValve' },
  'Tw08': { name: 'Terugslagklep', ifcCategory: 'IfcValve', ifcPredefinedType: 'CHECK' },
  'Tw09': { name: 'Afsluiter', ifcCategory: 'IfcValve', ifcPredefinedType: 'ISOLATING' },
  'Tw10': { name: 'Brandkraan (ondergronds)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'FIREHYDRANT' },
  'Tw11': { name: 'Brandkraan (bovengronds)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'FIREHYDRANT' },
  'Tw12': { name: 'Pompverbinding', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'BREECHINGINLET' },
  'Tw14': { name: 'Sprinklercentrale', ifcCategory: 'IfcController' },
  'Tw15': { name: 'Watervoorziening', ifcCategory: 'IfcTank', ifcPredefinedType: 'STORAGE' },
  'Tw16': { name: 'Watertank', ifcCategory: 'IfcTank', ifcPredefinedType: 'STORAGE' },
  'Tw19': { name: 'Drukverhogingspomp', ifcCategory: 'IfcPump' },
  'Tw2.001': { name: 'Watermist (open)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tw2.002': { name: 'Watermist (gesloten)', ifcCategory: 'IfcFireSuppressionTerminal', ifcPredefinedType: 'SPRINKLER' },
  'Tw20': { name: 'Jockeypump', ifcCategory: 'IfcPump' },
  'Tw28': { name: 'Watermotor gong', ifcCategory: 'IfcAlarm', ifcPredefinedType: 'BELL' },
};

// Toegestane IFC4-entiteiten voor deze mapping (validatie in de unittest en
// vangnet bij het uitlezen van oudere/bewerkte PDF's).
export const NEN_IFC_ALLOWED_CLASSES = Object.freeze([
  'IfcActuator', 'IfcAirTerminal', 'IfcAlarm', 'IfcAudioVisualAppliance',
  'IfcController', 'IfcDamper', 'IfcDoor', 'IfcElectricFlowStorageDevice',
  'IfcElectricGenerator', 'IfcFan', 'IfcFireSuppressionTerminal',
  'IfcLightFixture', 'IfcPipeSegment', 'IfcPump', 'IfcSensor', 'IfcTank',
  'IfcValve',
]);

// Geldige IFC4 PredefinedType-enumwaarden per entiteit (deelverzameling die
// deze mapping gebruikt; validatie in de unittest).
export const NEN_IFC_PREDEFINED_ENUMS = Object.freeze({
  IfcActuator: ['ELECTRICACTUATOR'],
  IfcAirTerminal: ['DIFFUSER', 'GRILLE', 'LOUVRE', 'REGISTER'],
  IfcAlarm: ['BELL', 'BREAKGLASSBUTTON', 'LIGHT', 'MANUALPULLBOX', 'SIREN', 'WHISTLE'],
  IfcAudioVisualAppliance: ['SPEAKER'],
  IfcDamper: ['FIREDAMPER', 'RELIEFDAMPER', 'SMOKEDAMPER', 'FIRESMOKEDAMPER'],
  IfcDoor: ['DOOR', 'GATE', 'TRAPDOOR'],
  IfcElectricFlowStorageDevice: ['BATTERY', 'CAPACITORBANK', 'HARMONICFILTER', 'INDUCTORBANK', 'UPS'],
  IfcFireSuppressionTerminal: ['BREECHINGINLET', 'FIREHYDRANT', 'HOSEREEL', 'SPRINKLER', 'SPRINKLERDEFLECTOR'],
  IfcLightFixture: ['POINTSOURCE', 'DIRECTIONSOURCE', 'SECURITYLIGHTING'],
  IfcSensor: ['CONTACTSENSOR', 'FIRESENSOR', 'GASSENSOR', 'HEATSENSOR', 'SMOKESENSOR', 'WINDSENSOR', 'MOVEMENTSENSOR'],
  IfcTank: ['BASIN', 'BREAKPRESSURE', 'EXPANSION', 'FEEDANDEXPANSION', 'PRESSUREVESSEL', 'STORAGE', 'VESSEL'],
  IfcValve: ['CHECK', 'ISOLATING'],
});

// Reverse index: weergavenaam → raw id (voor oudere PDF's met alleen
// OPS_StampName).
const NAME_TO_ID = (() => {
  const m = new Map();
  for (const [id, entry] of Object.entries(NEN_IFC_MAP)) {
    if (!m.has(entry.name)) m.set(entry.name, id);
  }
  return m;
})();

/** Normaliseer 'nen1414-Tb1.003' of 'Tb1.003' naar raw id, anders null. */
function rawId(symbolId) {
  const id = String(symbolId || '');
  const raw = id.startsWith('nen1414-') ? id.slice('nen1414-'.length) : id;
  return NEN_IFC_MAP[raw] ? raw : null;
}

/**
 * IFC-info voor een NEN 1414-symbool-id (met of zonder 'nen1414-'-prefix).
 * @returns {{ifcCategory: string, ifcPredefinedType?: string}|null}
 */
export function nenIfcForSymbolId(symbolId) {
  const raw = rawId(symbolId);
  return raw ? NEN_IFC_MAP[raw] : null;
}

/**
 * IFC-info voor een stempel op basis van symbool-id EN/OF weergavenaam.
 * De naam-route dekt oudere PDF's die alleen OPS_StampName dragen.
 * @returns {{ifcCategory: string, ifcPredefinedType?: string}|null}
 */
export function nenIfcForStamp(symbolId, stampName) {
  const byId = nenIfcForSymbolId(symbolId);
  if (byId) return byId;
  const raw = NAME_TO_ID.get(String(stampName || ''));
  return raw ? NEN_IFC_MAP[raw] : null;
}
