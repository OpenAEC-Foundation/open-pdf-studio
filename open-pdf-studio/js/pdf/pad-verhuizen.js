// Een open document krijgt een nieuw pad (bestand hernoemd). Wat per pad
// bewaard staat, verhuist mee: de geschakelde laagstand (lagen-schakelen.js;
// anders vervalt hij als verouderd) en de weergave (pdf-viewport.js; anders
// vraagt de viewport bitmaps uit een pad dat niet meer bestaat, zoals bij
// Opslaan als in #673). Opslaan als doet hetzelfde in saver.js.
import { bestandsnaamUitPad } from '../core/bestandsnaam.js';

/**
 * @param {object} doc
 * @param {string} oudPad
 * @param {string} nieuwPad
 * @param {{verhuisLaagstand?: Function, wisselBestandspad?: Function}} [deps]  voor de test
 */
export async function verhuisOpenDocument(doc, oudPad, nieuwPad, deps = {}) {
  doc.filePath = nieuwPad;
  doc.fileName = (nieuwPad && bestandsnaamUitPad(nieuwPad)) || 'Untitled';
  const verhuisLaagstand = deps.verhuisLaagstand
    ?? (await import('./lagen-schakelen.js')).verhuisLaagstand;
  verhuisLaagstand(doc, oudPad, nieuwPad);
  try {
    const wisselBestandspad = deps.wisselBestandspad
      ?? (await import('./pdf-viewport.js')).wisselBestandspad;
    wisselBestandspad(oudPad, nieuwPad);
  } catch (e) { console.warn('[rename] view not moved to the renamed file:', e); }
}
