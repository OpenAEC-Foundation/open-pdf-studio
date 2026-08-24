// "Verzenden per e-mail" — slaat de huidige PDF op en opent daarna een
// concept in het standaard-mailprogramma via een mailto:-koppeling. Dat werkt
// op Windows, Linux en macOS identiek, zonder platform-specifieke MAPI- of
// AppleScript-paden (de oude MAPI-route faalde op systemen zonder
// MAPI-geregistreerde client).
//
// Beperking van het mailto:-protocol: een bijlage meesturen kan niet — elk
// mailprogramma negeert bijlage-parameters. Daarom zet de tekst van het
// concept de bestandslocatie klaar, zodat de gebruiker het bestand er zo in
// sleept. De app verstuurt zelf nooit mail; er opent alleen een concept.
import { getActiveDocument } from '../core/state.js';
import { openExternal } from '../core/platform.js';
import { showMessage } from '../bridge.js';
import { savePDF } from './saver.js';
import i18next from 'i18next';

function basename(p) {
  if (!p) return 'document.pdf';
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || 'document.pdf';
}

// Apart en puur gehouden zodat dit in Node te testen is.
export function buildMailtoUrl(subject, body) {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function emailCurrentPdf() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    showMessage(i18next.t('noPdfLoaded'));
    return;
  }
  // Eerst opslaan zodat er een actueel bestand op schijf staat om bij te
  // voegen (vraagt om een locatie bij naamloze documenten).
  const ok = await savePDF();
  if (!ok) return;
  const path = getActiveDocument()?.filePath;
  if (!path) return;

  const subject = basename(path);
  const body = i18next.t('emailBody', { filename: basename(path), path });
  try {
    await openExternal(buildMailtoUrl(subject, body));
  } catch (e) {
    const msg = String(e?.message ?? e);
    showMessage(i18next.t('emailFailed', { error: msg }));
  }
}
