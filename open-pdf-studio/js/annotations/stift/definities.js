// Stiftdefinities: de soorten, de ingebouwde startset en de regels voor een
// geldige definitie. Puur (geen app-state), onder node te testen.
//
// Een stift is een getekend element dat verwijst naar een definitie in het
// document: soort, omschrijving, kleur, lijnsoort en dikte. De soort bepaalt
// de tekenwijze (lijn, pijl, punt of kruis) en de IFC-categorie en ligt vast
// na het aanmaken. Ontwerp:
// docs/superpowers/specs/2026-09-28-stifttekening-deel1-design.md

/** Versie van de opgeslagen definitielijst (`/OPS_StiftDefs`). */
export const STIFT_VERSIE = 1;

/**
 * De elf soorten, in de volgorde van het paneel en de legenda. De
 * standaardwaarden komen uit het voorbeeld 3052-CP-21: wanden en liggers
 * 4,03 pt (1,4 mm), vloerpijlen 1,0 pt, sparingkruisen 2,0 pt.
 */
export const SOORTEN = Object.freeze([
  { id: 'bestaandeWand', naam: 'Bestaande wand', vorm: 'lijn', ifc: 'IfcWall', kleur: '#000000', lijnsoort: 'gestreept', dikteMm: 1.4 },
  { id: 'nieuweWand', naam: 'Nieuwe wand', vorm: 'lijn', ifc: 'IfcWall', kleur: '#FF0000', lijnsoort: 'gestreept', dikteMm: 1.4 },
  { id: 'stabiliteitswand', naam: 'Stabiliteitswand', vorm: 'lijn', ifc: 'IfcWall', kleur: '#FF8C00', lijnsoort: 'gestreept', dikteMm: 1.4 },
  { id: 'liggerStaal', naam: 'Ligger staal', vorm: 'lijn', ifc: 'IfcBeam', kleur: '#7D9EBF', lijnsoort: 'doorgetrokken', dikteMm: 1.4 },
  { id: 'liggerHout', naam: 'Ligger hout', vorm: 'lijn', ifc: 'IfcBeam', kleur: '#FFFF00', lijnsoort: 'doorgetrokken', dikteMm: 1.4 },
  { id: 'latei', naam: 'Latei', vorm: 'lijn', ifc: 'IfcBeam', kleur: '#3BB370', lijnsoort: 'doorgetrokken', dikteMm: 1.4 },
  { id: 'vloer', naam: 'Balklaag of vloer', vorm: 'pijl', ifc: 'IfcSlab', kleur: '#FF0000', lijnsoort: 'doorgetrokken', dikteMm: 0.35 },
  { id: 'kolom', naam: 'Kolom', vorm: 'punt', ifc: 'IfcColumn', kleur: '#0000FF', lijnsoort: 'doorgetrokken', dikteMm: 0.35, puntvorm: 'vierkant', maatMm: 4 },
  { id: 'fundering', naam: 'Funderingsbalk of strook', vorm: 'lijn', ifc: 'IfcFooting', kleur: '#0000FF', lijnsoort: 'doorgetrokken', dikteMm: 1.0 },
  { id: 'paal', naam: 'Paal', vorm: 'punt', ifc: 'IfcPile', kleur: '#000000', lijnsoort: 'doorgetrokken', dikteMm: 0.35, puntvorm: 'cirkel', maatMm: 4 },
  { id: 'sparing', naam: 'Sparing', vorm: 'kruis', ifc: 'IfcOpeningElement', kleur: '#FF0000', lijnsoort: 'doorgetrokken', dikteMm: 0.7 },
].map((s) => Object.freeze(s)));

const PER_ID = new Map(SOORTEN.map((s) => [s.id, s]));
const KLEUR = /^#[0-9A-Fa-f]{6}$/;
const LETTER = /^[A-Za-z0-9]{1,2}$/;
export const PUNTVORMEN = Object.freeze(['vierkant', 'i-profiel', 'cirkel']);
export const LIJNSOORTEN = Object.freeze(['doorgetrokken', 'gestreept']);

/** De soort met dit id, of null. */
export function soortInfo(soort) {
  return PER_ID.get(soort) || null;
}

/** Tekenwijze van een soort: 'lijn' | 'pijl' | 'punt' | 'kruis'. */
export function vormVoorSoort(soort) {
  return soortInfo(soort)?.vorm || 'lijn';
}

/** IFC-categorie van een soort. */
export function ifcVoorSoort(soort) {
  return soortInfo(soort)?.ifc || 'IfcBuildingElementProxy';
}

