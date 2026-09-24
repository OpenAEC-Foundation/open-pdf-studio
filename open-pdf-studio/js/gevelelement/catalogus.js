// Catalogus van het gevelelement: de VOORINSTELLINGEN (vliesgevel, kozijn)
// en de uitbreidbare lijsten met stijl- en paneeltypes.
//
// Een gevelelement is één soort object: een buitenkader, stijlen op de
// veldgrenzen en per veld een paneel. Een vliesgevel en een kozijn verschillen
// alleen in hun standaardmaten en in welke types ze aanbieden — daarom staan
// die hier als gegevens, niet als code. Nieuwe types (bijvoorbeeld een
// kozijnhoutprofiel met sponning) komen erbij via registreerStijlType /
// registreerPaneelType; het element zelf hoeft daarvoor niet te veranderen.
//
// Assen (in mm, in de plattegrond):
//   u = langs het element, v = dwars (diepte), v = 0 op het BUITENvlak.
//
// Stijltype:
//   { id, naam, nameEn, breedteMm (langs u), diepteMm (langs v), presets,
//     contour?(ctx) -> [{u, v}] }
//   `contour` is optioneel: u GECENTREERD op de hartlijn van de stijl
//   (-b/2 .. +b/2), v = 0 op het buitenvlak van die stijl, tot diepteMm.
//   Zonder contour is de stijl een rechthoek van b × d.
//   ctx = { positie: 'begin' | 'tussen' | 'eind' }.
//
// Paneeltype:
//   { id, naam, nameEn, weergave, presets, vormen?(ctx) -> vormen[] }
//   `weergave` kiest de standaardtekening: 'glas' | 'dicht' | 'deur' |
//   'draairaam' | 'open'. `vormen` is optioneel en vervangt die tekening;
//   zie weergave.js voor het vormen-formaat.
//
// Deze module rekent niet en kent geen app-state.

const stijlTypen = new Map();
const paneelTypen = new Map();

/** De twee voorinstellingen. Maten in mm. */
export const PRESETS = Object.freeze({
  vliesgevel: Object.freeze({
    id: 'vliesgevel',
    naam: 'Vliesgevel',
    nameEn: 'Curtain wall',
    standaardLengteMm: 3600,
    standaardVeldMm: 1200,        // streefbreedte voor een verse verdeling
    minDagMm: 100,                // smalste vrije veldbreedte
    stijlType: 'alu-50x150',
    kaderType: 'alu-50x150',
    paneelType: 'glas',
    glasDikteMm: 32,              // hart-op-hart van de twee glaslijnen
    paneelDikteMm: 60,
    deurDikteMm: 50,
  }),
  kozijn: Object.freeze({
    id: 'kozijn',
    naam: 'Kozijn',
    nameEn: 'Window frame',
    standaardLengteMm: 1800,
    standaardVeldMm: 900,
    minDagMm: 100,
    stijlType: 'hout-67x114',
    kaderType: 'hout-67x114',
    paneelType: 'glas',
    glasDikteMm: 24,
    paneelDikteMm: 40,
    deurDikteMm: 40,
  }),
});

export const PRESET_IDS = Object.freeze(Object.keys(PRESETS));

/** Voorinstelling op id; onbekend valt terug op de vliesgevel. */
export function preset(id) {
  return PRESETS[id] || PRESETS.vliesgevel;
}

function geldigType(t) {
  return t && typeof t.id === 'string' && t.id.length > 0;
}

/** Voeg een stijltype toe (of vervang er een met hetzelfde id). */
export function registreerStijlType(t) {
  if (!geldigType(t)) throw new Error('mullion type needs an id');
  const b = Number(t.breedteMm), d = Number(t.diepteMm);
  if (!(b > 0) || !(d > 0)) throw new Error(`mullion type ${t.id} needs breedteMm and diepteMm > 0`);
  stijlTypen.set(t.id, Object.freeze({
    ...t,
    breedteMm: b,
    diepteMm: d,
    presets: Array.isArray(t.presets) ? [...t.presets] : [...PRESET_IDS],
  }));
  return stijlTypen.get(t.id);
}

