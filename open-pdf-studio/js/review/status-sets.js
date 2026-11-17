// Eén bron voor de reviewstatussen van markeringen (#1076).
//
// De vaste statussen zijn die van het reviewmodel uit de PDF-specificatie
// (plus 'reviewed', die oudere bestanden en het eigenschappenpaneel kenden).
// Daarnaast kan een team eigen statussen vastleggen in de voorkeuren
// (`markupStatuses`: [{ name, color, closed }]), zoals "Approved" of
// "In progress". Een status op een markering is altijd de sleutel in kleine
// letters (status-history.js).
//
// Eigen statussen staan in statussets (`markupStatusSets`: [{ name, statuses }])
// waarvan er één actief is (`activeMarkupStatusSet`). De actieve set bepaalt
// wat het statusmenu aanbiedt; de statussen van de andere sets blijven
// herkend (naam, kleur, afgerond), zodat een tekening van een ander project
// leesbaar blijft. Een set is als bestand te delen (exporteerStatusSet /
// importeerStatusSet). De oude platte lijst `markupStatuses` telt als één set.
//
// In de PDF is een eigen status een statusantwoord met /StateModel = de naam
// van de set en /State = de naam van de status; de vaste statussen houden het
// model Review (statusModelVan, status-history.js). De lader leest elke
// onbekende /State terug als sleutel en onthoudt model en schrijfwijze.
//
// Regel voor een verwijderde of hernoemde status: markeringen houden hun
// status. Hij staat niet meer in het menu, maar blijft zichtbaar (grijs, met
// zijn eigen naam), filterbaar zolang hij in het document voorkomt, en gaat
// ongewijzigd terug het bestand in.
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

/**
 * De eigen statussen als statusdefinities (met sleutel), in hun volgorde.
 * `lijst` is een platte lijst uit de voorkeuren of het resultaat van
 * statusLijst(): dan dragen de items `set` (de naam van hun set) en `actief`
 * (hoort bij de actieve set) mee. Zonder die velden is alles actief.
 */
export function eigenStatussen(lijst) {
  if (!Array.isArray(lijst)) return [];
  const gezien = new Set();
  const uit = [];
  for (const item of lijst) {
    const [s] = normaliseerEigenStatussen([item]);
    if (!s) continue;
    const key = s.name.toLowerCase();
    if (gezien.has(key)) continue;
    gezien.add(key);
    uit.push({
      ...s, key, eigen: true,
      set: typeof item.set === 'string' ? item.set : '',
      actief: item.actief !== false,
    });
  }
  return uit;
}

/** Alle bekende statussen: eerst de vaste, dan de eigen (van alle sets). */
export function alleStatussen(lijst) {
  return [...VASTE_STATUSSEN, ...eigenStatussen(lijst)];
}

/** De statussen die te kiezen zijn: de vaste plus die van de actieve set. */
export function kiesbareStatussen(lijst) {
  return alleStatussen(lijst).filter((s) => !s.eigen || s.actief);
}

/**
 * De statussen voor het filter: de kiesbare, plus wat er in het document nog
 * meer voorkomt (een andere set, een verwijderde status, een status uit een
 * ander programma), in volgorde van eerste voorkomen.
 * @param {string[]} aanwezig  de statussen van de markeringen in het document
 * @returns {string[]} sleutels
 */
export function filterStatussen(lijst, aanwezig = []) {
  const uit = kiesbareStatussen(lijst).map((s) => s.key);
  const gezien = new Set(uit);
  for (const waarde of aanwezig || []) {
    const key = statusSleutelVan(waarde);
    if (gezien.has(key)) continue;
    gezien.add(key);
    uit.push(key);
  }
  return uit;
}

/**
 * De plaats van een status in de volgorde van de sets: vaste eerst, dan de
 * eigen statussen in de volgorde van de voorkeuren, onbekende achteraan. Voor
 * het sorteren en groeperen op status.
 */
