// Eén bron voor de reviewstatussen van markeringen (#1076).
//
// De vaste statussen zijn die van het reviewmodel uit de PDF-specificatie
// (plus 'reviewed', die oudere bestanden en het eigenschappenpaneel kenden).
// Daarnaast kan een team eigen statussen vastleggen in de voorkeuren
// (`markupStatuses`: [{ name, color, closed }]), zoals "Approved" of
// "In progress". Een status op een markering is altijd de sleutel in kleine
// letters (status-history.js); de saver schrijft hem als /State met het
// reviewmodel, zodat andere programma's hem als statusantwoord tonen, en de
// lader leest elke onbekende /State terug als sleutel. Zo heeft een eigen
// status geen eigen opslag nodig.
//
// "Afgerond" bepaalt wat "alleen open punten" verbergt: voltooid, geannuleerd
// en afgewezen zijn klaar; geaccepteerd betekent dat het punt nog verwerkt
// moet worden en telt als open.
//
// Puur: geen app-imports, ook in node te testen.

export const STANDAARD_EIGEN_KLEUR = '#8b5cf6';
const ONBEKEND_KLEUR = '#888888';
const MAX_NAAM = 40;

export const VASTE_STATUSSEN = Object.freeze([
  { key: 'none', i18n: 'annotation.statusNone', color: null, closed: false },
  { key: 'accepted', i18n: 'annotation.statusAccepted', color: '#22c55e', closed: false },
  { key: 'cancelled', i18n: 'annotation.statusCancelled', color: '#6b7280', closed: true },
  { key: 'completed', i18n: 'annotation.statusCompleted', color: '#3b82f6', closed: true },
  { key: 'rejected', i18n: 'annotation.statusRejected', color: '#ef4444', closed: true },
  { key: 'reviewed', i18n: 'annotation.statusReviewed', color: '#8b5cf6', closed: false },
].map((s) => Object.freeze({ ...s, eigen: false })));

const VASTE_SLEUTELS = new Set(VASTE_STATUSSEN.map((s) => s.key));
// 'mixed' is de waarde van het eigenschappenpaneel bij een gemengde selectie.
const GERESERVEERD = new Set([...VASTE_SLEUTELS, 'mixed']);

export const statusSleutelVan = (waarde) => String(waarde ?? '').trim().toLowerCase() || 'none';

const geldigeKleur = (kleur) => (typeof kleur === 'string' && /^#[0-9a-f]{6}$/i.test(kleur.trim())
  ? kleur.trim().toLowerCase() : STANDAARD_EIGEN_KLEUR);

/**
 * De eigen statussen zoals ze in de voorkeuren horen: een naam van 1 tot 40
 * tekens, een kleur #rrggbb en `closed`. Dubbele namen (hoofdletters tellen
 * niet) en namen van vaste statussen vallen weg.
 * @returns {{name: string, color: string, closed: boolean}[]}
 */
export function normaliseerEigenStatussen(lijst) {
  if (!Array.isArray(lijst)) return [];
  const gezien = new Set();
  const uit = [];
  for (const item of lijst) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name ?? '').trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (!name || name.length > MAX_NAAM || GERESERVEERD.has(key) || gezien.has(key)) continue;
    gezien.add(key);
    uit.push({ name, color: geldigeKleur(item.color), closed: item.closed === true });
  }
  return uit;
}

/** De eigen statussen als statusdefinities (met sleutel), in hun volgorde. */
export function eigenStatussen(lijst) {
  return normaliseerEigenStatussen(lijst).map((s) => ({ ...s, key: s.name.toLowerCase(), eigen: true }));
}

/** Alle statussen: eerst de vaste, dan de eigen. */
export function alleStatussen(lijst) {
  return [...VASTE_STATUSSEN, ...eigenStatussen(lijst)];
}

/** De definitie bij een status op een markering, of null als hij onbekend is. */
export function zoekStatus(waarde, lijst) {
  const key = statusSleutelVan(waarde);
  return alleStatussen(lijst).find((s) => s.key === key) || null;
}

/** De kleur van een status; null zonder status; grijs voor een onbekende. */
export function statusKleur(waarde, lijst) {
  const key = statusSleutelVan(waarde);
  if (key === 'none') return null;
  return zoekStatus(key, lijst)?.color || ONBEKEND_KLEUR;
}

/**
 * De naam om te tonen. Vaste statussen via `t` (namespace context), eigen
 * statussen met hun eigen naam, een onbekende status (uit een ander
 * programma) zoals hij is, met een hoofdletter.
 */
export function statusNaam(waarde, lijst, t) {
  const key = statusSleutelVan(waarde);
  const def = zoekStatus(key, lijst);
  if (def?.eigen) return def.name;
  if (def) return t(def.i18n);
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Is een markering met deze status klaar? */
export function isAfgerond(waarde, lijst) {
  return zoekStatus(waarde, lijst)?.closed === true;
}

/** De sleutels van alle afgeronde statussen (voor "alleen open punten"). */
export function afgerondeStatussen(lijst) {
  return new Set(alleStatussen(lijst).filter((s) => s.closed).map((s) => s.key));
}
