// Rol van deze app-instantie: hoofdinstantie of tweede instantie.
//
// Een losgemaakt tabblad opent in een tweede instantie (eigen proces,
// gestart met --new-instance; zie src-tauri/src/instantie.rs). Taken die per
// gebruiker maar één keer mogen draaien, blijven bij de hoofdinstantie.

/** Taken die een tweede instantie overslaat. */
export const ALLEEN_HOOFDINSTANTIE = Object.freeze([
  // De sessie hoort bij de hoofdinstantie; een tweede instantie die haar
  // ene document wegschrijft, zou bij de volgende start de tabbladen van de
  // hoofdinstantie kwijtmaken. Herstellen zou alle tabbladen dubbel openen.
  'sessie-bewaren',
  'sessie-herstellen',
  // Eén poort, één server.
  'mcp-koppeling',
  // Anders opent elke instantie dezelfde printopdracht.
  'printwachtrij',
  // Een globale sneltoets kan maar door één proces geclaimd worden.
  'prtscn',
  // De vraag "standaard-app?" hoeft niet per venster.
  'standaard-app',
]);

/**
 * Mag deze instantie de taak uitvoeren?
 * @param {string} taak
 * @param {{tweede:boolean}|null|undefined} rol
 */
export function taakToegestaan(taak, rol) {
  if (!rol || !rol.tweede) return true;
  return !ALLEEN_HOOFDINSTANTIE.includes(taak);
}

/**
 * Vraagt de rol aan Rust (`instance_role`). Zonder antwoord geldt de
 * hoofdinstantie, het gedrag van vóór de tweede instanties.
 * @param {(cmd:string)=>Promise<any>} invoke
 * @returns {Promise<{tweede:boolean}>}
 */
export async function leesInstantieRol(invoke) {
  if (typeof invoke !== 'function') return { tweede: false };
  try {
    const r = await invoke('instance_role');
    return { tweede: !!r?.secondary };
  } catch {
    return { tweede: false };
  }
}

let _rol = null;

/** De rol van deze instantie (één keer opgehaald, daarna uit het geheugen). */
export function instantieRol(invoke) {
  if (!_rol) _rol = leesInstantieRol(invoke);
  return _rol;
}
