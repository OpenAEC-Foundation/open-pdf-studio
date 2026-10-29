// Kop-/voetteksten op het scherm tegenover die in het bestand (#375). Dezelfde
// levenscyclus geldt voor tekst- en beeldwatermerken (#847).
//
// Het scherm tekent kop-/voetteksten zelf (watermark-renderer.js). Staan ze
// ook al als pagina-inhoud in het bestand waaruit de pagina's getekend
// worden, dan zouden ze dubbel staan. `doc._kopVoetBron` is het pad van dat
// bestand zolang dat zo is; de kop-/voetteksten die erin staan dragen
// `uitBestand` en het scherm slaat ze dan over (kopVoetInWeergave).
//
// - Na openen: de definities uit het bestand komen in de lijst, met
//   uitBestand. Wie er een wijzigt of verwijdert, krijgt eerst een weergave
//   zonder de streams (haalKopVoetUitWeergave); daarna tekent het scherm ze.
// - Na opslaan in het bestand dat ook de weergave is: de weergave wordt
//   herladen zonder de streams. reloadFromBytes haalt ze er altijd uit als
//   doc._kopVoetBron de oude weergave was (paginabeheer, bijsnijden, …): de
//   paginanummers in die streams kloppen daarna niet meer.

import { getCachedPdfBytes } from '../pdf/loader.js';
import { readBinaryFile } from '../core/platform.js';
import { leesKopVoetDefinities, vindKopVoetIds } from '../pdf/saver/kopvoet.js';
import { readWatermarkDefinitions, watermarkIds } from '../pdf/saver/watermark-content.js';

export { kopVoetInWeergave } from './kopvoet-tekst.js';

/**
 * Na openen: titel van het document en de kop-/voetteksten uit het bestand.
 * `bron` is het pad waaruit `pdfLibDoc` gelezen is.
 * @returns {boolean} of er kop-/voetteksten bij kwamen
 */
export function leesKopVoetUitBestand(doc, pdfLibDoc, bron) {
  try { doc.pdfTitel = pdfLibDoc.getTitle() || ''; } catch { doc.pdfTitel = ''; }
  const definities = [...leesKopVoetDefinities(pdfLibDoc), ...readWatermarkDefinitions(pdfLibDoc)];
  if (!definities.length) return false;
  const inPaginas = new Set([...vindKopVoetIds(pdfLibDoc), ...watermarkIds(pdfLibDoc)]);
  const huidige = doc.watermarks || [];
  // Een ingeschakelde definitie zonder stream hoort niet meer bij het bestand
  // (een ander programma heeft de pagina's herschreven): niet terugzetten.
  const nieuw = definities
    .filter((d) => !huidige.some((w) => w.id === d.id) && (inPaginas.has(d.id) || !d.enabled))
    .map((d) => ({ ...d, uitBestand: inPaginas.has(d.id) }));
  if (!nieuw.length) return false;
  doc.watermarks = [...huidige, ...nieuw];
  // Ook uitgeschakelde definities moeten bij verwijderen uit de catalogus verdwijnen.
  doc.kopVoetBekend = [...new Set([...(doc.kopVoetBekend || []), ...nieuw.map((d) => d.id)])];
  if (nieuw.some((d) => d.uitBestand)) doc._kopVoetBron = bron;
  return true;
}

/**
 * Na een geslaagde save naar `pad`: de kop-/voetteksten met `ids` staan daar
 * nu als pagina-inhoud.
 */
export function naOpslaanKopVoet(doc, ids, pad) {
  const geschreven = new Set(ids);
  doc.kopVoetBekend = [...new Set([...(doc.kopVoetBekend || []), ...ids, ...(doc.watermarks || []).map(w => w.id)])];
  for (const wm of doc.watermarks || []) {
    if (wm) wm.uitBestand = geschreven.has(wm.id);
  }
  if (ids.length) doc._kopVoetBron = pad;
  else if (doc._kopVoetBron === pad) doc._kopVoetBron = null;
}

/**
 * Staan er kop-/voetteksten in het weergegeven bestand, herlaad de weergave
 * dan zonder (reloadFromBytes haalt de streams eruit). `rotaties`: {} als de
 * bytes de paginadraaiingen van het document al bevatten (net opgeslagen).
 * @returns {Promise<boolean>} of er herladen is
 */
export async function haalKopVoetUitWeergave(doc, { bytes = null, rotaties = null } = {}) {
  if (!doc?._kopVoetBron || doc._kopVoetBron !== doc.filePath) return false;
  const bron = bytes || getCachedPdfBytes(doc.filePath) || await readBinaryFile(doc.filePath);
  if (!bron) return false;
  const { reloadFromBytes } = await import('../pdf/page-manager.js');
  await reloadFromBytes(new Uint8Array(bron), doc.annotations, rotaties ?? doc.pageRotations, doc.currentPage, null, doc);
  doc._kopVoetBron = null;
  return true;
}
