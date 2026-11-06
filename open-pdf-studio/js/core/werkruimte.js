// Indeling van de werkruimte (#932): welke panelen en paletten open staan,
// ingeklapt zijn of zweven, hoe breed het linkerpaneel is en of het lint is
// ingeklapt. De indeling staat in de voorkeuren (blijft dus over een herstart
// bewaard) en kan onder een naam als werkruimte worden opgeslagen.
//
// Dit bestand is zuivere logica zonder DOM of app-state, zodat het los te
// testen is (werkruimte.test.mjs). Het toepassen in de app staat in
// ui/panels/werkruimte-toepassen.js.

import { maxPaneelBreedte } from '../ui/panels/miniatuur-maat.js';

/** Voorkeur-sleutels die samen de indeling vormen. */
export const LAYOUT_SLEUTELS = Object.freeze([
  'ribbonCollapsed',
  'leftPanelCollapsed',
  'leftPanelTab',
  'leftPanelWidth',
  'propertiesPanelVisible',
  'propertiesPanelCollapsed',
  'toolPaletteVisible',
  'toolPaletteMode',
  'toolPaletteFloatX',
  'toolPaletteFloatY',
  'symbolPaletteVisible',
  'symbolPaletteMode',
  'symbolPaletteFloatX',
  'symbolPaletteFloatY',
  'paletteLeftOrder',
  'paletteRightOrder',
]);

// Paletten van extensies bewaren hun stand onder ext_<id>_<veld>.
const EXT_SLEUTEL = /^ext_[\w.-]{1,80}_(visible|mode|floatX|floatY)$/;

export const PALET_MODI = Object.freeze(['docked-left', 'docked-right', 'float']);
export const LINKER_PANEEL_MIN = 120;
export const LINKER_PANEEL_MAX = 4000;
export const MAX_WERKRUIMTEN = 30;
export const MAX_NAAM_LENGTE = 60;

const isBool = (v) => typeof v === 'boolean';
const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const isModus = (v) => PALET_MODI.includes(v);
const isVolgorde = (v) => Array.isArray(v) && v.length <= 50
  && v.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 100);

// Per sleutel: geldig? en zo ja, de waarde zoals hij wordt bewaard.
const CONTROLE = {
  ribbonCollapsed: isBool,
  leftPanelCollapsed: isBool,
  leftPanelTab: (v) => typeof v === 'string' && /^[\w-]{1,40}$/.test(v),
  // null = de breedte uit het stijlblad (nooit versleept).
  leftPanelWidth: (v) => v === null || (isGetal(v) && v >= LINKER_PANEEL_MIN && v <= LINKER_PANEEL_MAX),
  propertiesPanelVisible: isBool,
  propertiesPanelCollapsed: isBool,
  toolPaletteVisible: isBool,
  toolPaletteMode: isModus,
  toolPaletteFloatX: isGetal,
  toolPaletteFloatY: isGetal,
  symbolPaletteVisible: isBool,
  symbolPaletteMode: isModus,
  symbolPaletteFloatX: isGetal,
  symbolPaletteFloatY: isGetal,
  paletteLeftOrder: isVolgorde,
  paletteRightOrder: isVolgorde,
};

function extGeldig(sleutel, waarde) {
  const veld = EXT_SLEUTEL.exec(sleutel)?.[1];
  if (!veld) return false;
  if (veld === 'visible') return isBool(waarde);
  if (veld === 'mode') return isModus(waarde);
  return isGetal(waarde);
}

/** Hoort deze voorkeur-sleutel bij de indeling? */
export function isLayoutSleutel(sleutel) {
  return Object.hasOwn(CONTROLE, sleutel) || EXT_SLEUTEL.test(sleutel);
}

function geldig(sleutel, waarde) {
  if (Object.hasOwn(CONTROLE, sleutel)) return CONTROLE[sleutel](waarde);
  return extGeldig(sleutel, waarde);
}

const kopie = (v) => (Array.isArray(v) ? [...v] : v);

/**
 * Alleen de geldige indelingsvelden uit een (opgeslagen, dus onbetrouwbaar)
 * object. Onbekende sleutels en verkeerde typen vallen weg.
 */
export function normaliseerLayout(ruw) {
  const uit = {};
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) return uit;
  for (const [sleutel, waarde] of Object.entries(ruw)) {
    if (isLayoutSleutel(sleutel) && geldig(sleutel, waarde)) uit[sleutel] = kopie(waarde);
  }
  return uit;
}

/** De huidige indeling uit de voorkeuren. */
export function leesLayout(voorkeuren) {
  return normaliseerLayout(voorkeuren);
}

