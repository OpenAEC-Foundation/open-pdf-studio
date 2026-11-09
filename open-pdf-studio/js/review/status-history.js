// Reviewgeschiedenis van een markering (#629): wie zette wanneer welke status.
//
// De huidige status staat zoals altijd in `status`, `statusBy` en `statusAt`.
// Daarnaast houdt `statusHistory` elke wijziging bij als
// { status, by, at } (status in kleine letters, 'none' = status gewist), van
// oud naar nieuw. De saver schrijft elke stap als een eigen verborgen
// statusantwoord (/Text met /IRT, /State, /StateModel Review, /T en /M), zoals
// de PDF-specificatie het reviewmodel beschrijft; de lader leest ze allemaal
// terug. Zo overleeft het verloop van een review het opslaan, ook in andere
// programma's die statusantwoorden tonen.
//
// Puur: geen app-imports, ook in node te testen.

/** Hoeveel stappen een markering bewaart (de oudste vallen eraf). */
export const MAX_STATUS_HISTORY = 100;

const schoon = (s) => {
  const t = String(s ?? '').trim().toLowerCase();
  return t || 'none';
};

function geldigeStap(stap) {
  if (!stap || typeof stap !== 'object') return null;
  const at = typeof stap.at === 'string' && !Number.isNaN(Date.parse(stap.at)) ? stap.at : null;
  return { status: schoon(stap.status), by: typeof stap.by === 'string' ? stap.by : '', at };
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
    return nu === 'none' ? [] : [{ status: nu, by: ann.statusBy || '', at: ann.statusAt || null }];
  }
  if (laatste.status !== nu) lijst.push({ status: nu, by: ann.statusBy || '', at: ann.statusAt || null });
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

/** PDF-waarde van een status voor /State ('accepted' -> 'Accepted', 'none' -> 'None'). */
export function pdfStateName(status) {
  const s = schoon(status);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