/** Millimeters op papier naar PDF-punten. */
export function mmNaarPt(mm) {
  return (Number(mm) * 72) / 25.4;
}

/** Nieuw stabiel id voor een zelf aangemaakte definitie. */
export function nieuweStiftId() {
  return 'sd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** De eerste letter die nog geen vloerdefinitie in `definities` draagt. */
export function volgendeLetter(definities) {
  const bezet = new Set((definities || [])
    .filter((d) => d?.soort === 'vloer')
    .map((d) => String(d.letter || '').toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!bezet.has(letter)) return letter;
  }
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const letter = String.fromCharCode(65 + i, 65 + j);
      if (!bezet.has(letter)) return letter;
    }
  }
  return 'A';
}

/**
 * Een nieuwe definitie van `soort` met de standaardwaarden van die soort.
 * @param {string} soort
 * @param {{id?: string, omschrijving?: string, bestaande?: object[]}} [opties]
 */
export function maakDefinitie(soort, { id = nieuweStiftId(), omschrijving, bestaande = [] } = {}) {
  const s = soortInfo(soort) || soortInfo('nieuweWand');
  const def = {
    id,
    soort: s.id,
    omschrijving: omschrijving ?? s.naam,
    kleur: s.kleur,
    lijnsoort: s.lijnsoort,
    dikteMm: s.dikteMm,
  };
  if (s.vorm === 'punt') {
    def.puntvorm = s.puntvorm;
    def.maatMm = s.maatMm;
  }
  if (s.id === 'vloer') def.letter = volgendeLetter(bestaande);
  return def;
}

/** De ingebouwde startset: één definitie per soort, met vaste id's. */
export function standaardSet() {
  const lijst = [];
  for (const s of SOORTEN) lijst.push(maakDefinitie(s.id, { id: `sd-std-${s.id}`, bestaande: lijst }));
  return lijst;
}

function getal(waarde, min, max, terugval) {
  const n = Number(waarde);
  return Number.isFinite(n) && n > min && n <= max ? n : terugval;
}

/**
 * Een definitie zoals hij uit een bestand of de voorkeuren komt, aangevuld
 * met de standaardwaarden van zijn soort. Een onbekende soort wordt "Nieuwe
 * wand". Geeft null voor iets dat geen object is.
 */
export function valideerDefinitie(ruw) {
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) return null;
  const s = soortInfo(ruw.soort) || soortInfo('nieuweWand');
  const omschrijving = typeof ruw.omschrijving === 'string' && ruw.omschrijving.trim()
    ? ruw.omschrijving.trim().slice(0, 200) : s.naam;
  const def = {
    id: typeof ruw.id === 'string' && ruw.id.trim() ? ruw.id.trim() : nieuweStiftId(),
    soort: s.id,
    omschrijving,
    kleur: typeof ruw.kleur === 'string' && KLEUR.test(ruw.kleur) ? ruw.kleur.toUpperCase() : s.kleur,
    lijnsoort: LIJNSOORTEN.includes(ruw.lijnsoort) ? ruw.lijnsoort : s.lijnsoort,
    dikteMm: getal(ruw.dikteMm, 0, 20, s.dikteMm),
  };
  if (s.vorm === 'punt') {
    def.puntvorm = PUNTVORMEN.includes(ruw.puntvorm) ? ruw.puntvorm : s.puntvorm;
    def.maatMm = getal(ruw.maatMm, 0, 50, s.maatMm);
  }
  if (s.id === 'vloer') {
    def.letter = typeof ruw.letter === 'string' && LETTER.test(ruw.letter) ? ruw.letter.toUpperCase() : 'A';
  }
  return def;
}

/** Een lijst geldige definities; bij een dubbel id wint de eerste. */
export function valideerLijst(lijst) {
  if (!Array.isArray(lijst)) return [];
  const uit = [];
  const ids = new Set();
  for (const ruw of lijst) {
    const def = valideerDefinitie(ruw);
    if (!def || ids.has(def.id)) continue;
    ids.add(def.id);
    uit.push(def);
  }
  return uit;
}

/** Wat in `/OPS_StiftDefs` komt. */
export function schrijfOpgeslagen(definities) {
  return { versie: STIFT_VERSIE, definities: valideerLijst(definities) };
}

/**
 * Lees de opgeslagen vorm terug (versie 1 is de enige; een lijst zonder
 * versie telt als versie 1). Geeft altijd een lijst, desnoods leeg.
 */
export function leesOpgeslagen(data) {
  if (Array.isArray(data)) return valideerLijst(data);
  if (!data || typeof data !== 'object') return [];
  return valideerLijst(data.definities);
}
