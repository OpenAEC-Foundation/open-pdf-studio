// "Verzenden per e-mail" (lint, Start-tab). Het verzenden zelf staat in
// delen.js (#952): op Windows en Linux opent het standaard-mailprogramma een
// concept met de PDF als bijlage, op Android het deelvenster van het
// systeem. Zonder mailprogramma dat een bijlage aanneemt valt het terug op
// het mailconcept hieronder.
//
// Beperking van het mailto:-protocol: een bijlage meesturen kan niet — elk
// mailprogramma negeert bijlage-parameters. Daarom zet de tekst van het
// concept de bestandslocatie klaar, zodat de gebruiker het bestand er zo in
// sleept. De app verstuurt zelf nooit mail; er opent alleen een concept.
import { openExtern } from '../core/extern-openen.js';
import { showMessage } from '../solid/stores/dialogStore.js';
import i18next from '../i18n/config.js';

function basename(p) {
  if (!p) return 'document.pdf';
  const parts = String(p).split(/[\/]/);
  return parts[parts.length - 1] || 'document.pdf';
}

// Apart en puur gehouden zodat dit in Node te testen is.
export function buildMailtoUrl(subject, body) {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Een mailconcept zonder bijlage, met de bestandslocatie in de tekst. */
export async function openMailConcept(path) {
  const subject = basename(path);
  const body = path ? i18next.t('emailBody', { filename: basename(path), path }) : '';
  try {
    await openExtern(buildMailtoUrl(subject, body));
  } catch (e) {
    const msg = String(e?.message ?? e);
    showMessage(i18next.t('emailFailed', { error: msg }));
  }
}

export async function emailCurrentPdf() {
  const { deelHuidigDocument } = await import('./delen.js');
  return deelHuidigDocument();
}
