// Document splitsen (#381): de koppeling met de app. De dialoog
// (SplitDocumentDialog.jsx) geeft de keuzes; hier komen de bytes van het
// document, de vraag of bestaande bestanden overschreven mogen worden, het
// wegschrijven en de melding na afloop. De delen zelf bouwt
// splits-document.js, de regels staan in splits-logica.js.
//
// De bron is de stand waaruit het document getoond wordt (dezelfde bytes als
// extractPages en de saver gebruiken), met de draaiingen, paginalabels en
// bladwijzers van de app erbij. Annotatiewijzigingen die nog niet zijn
// opgeslagen staan nog niet in die bytes; de dialoog zegt dat.

import i18next from '../i18n/config.js';
import { state, getActiveDocument } from '../core/state.js';
import { readBinaryFile, writeBinaryFile, fileExists, isTauri } from '../core/platform.js';
import { getCachedPdfBytes } from './loader.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { showMessage } from '../bridge.js';
import { doelIsGeopend } from './print-doel.js';
import { heeftBeveiligdeInhoud } from './wachtwoord-pdf.js';
import { laadBron, berekenDelen, maakDelen } from './splits-document.js';
import {
  bestandsnamenVoorDelen, padInMap, mbNaarBytes, geldigAantal, geldigeMb, documentNaam,
} from './splits-logica.js';

const t = (sleutel, waarden) => i18next.t(`dialogs:splitDocument.${sleutel}`, waarden);

/** Hoeveel namen een melding opsomt voordat er "en nog N" staat. */
const MAX_GENOEMD = 5;

/** De bytes waaruit het document nu getoond wordt (zoals extractPages en de saver ze zoeken). */
async function bronBytesVan(doc) {
  let bytes = doc.filePath ? getCachedPdfBytes(doc.filePath) : undefined;
  if (!bytes) bytes = getCachedPdfBytes(`__memory__${doc.id}`);
  if (!bytes && doc.filePath) bytes = await readBinaryFile(doc.filePath);
  return bytes || null;
}

function opsomming(namen) {
  const genoemd = namen.slice(0, MAX_GENOEMD).join('\n');
  return namen.length > MAX_GENOEMD
    ? `${genoemd}\n${t('andMore', { count: namen.length - MAX_GENOEMD })}`
    : genoemd;
}

/**
 * Splits het actieve document en schrijf de delen weg.
 * @param {{ modus:'pages'|'bookmarks'|'size'|'ranges', n?:number|string, maxMb?:number|string,
 *           delen?:{start:number, eind:number}[],
 *           map?:string, patroon?:string }} keuzes
 *   map: de uitvoermap (in de browser niet gebruikt: daar worden de delen
 *   gedownload).
 * @returns {Promise<{ok:boolean, aantal?:number, reden?:string}>}
 */
export async function splitsDocument({ modus, n = 1, maxMb = 10, delen: gekozen = [], map = '', patroon = '' }) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return { ok: false, reden: 'geen-document' };
  // De delen zouden onbeveiligd worden: niet voor een beveiligd document.
  if (heeftBeveiligdeInhoud(doc)) {
    showMessage(t('protected'));
    return { ok: false, reden: 'beveiligd' };
  }
  const opDisk = isTauri();
  if (opDisk && !map) return { ok: false, reden: 'geen-map' };

  const appKeuzes = {
    rotaties: { ...(doc.pageRotations || {}) },
    labels: Array.isArray(doc.pageLabels) ? Array.from(doc.pageLabels) : null,
    bladwijzers: Array.isArray(doc.bookmarks) ? doc.bookmarks.map((b) => ({ ...b })) : [],
  };

  showLoading(t('working'));
  let bron;
  let delen;
  try {
    const bytes = await bronBytesVan(doc);
    if (!bytes) throw new Error('no source bytes');
    bron = await laadBron(bytes);
    delen = await berekenDelen(bron, {
      modus,
      delen: gekozen,
      n: geldigAantal(n, 1),
      maxBytes: mbNaarBytes(geldigeMb(maxMb, 10)),
      ...appKeuzes,
    });
  } catch (e) {
    hideLoading();
    console.error('[split] preparing the parts failed:', e);
    showMessage(t('failed', { error: e?.message ?? String(e) }));
    return { ok: false, reden: 'fout' };
  }
  hideLoading();

  if (!delen.length) {
    showMessage(t(modus === 'bookmarks' ? 'noBookmarkParts' : 'noParts'));
    return { ok: false, reden: 'geen-delen' };
  }

  const namen = bestandsnamenVoorDelen(delen, { patroon, naam: documentNaam(doc) });
  const paden = namen.map((naam) => (opDisk ? padInMap(map, naam) : naam));

  // Nooit over een bestand heen dat in de app open staat (ook niet het
  // document zelf).
  const geopend = paden.filter((pad) => doelIsGeopend(pad, state.documents));
  if (opDisk && geopend.length) {
    showMessage(t('targetIsOpen', { files: opsomming(geopend.map((p) => p.split(/[\\/]/).pop())) }));
    return { ok: false, reden: 'doel-is-geopend' };
  }

  if (opDisk) {
    const bestaand = [];
    for (const [i, pad] of paden.entries()) {
      if (await fileExists(pad)) bestaand.push(namen[i]);
    }
    if (bestaand.length) {
      const { showConfirm } = await import('../ui/chrome/confirm-dialog.js');
      const verder = await showConfirm({
        title: t('overwriteTitle'),
        message: t('overwriteMessage', { count: bestaand.length, files: opsomming(bestaand) }),
      });
      if (!verder) return { ok: false, reden: 'afgebroken' };
    }
  }

  showLoading(t('writing', { current: 0, total: delen.length }));
  try {
    const klaar = await maakDelen(bron, delen, {
      ...appKeuzes,
      schrijf: (_deel, bytes, i) => writeBinaryFile(paden[i], bytes),
      voortgang: (aantal, totaal) => showLoading(t('writing', { current: aantal, total: totaal })),
    });
    hideLoading();
    const teGroot = klaar.filter((d) => d.teGroot).length;
    let melding = opDisk
      ? t('done', { count: klaar.length, folder: map })
      : t('doneDownloaded', { count: klaar.length });
    if (teGroot) melding += `\n${t('tooLarge', { count: teGroot })}`;
    showMessage(melding);
    return { ok: true, aantal: klaar.length };
  } catch (e) {
    hideLoading();
    console.error('[split] writing the parts failed:', e);
    showMessage(t('failed', { error: e?.message ?? String(e) }));
    return { ok: false, reden: 'fout' };
  }
}
