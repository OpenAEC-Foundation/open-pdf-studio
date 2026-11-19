// Een beveiligd bronbestand voor samenvoegen, pagina's invoegen en pagina
// vervangen (#1134).
//
// pdf-lib leest een versleutelde PDF alleen met `ignoreEncryption`, en
// kopieert dan de nog versleutelde stromen naar een onversleuteld document:
// elke pagina komt er leeg of onleesbaar uit, zonder foutmelding. Veel PDF's
// zijn zo beveiligd zonder dat de gebruiker het merkt (alleen rechten, geen
// openingswachtwoord). De bron wordt daarom eerst ontsleuteld, langs dezelfde
// weg als het openen van een beveiligd bestand (wachtwoord-pdf.js): Rust
// schrijft een ontsleutelde werkkopie, die hier alleen gelezen en meteen weer
// losgelaten wordt. Lukt dat niet, dan wordt het bestand geweigerd.
//
// Geen imports uit de app: alles wat de app doet komt binnen via `deps`, zodat
// de unit-tests dit onder node draaien.

import { vraagEnOntsleutel, soortOntsleutelFout } from './wachtwoord-pdf.js';

/** Foutcode: het bestand is beveiligd en niet ontsleuteld. */
export const FOUT_BEVEILIGD = 'protected';

function beveiligdFout(naam, { geannuleerd = false, oorzaak = null } = {}) {
  return Object.assign(new Error(`${naam || 'The file'} is protected and could not be unlocked`), {
    code: FOUT_BEVEILIGD, geannuleerd, oorzaak,
  });
}

/** Is dit de fout "beveiligd en niet ontsleuteld"? */
export function isBeveiligdFout(fout) {
  return !!fout && typeof fout === 'object' && fout.code === FOUT_BEVEILIGD;
}

/**
 * Laadt een bronbestand in pdf-lib, ontsleuteld als het beveiligd is.
 *
 * @param {string} pad    het bestand (voor het ontsleutelen en de vraag)
 * @param {Uint8Array} bytes  de bytes zoals gelezen
 * @param {object} deps
 * @param {(bytes: Uint8Array) => Promise<any>} deps.laad  PDFDocument.load met ignoreEncryption
 * @param {boolean} deps.desktop  de desktop-app (Rust kan ontsleutelen)
 * @param {(cmd: string, args: object) => Promise<any>} deps.invoke
 * @param {(pad: string) => Promise<ArrayLike<number>>} deps.lees  leest de werkkopie
 * @param {(v: {fileName: string, verkeerd: boolean}) => Promise<string|null>} deps.vraag
 *   vraagt het openingswachtwoord; null = geannuleerd
 * @param {(fn: () => Promise<any>) => Promise<any>} [deps.metVraag]  om alle pogingen heen
 * @returns {Promise<{doc: any, bytes: Uint8Array, ontsleuteld: boolean}>}
 * @throws een fout met code FOUT_BEVEILIGD (`geannuleerd` als de gebruiker
 *   bij het wachtwoord annuleerde)
 */
export async function laadBronPdf(pad, bytes, deps) {
  const doc = await deps.laad(bytes);
  if (!doc.isEncrypted) return { doc, bytes, ontsleuteld: false };

  const naam = String(pad || '').split(/[\\/]/).pop() || '';
  if (!deps.desktop) throw beveiligdFout(naam);

  // Eén poging: Rust schrijft een werkkopie; lezen en meteen weer loslaten.
  const open = async (wachtwoord) => {
    const { path: kopie, security } = await deps.invoke('open_protected_pdf', { path: pad, password: wachtwoord });
    try {
      return new Uint8Array(await deps.lees(kopie));
    } finally {
      try { await deps.invoke('release_protected_pdf', { path: kopie }); } catch { /* opruimen bij afsluiten */ }
      if (security?.handle != null) {
        try { await deps.invoke('pdf_security_release', { handles: [security.handle] }); } catch { /* idem */ }
      }
    }
  };

  let schoon;
  try {
    // Zonder wachtwoord: een bestand met alleen rechten.
    schoon = await open('');
  } catch (fout) {
    if (soortOntsleutelFout(fout) !== 'verkeerd-wachtwoord') throw beveiligdFout(naam, { oorzaak: fout });
    // `metVraag` houdt het wachtwoordvenster open tussen de pogingen en sluit
    // het daarna.
    const metVraag = deps.metVraag || ((fn) => fn());
    try {
      schoon = await metVraag(() => vraagEnOntsleutel({
        vraag: ({ verkeerd }) => deps.vraag({ fileName: naam, verkeerd }),
        ontsleutel: open,
      }));
    } catch (fout2) {
      throw beveiligdFout(naam, { oorzaak: fout2 });
    }
    if (!schoon) throw beveiligdFout(naam, { geannuleerd: true });
  }

  const schoonDoc = await deps.laad(schoon);
  if (schoonDoc.isEncrypted) throw beveiligdFout(naam);
  return { doc: schoonDoc, bytes: schoon, ontsleuteld: true };
}
