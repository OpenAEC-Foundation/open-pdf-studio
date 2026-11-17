// Reviewgeschiedenis van een markering (#629): wie zette wanneer welke status.
//
// De huidige status staat zoals altijd in `status`, `statusBy` en `statusAt`.
// Daarnaast houdt `statusHistory` elke wijziging bij als
// { status, by, at } (status in kleine letters, 'none' = status gewist), van
// oud naar nieuw. De saver schrijft elke stap als een eigen verborgen
// statusantwoord (/Text met /IRT, /State, /StateModel, /T en /M), zoals de
// PDF-specificatie het beschrijft; de lader leest ze allemaal terug. Zo
// overleeft het verloop van een review het opslaan, ook in andere
// programma's die statusantwoorden tonen.
//
// Het statusmodel (#1076): de vaste statussen staan onder /StateModel Review,
// een eigen status onder de naam van zijn statusset (review/status-sets.js).
// Een stap uit een bestand onthoudt daarnaast het model en de schrijfwijze
// waarmee hij erin stond (`model`, `label`; op de markering `statusModel` en
// `statusLabel` voor de huidige status), zodat een status uit een ander
// programma of een verwijderde status ongewijzigd terug het bestand in gaat.
//
// Puur: alleen status-sets.js, ook in node te testen.

import { REVIEW_MODEL, statusModelVan } from './status-sets.js';

/** Hoeveel stappen een markering bewaart (de oudste vallen eraf). */
export const MAX_STATUS_HISTORY = 100;

const schoon = (s) => {
  const t = String(s ?? '').trim().toLowerCase();
  return t || 'none';
};

function geldigeStap(stap) {
  if (!stap || typeof stap !== 'object') return null;
  const at = typeof stap.at === 'string' && !Number.isNaN(Date.parse(stap.at)) ? stap.at : null;
  const uit = { status: schoon(stap.status), by: typeof stap.by === 'string' ? stap.by : '', at };
  if (typeof stap.model === 'string' && stap.model.trim()) uit.model = stap.model.trim();
  if (typeof stap.label === 'string' && stap.label.trim()) uit.label = stap.label.trim();
  return uit;
}

// De huidige status als stap, met het model en de schrijfwijze uit het bestand.
function huidigeStap(ann, nu) {
  return geldigeStap({ status: nu, by: ann.statusBy || '', at: ann.statusAt || null, model: ann.statusModel, label: ann.statusLabel });
}

/**
 * De reviewgeschiedenis van een markering, van oud naar nieuw. Zonder
 * opgeslagen geschiedenis is dat de huidige status als enige stap (of niets).
 * De laatste stap komt altijd overeen met de huidige status.
 * @returns {{status: string, by: string, at: string|null}[]}
 */
export function statusHistory(ann) {
  if (!ann) return [];
  const lijst = Array.isArray(ann.statusHistory) ? ann.statusHistory.map(geldigeStap).filter(Boolean) : [];
  const nu = schoon(ann.status);
  const laatste = lijst[lijst.length - 1];
  if (!laatste) {
    return nu === 'none' ? [] : [huidigeStap(ann, nu)];
  }
  if (laatste.status !== nu) lijst.push(huidigeStap(ann, nu));
  return lijst;
}

/**
 * Zet de reviewstatus en voeg de stap toe aan de geschiedenis. 'none' haalt
 * de status weg (en legt vast wie dat deed). Dezelfde status nog eens zetten
 * verandert niets.
 * @param {object} ann
 * @param {string} status
 * @param {{door?: string, nu?: string}} [opties]
 * @returns {boolean} of er iets veranderde
 */
export function setStatusWithHistory(ann, status, { door = 'User', nu = new Date().toISOString() } = {}) {
  if (!ann) return false;
  const doel = schoon(status);
  if (doel === schoon(ann.status)) return false;
  const lijst = statusHistory(ann);
  // Model en schrijfwijze hoorden bij de vorige status.
  delete ann.statusModel;
  delete ann.statusLabel;
  if (doel === 'none') {
    ann.status = undefined;
    delete ann.statusBy;
    delete ann.statusAt;
  } else {
    ann.status = doel;
    ann.statusBy = door;
    ann.statusAt = nu;
  }
  lijst.push({ status: doel, by: door, at: nu });
  ann.statusHistory = lijst.slice(-MAX_STATUS_HISTORY);
  return true;
}

/**
 * PDF-waarde van een status voor /State ('accepted' -> 'Accepted', 'none' ->
 * 'None'). Een eigen status (#1076, status-sets.js) krijgt de naam zoals het
 * team hem invoerde: `eigen` is de lijst uit de voorkeuren (markupStatuses).
 */
export function pdfStateName(status, eigen = []) {
  const s = schoon(status);
  const eigenNaam = Array.isArray(eigen)
    ? eigen.find((e) => typeof e?.name === 'string' && e.name.trim().toLowerCase() === s)?.name.trim()
    : null;
  return eigenNaam || s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * De statusantwoorden die de saver voor een markering schrijft, van oud naar
 * nieuw: per stap de tekst voor /State en /StateModel. Een vaste status staat
 * onder Review, een eigen status onder de naam van zijn set; een stap uit een
 * bestand houdt het model en de schrijfwijze die hij had. 'none' wist de
 * status in het model van de stap ervoor. Wisselt het model tussen twee
 * stappen, dan komt er eerst een None in het oude model (`brug`), zodat een
 * lezer die elk model apart bijhoudt daar geen oude status laat staan; de
 * lader slaat die tussenstap over (pdf/loader/status-replies.js).
 * @param {object} ann
 * @param {object[]} [lijst]  statusLijst(voorkeuren) uit status-sets.js
 * @returns {{state: string, model: string, by: string, at: string|null, brug?: boolean}[]}
 */
export function statusAntwoordStappen(ann, lijst = []) {
  const uit = [];
  let vorige = null; // { model, leeg }
  for (const stap of statusHistory(ann)) {
    let model;
    let state;
    if (stap.status === 'none') {
      model = vorige?.model || stap.model || REVIEW_MODEL;
      state = 'None';
    } else {
      model = stap.model || statusModelVan(stap.status, lijst);
      state = stap.label && stap.label.toLowerCase() === stap.status ? stap.label : pdfStateName(stap.status, lijst);
      if (vorige && !vorige.leeg && vorige.model !== model) {
        uit.push({ state: 'None', model: vorige.model, by: stap.by, at: stap.at, brug: true });
      }
    }
    uit.push({ state, model, by: stap.by, at: stap.at });
    vorige = { model, leeg: stap.status === 'none' };
  }
  return uit;
}