export function statusRang(waarde, lijst) {
  const key = statusSleutelVan(waarde);
  const i = alleStatussen(lijst).findIndex((s) => s.key === key);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

/** Vergelijker op status: volgorde van de sets, onbekende op naam. */
export function vergelijkStatus(a, b, lijst) {
  const ra = statusRang(a, lijst);
  const rb = statusRang(b, lijst);
  if (ra !== rb) return ra < rb ? -1 : 1;
  return statusSleutelVan(a).localeCompare(statusSleutelVan(b));
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
 * programma, of uit de set verwijderd) zoals hij in het bestand stond
 * (`label`, statusLabel van de markering), anders met een hoofdletter.
 */
export function statusNaam(waarde, lijst, t, label) {
  const key = statusSleutelVan(waarde);
  const def = zoekStatus(key, lijst);
  if (def?.eigen) return def.name;
  if (def) return t(def.i18n);
  if (typeof label === 'string' && label.trim().toLowerCase() === key) return label.trim();
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

// ── Statussets ──────────────────────────────────────────────────────────────

/** De naam van het vaste model; een set mag zo niet heten, net als Marked. */
export const REVIEW_MODEL = 'Review';
/** De set die de oude platte lijst `markupStatuses` wordt. */
export const OUDE_SET_NAAM = 'Custom';
export const STATUS_SET_EXTENSIE = 'opsstatus';
const SET_FORMAAT = 'open-pdf-studio-status-set';
const GERESERVEERDE_SETS = new Set(['review', 'marked']);
const MAX_SETS = 50;
const MAX_PER_SET = 100;

const schoneNaam = (naam) => String(naam ?? '').trim().replace(/\s+/g, ' ');

/** Mag een set zo heten? 1 tot 40 tekens, niet Review of Marked. */
export function geldigeSetNaam(naam) {
  const n = schoneNaam(naam);
  return !!n && n.length <= MAX_NAAM && !GERESERVEERDE_SETS.has(n.toLowerCase());
}

/**
 * De sets zoals ze in de voorkeuren horen. Een set zonder geldige naam of
 * met een naam die al bestaat (hoofdletters tellen niet) valt weg; binnen
 * een set gelden de regels van normaliseerEigenStatussen.
 * @returns {{name: string, statuses: {name: string, color: string, closed: boolean}[]}[]}
 */
export function normaliseerStatusSets(sets) {
  if (!Array.isArray(sets)) return [];
  const gezien = new Set();
  const uit = [];
  for (const set of sets) {
    if (!set || typeof set !== 'object' || !geldigeSetNaam(set.name)) continue;
    const name = schoneNaam(set.name);
    if (gezien.has(name.toLowerCase())) continue;
    gezien.add(name.toLowerCase());
    uit.push({ name, statuses: normaliseerEigenStatussen(set.statuses).slice(0, MAX_PER_SET) });
    if (uit.length >= MAX_SETS) break;
  }
  return uit;
}

/**
 * De sets en de actieve set uit de voorkeuren. Zonder sets telt de oude
 * platte lijst `markupStatuses` als één actieve set. `actief` is de naam van
 * de actieve set, of '' voor alleen de vaste statussen.
 * @returns {{sets: {name: string, statuses: object[]}[], actief: string}}
 */
export function statusSetsVan(prefs) {
  let sets = normaliseerStatusSets(prefs?.markupStatusSets);
  let gekozen = typeof prefs?.activeMarkupStatusSet === 'string' ? prefs.activeMarkupStatusSet : '';
  if (sets.length === 0) {
    const oud = normaliseerEigenStatussen(prefs?.markupStatuses);
    if (oud.length > 0) {
      sets = [{ name: OUDE_SET_NAAM, statuses: oud }];
      gekozen = OUDE_SET_NAAM;
    }
  }
  const actief = sets.find((s) => s.name.toLowerCase() === schoneNaam(gekozen).toLowerCase())?.name || '';
  return { sets, actief };
}

/**
 * De eigen statussen van alle sets als één lijst voor de functies hierboven:
 * eerst die van de actieve set, dan de rest. Elk item kent zijn set en of
 * die actief is. Komt een naam in meer sets voor, dan wint de actieve set,
 * daarna de eerste.
 */
export function statusLijst(prefs) {
  const { sets, actief } = statusSetsVan(prefs);
  const volgorde = [...sets.filter((s) => s.name === actief), ...sets.filter((s) => s.name !== actief)];
  return volgorde.flatMap((set) => set.statuses.map((s) => ({ ...s, set: set.name, actief: set.name === actief })));
}

/**
 * Het statusmodel waaronder een status in de PDF komt: Review voor de vaste
 * statussen en voor wat we niet kennen, anders de naam van de set.
 */
export function statusModelVan(waarde, lijst) {
  const def = zoekStatus(waarde, lijst);
  return def?.eigen && geldigeSetNaam(def.set) ? schoneNaam(def.set) : REVIEW_MODEL;
}

/** Een item een plaats omhoog (-1) of omlaag (+1); buiten de lijst: ongewijzigd. */
export function verplaats(lijst, index, stap) {
  const doel = index + stap;
  if (!Array.isArray(lijst) || index < 0 || index >= lijst.length || doel < 0 || doel >= lijst.length) return lijst;
  const uit = [...lijst];
  [uit[index], uit[doel]] = [uit[doel], uit[index]];
  return uit;
}

/** `basis`, of `basis 2`, `basis 3`... als die naam al bestaat. */
export function vrijeNaam(basis, bestaande) {
  const bezet = new Set((bestaande || []).map((n) => schoneNaam(n).toLowerCase()));
  const start = schoneNaam(basis).slice(0, MAX_NAAM - 4) || 'Set';
  if (!bezet.has(start.toLowerCase())) return start;
  for (let i = 2; ; i++) {
    const naam = `${start} ${i}`;
    if (!bezet.has(naam.toLowerCase())) return naam;
  }
}

/** Een set als tekst voor een bestand dat een team deelt. */
export function exporteerStatusSet(set) {
  const [schoon] = normaliseerStatusSets([set]);
  if (!schoon) throw new Error('invalid-status-set');
  return `${JSON.stringify({ format: SET_FORMAAT, version: 1, name: schoon.name, statuses: schoon.statuses }, null, 2)}\n`;
}

/**
 * Lees een gedeelde set. Geeft { set } of { fout } met 'unreadable' (geen
 * JSON), 'format' (geen statusset), 'version' (nieuwer dan deze versie) of
 * 'empty' (geen bruikbare naam of statussen).
 */
export function importeerStatusSet(tekst) {
  let data;
  try { data = JSON.parse(String(tekst ?? '').replace(/^﻿/, '')); } catch { return { fout: 'unreadable' }; }
  if (!data || typeof data !== 'object' || data.format !== SET_FORMAAT) return { fout: 'format' };
  if (typeof data.version !== 'number' || data.version > 1) return { fout: 'version' };
  const [set] = normaliseerStatusSets([{ name: data.name, statuses: data.statuses }]);
  if (!set || set.statuses.length === 0) return { fout: 'empty' };
  return { set };
}

/**
 * Zet een geïmporteerde set in de lijst. Een set met dezelfde naam wordt
 * vervangen (het team heeft zijn set bijgewerkt) en houdt haar plaats.
 * @returns {{sets: object[], vervangen: boolean}}
 */
export function voegSetIn(sets, set) {
  const huidige = normaliseerStatusSets(sets);
  const [nieuw] = normaliseerStatusSets([set]);
  if (!nieuw) return { sets: huidige, vervangen: false };
  const i = huidige.findIndex((s) => s.name.toLowerCase() === nieuw.name.toLowerCase());
  if (i < 0) return { sets: [...huidige, nieuw], vervangen: false };
  return { sets: huidige.map((s, j) => (j === i ? nieuw : s)), vervangen: true };
}
