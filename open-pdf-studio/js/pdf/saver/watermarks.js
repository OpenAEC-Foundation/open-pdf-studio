import { getActiveDocument } from '../../core/state.js';
import { writeWatermarkContent } from './watermark-content.js';
import { parsePageRange } from '../exporter.js';
import { schrijfKopVoeten, vindKopVoetIds, leesKopVoetDefinities } from './kopvoet.js';

function titelVan(pdfDocLib) {
  try { return pdfDocLib.getTitle() || ''; } catch { return ''; } // een /Title die geen tekst is
}

/**
 * Kop-/voetteksten (#375): de streams van eerdere saves gaan eruit en de
 * huidige komen er opnieuw in, zodat ze niet bij elke save stapelen. Alleen
 * streams van kop-/voetteksten die het document kent worden vervangen; een
 * onbekende (niet ingelezen bij openen) blijft staan, met zijn definitie.
 * @returns {Promise<string[]>} de ids die nu in het bestand staan
 */
async function saveHeaderFootersToPages(pdfDocLib, doc) {
  const kopVoeten = (doc?.watermarks || []).filter(w => w?.type === 'headerFooter');
  const inBestand = vindKopVoetIds(pdfDocLib);
  const bekend = new Set([...(doc?.kopVoetBekend || []), ...kopVoeten.map(w => w.id)]);
  const onbekend = new Set([...inBestand].filter(id => !bekend.has(id)));
  const { geschreven } = await schrijfKopVoeten(pdfDocLib, kopVoeten, {
    vervang: new Set([...inBestand].filter(id => bekend.has(id))),
    behouden: leesKopVoetDefinities(pdfDocLib).filter(d => onbekend.has(d.id)),
    bestandsnaam: doc?.fileName || '',
    titel: doc?.pdfTitel || titelVan(pdfDocLib),
    paginaBereik: parsePageRange,
  });
  return geschreven;
}

// Save watermarks into PDF pages. Geeft { kopVoet: ids } terug: de
// kop-/voetteksten die nu als pagina-inhoud in het bestand staan.
export async function saveWatermarksToPages(pdfDocLib, pages, doc = getActiveDocument(), { annulering = null } = {}) {
  const kopVoet = await saveHeaderFootersToPages(pdfDocLib, doc);
  const ids = await writeWatermarkContent(pdfDocLib, doc?.watermarks || [], {
    known: doc?.kopVoetBekend || [], pageRange: parsePageRange, annulering,
  });
  // Legacy result name: the shared display lifecycle now covers all watermarks.
  return { kopVoet: [...kopVoet, ...ids] };
}