/**
 * Wat er in de voorkeuren moet veranderen om `layout` te krijgen.
 *
 * Een vaste sleutel die de werkruimte niet kent (opgeslagen vóór die
 * sleutel bestond, of beschadigd) krijgt de standaardwaarde, zodat wisselen
 * naar een werkruimte altijd hetzelfde beeld geeft. Paletten van extensies
 * die de werkruimte niet noemt, blijven zoals ze zijn: misschien was die
 * extensie toen nog niet geïnstalleerd.
 *
 * @returns {Record<string, unknown>} alleen de sleutels die echt wijzigen
 */
export function layoutWijzigingen(huidig, layout, standaard) {
  const doel = normaliseerLayout(layout);
  const basis = normaliseerLayout(standaard);
  const nu = huidig || {};
  const wijzig = {};
  const zet = (sleutel, waarde) => {
    if (JSON.stringify(nu[sleutel]) !== JSON.stringify(waarde)) wijzig[sleutel] = kopie(waarde);
  };
  for (const sleutel of LAYOUT_SLEUTELS) {
    if (Object.hasOwn(doel, sleutel)) zet(sleutel, doel[sleutel]);
    else if (Object.hasOwn(basis, sleutel)) zet(sleutel, basis[sleutel]);
  }
  for (const [sleutel, waarde] of Object.entries(doel)) {
    if (EXT_SLEUTEL.test(sleutel)) zet(sleutel, waarde);
  }
  return wijzig;
}

/** Zelfde indeling (volgorde van de sleutels telt niet)? */
export function zelfdeLayout(a, b) {
  const x = normaliseerLayout(a);
  const y = normaliseerLayout(b);
  const sleutels = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const s of sleutels) {
    if (JSON.stringify(x[s]) !== JSON.stringify(y[s])) return false;
  }
  return true;
}

/**
 * Bewaarde breedte van het linkerpaneel binnen wat het huidige venster
 * toelaat (zelfde grenzen als de sleepgreep); null = stijlbladbreedte.
 */
export function begrensdeBreedte(breedte, vensterBreedte) {
  if (typeof breedte !== 'number' || !Number.isFinite(breedte)) return null;
  return Math.max(LINKER_PANEEL_MIN, Math.min(maxPaneelBreedte(vensterBreedte), Math.round(breedte)));
}

// ── Werkruimten met een naam ────────────────────────────────────────────

/** Naam zoals hij wordt bewaard, of '' als hij onbruikbaar is. */
export function normaliseerNaam(naam) {
  if (typeof naam !== 'string') return '';
  return naam.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAAM_LENGTE);
}

const zelfdeNaam = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/**
 * Een opgeslagen lijst werkruimten opschonen: elk item { naam, layout },
 * namen uniek (hoofdletterongevoelig, de eerste wint), hoogstens
 * MAX_WERKRUIMTEN.
 */
export function normaliseerWerkruimten(lijst) {
  if (!Array.isArray(lijst)) return [];
  const uit = [];
  for (const item of lijst) {
    const naam = normaliseerNaam(item?.naam);
    if (!naam || uit.some((w) => zelfdeNaam(w.naam, naam))) continue;
    uit.push({ naam, layout: normaliseerLayout(item.layout) });
    if (uit.length >= MAX_WERKRUIMTEN) break;
  }
  return uit;
}

export function vindWerkruimte(lijst, naam) {
  const n = normaliseerNaam(naam);
  if (!n) return null;
  return normaliseerWerkruimten(lijst).find((w) => zelfdeNaam(w.naam, n)) || null;
}

/**
 * Werkruimte bewaren: een bestaande naam wordt overschreven (op dezelfde
 * plek in de lijst), een nieuwe komt achteraan.
 * @returns {{ lijst: Array, naam: string } | null} null bij een lege naam
 *   of een volle lijst
 */
export function bewaarWerkruimte(lijst, naam, layout) {
  const n = normaliseerNaam(naam);
  if (!n) return null;
  const oud = normaliseerWerkruimten(lijst);
  const item = { naam: n, layout: normaliseerLayout(layout) };
  const plek = oud.findIndex((w) => zelfdeNaam(w.naam, n));
  if (plek >= 0) {
    const nieuw = oud.slice();
    nieuw[plek] = item;
    return { lijst: nieuw, naam: n };
  }
  if (oud.length >= MAX_WERKRUIMTEN) return null;
  return { lijst: [...oud, item], naam: n };
}

export function verwijderWerkruimte(lijst, naam) {
  const n = normaliseerNaam(naam);
  return normaliseerWerkruimten(lijst).filter((w) => !n || !zelfdeNaam(w.naam, n));
}
