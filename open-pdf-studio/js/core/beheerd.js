// Beheerde modus: de app draait in een centraal beheerde omgeving (zoals de
// OpenAEC-werkplek: een container per gebruiker) en stelt bij het opstarten
// geen eenmalige vragen. Aan met de omgevingsvariabele OPENAEC_BEHEERD=1;
// Rust leest hem (src-tauri/src/beheerd.rs) en geeft hem door via het
// commando `managed_mode`. Zonder die variabele, en in de webversie, is de
// modus uit en verandert er niets.
//
// Elke melding die de modus onderdrukt, vraagt vóór het tonen magMelden(id).

/** Meldingen die in de beheerde modus wegblijven. */
export const ONDERDRUKT_IN_BEHEERDE_MODUS = Object.freeze([
  // De balk "Open PDF Studio als standaard-PDF-app instellen" (bestandskoppeling).
  'standaard-app',
  // Het venster "Wat is er nieuw" na een update (haalt ook release-notes op).
  'wat-is-nieuw',
  // Zoeken naar updates en het updatevenster: de omgeving regelt de versie.
  'update-controle',
  // "Vorige versie installeren": idem.
  'vorige-versie',
]);

/**
 * Mag deze melding hier verschijnen?
 * @param {string} melding  id uit ONDERDRUKT_IN_BEHEERDE_MODUS (of een andere)
 * @param {boolean} beheerd staat de beheerde modus aan?
 */
export function meldingToegestaan(melding, beheerd) {
  return !(beheerd && ONDERDRUKT_IN_BEHEERDE_MODUS.includes(melding));
}

/**
 * Vraagt Rust of de beheerde modus aan staat. Zonder antwoord (webversie,
 * oudere Rust-kant, fout) geldt: uit, het gewone gedrag.
 * @param {(cmd:string)=>Promise<any>} invoke
 */
export async function leesBeheerd(invoke) {
  if (typeof invoke !== 'function') return false;
  try {
    return (await invoke('managed_mode')) === true;
  } catch {
    return false;
  }
}

let _beheerd = null;

/** Staat de beheerde modus aan? Eén keer gevraagd, daarna uit het geheugen. */
export function beheerdeModus() {
  if (!_beheerd) {
    _beheerd = import('./platform.js')
      .then((p) => (p.isTauri() ? leesBeheerd(p.invoke) : false))
      .catch(() => false);
  }
  return _beheerd;
}

/** Mag deze melding nu verschijnen? */
export async function magMelden(melding) {
  return meldingToegestaan(melding, await beheerdeModus());
}

/** Alleen voor tests: de modus vastzetten (of met null weer laten vragen). */
export function zetBeheerdVoorTest(waarde) {
  _beheerd = waarde == null ? null : Promise.resolve(!!waarde);
}