const WEERGAVEN = Object.freeze(['glas', 'dicht', 'deur', 'draairaam', 'open']);

/** Voeg een paneeltype toe (of vervang er een met hetzelfde id). */
export function registreerPaneelType(t) {
  if (!geldigType(t)) throw new Error('panel type needs an id');
  if (!WEERGAVEN.includes(t.weergave) && typeof t.vormen !== 'function') {
    throw new Error(`panel type ${t.id} needs weergave (${WEERGAVEN.join('|')}) or vormen()`);
  }
  paneelTypen.set(t.id, Object.freeze({
    ...t,
    presets: Array.isArray(t.presets) ? [...t.presets] : [...PRESET_IDS],
  }));
  return paneelTypen.get(t.id);
}

export function stijlType(id) {
  return stijlTypen.get(id) || null;
}

export function paneelType(id) {
  return paneelTypen.get(id) || null;
}

/** Stijltypes die een voorinstelling aanbiedt, in registratievolgorde. */
export function stijlTypenVoor(presetId) {
  return [...stijlTypen.values()].filter((t) => t.presets.includes(presetId));
}

/** Paneeltypes die een voorinstelling aanbiedt, in registratievolgorde. */
export function paneelTypenVoor(presetId) {
  return [...paneelTypen.values()].filter((t) => t.presets.includes(presetId));
}

/** Weergavenaam van een type of voorinstelling in de taal van de gebruiker. */
export function typeNaam(t, taal) {
  if (!t) return '';
  return String(taal || '').toLowerCase().startsWith('nl') ? (t.naam || t.id) : (t.nameEn || t.naam || t.id);
}

/** Mag dit stijltype in deze voorinstelling? */
export function stijlTypeToegestaan(presetId, id) {
  return !!stijlType(id)?.presets.includes(presetId);
}

/** Mag dit paneeltype in deze voorinstelling? */
export function paneelTypeToegestaan(presetId, id) {
  return !!paneelType(id)?.presets.includes(presetId);
}

// ── Standaardtypes ───────────────────────────────────────────────────────
// Vliesgevel: aluminium stijlen. Kozijn: vurenhouten kozijnhout in de
// gangbare handelsmaten (breedte × diepte).

for (const [b, d] of [[50, 150], [50, 200], [65, 250]]) {
  registreerStijlType({
    id: `alu-${b}x${d}`,
    naam: `Aluminium stijl ${b} × ${d}`,
    nameEn: `Aluminium mullion ${b} × ${d}`,
    breedteMm: b, diepteMm: d,
    presets: ['vliesgevel'],
  });
}
for (const [b, d] of [[67, 114], [67, 139], [90, 114]]) {
  registreerStijlType({
    id: `hout-${b}x${d}`,
    naam: `Kozijnhout ${b} × ${d}`,
    nameEn: `Timber frame ${b} × ${d}`,
    breedteMm: b, diepteMm: d,
    presets: ['kozijn'],
  });
}

registreerPaneelType({ id: 'glas', naam: 'Glas', nameEn: 'Glass', weergave: 'glas', presets: ['vliesgevel', 'kozijn'] });
registreerPaneelType({ id: 'draairaam', naam: 'Draairaam', nameEn: 'Turn sash', weergave: 'draairaam', presets: ['kozijn'] });
registreerPaneelType({ id: 'deur', naam: 'Deur', nameEn: 'Door', weergave: 'deur', presets: ['vliesgevel', 'kozijn'] });
registreerPaneelType({ id: 'dicht', naam: 'Dicht paneel', nameEn: 'Solid panel', weergave: 'dicht', presets: ['vliesgevel', 'kozijn'] });
registreerPaneelType({ id: 'open', naam: 'Open', nameEn: 'Open', weergave: 'open', presets: ['vliesgevel'] });
