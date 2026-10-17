// PDF-miniaturen in Windows Verkenner (#605): de optie in Voorkeuren >
// Bestandskoppeling. Het register is de bron van waarheid (er is geen eigen
// voorkeur die kan afwijken): de app leest de toestand bij het openen van het
// tabblad en zet hem meteen bij het aanvinken, zoals de knoppen van de
// virtuele printer.
//
// Rust-kant: explorer_thumbnails_status / explorer_thumbnails_set in
// src-tauri/src/lib.rs, regels in open-pdf-thumbnails/src/registratie.rs.

/** Toestand als er niets te tonen is (browser, Linux, macOS, fout). */
export const GEEN_MINIATUREN = Object.freeze({
  supported: false,
  available: false,
  enabled: false,
  otherHandler: null,
  defaultAppHandler: null,
});

async function standaardInvoke(cmd, args) {
  const { invoke } = await import('./platform.js');
  return invoke(cmd, args);
}

const tekstOfNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Maakt van wat Rust teruggeeft een volledige, veilige toestand. */
export function normaliseerStatus(s) {
  if (!s || typeof s !== 'object') return { ...GEEN_MINIATUREN };
  return {
    supported: s.supported === true,
    available: s.available === true,
    enabled: s.enabled === true,
    otherHandler: tekstOfNull(s.otherHandler),
    defaultAppHandler: tekstOfNull(s.defaultAppHandler),
  };
}

export async function leesMiniatuurStatus(invoke = standaardInvoke) {
  try {
    return normaliseerStatus(await invoke('explorer_thumbnails_status', {}));
  } catch {
    return { ...GEEN_MINIATUREN };
  }
}

/**
 * Wat er moet gebeuren als de gebruiker het vinkje op `aan` zet:
 * 'niets' | 'aan' | 'uit' | 'vragen' (eerst vragen: een ander programma
 * levert de miniaturen al).
 */
export function bepaalActie(status, aan) {
  const s = normaliseerStatus(status);
  if (!s.supported) return 'niets';
  if (!aan) return s.enabled ? 'uit' : 'niets';
  if (s.enabled || !s.available) return 'niets';
  return s.otherHandler ? 'vragen' : 'aan';
}

/**
 * Voert de keuze uit en geeft de nieuwe toestand. `vraag(naam)` vraagt de
 * gebruiker of de miniaturen van dat andere programma vervangen mogen worden
 * (true = ja). Werpt bij een fout van Rust; de aanroeper meldt die.
 */
export async function zetMiniaturen(aan, status, { vraag, invoke = standaardInvoke } = {}) {
  const s = normaliseerStatus(status);
  const actie = bepaalActie(s, aan);
  if (actie === 'niets') return s;
  if (actie === 'uit') {
    return normaliseerStatus(await invoke('explorer_thumbnails_set', { enabled: false, replaceOther: false }));
  }
  let replaceOther = false;
  if (actie === 'vragen') {
    const ja = typeof vraag === 'function' ? await vraag(s.otherHandler) : false;
    if (!ja) return s;
    replaceOther = true;
  }
  return normaliseerStatus(await invoke('explorer_thumbnails_set', { enabled: true, replaceOther }));
}
