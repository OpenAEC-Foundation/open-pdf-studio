// OCR-engines uit extensies (#970). Een extensie registreert een engine
// (api.registerOcrEngine); de gebruiker kiest er één als voorkeursengine
// (preferences.ocrEngine, in het venster Tekst herkennen). Elke OCR-taak in de
// app loopt dan via herkenPagina(): de doorzoekbare tekstlaag (ocr.js), de
// paginalabels (pagina-labels-app.js) en de formulierherkenning
// (form-recognition-service.js). Zonder voorkeursengine, als die niet (meer)
// geïnstalleerd is of als hij faalt, draait de ingebouwde Tesseract
// (ocr_pdf_page) zoals voorheen: een kapotte extensie breekt OCR nooit.
//
// Woorden, heen en terug, staan in de ruimte van de ingebouwde engine:
// linksboven als oorsprong, PDF-punten op schaal 1, de pagina mét /Rotate
// maar zonder de draaiing die de gebruiker de pagina in de app gaf.

import { state, getActiveDocument } from '../core/state.js';
import { renderPageTileForDocument } from '../plugins/page-access.js';

/** Id van de ingebouwde Tesseract in de lijst en de voorkeur. */
export const INGEBOUWD = 'builtin';

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const engines = new Map(); // volledig id -> { id, label, pluginId, languages, region, recognize }
const luisteraars = new Set();

const standaardHost = {
  voorkeur: () => state.preferences?.ocrEngine ?? null,
  actiefDocument: () => getActiveDocument(),
  // De ingebouwde Tesseract (src-tauri/src/ocr.rs).
  async ingebouwd(args) {
    const { invoke } = await import('../core/platform.js');
    return invoke('ocr_pdf_page', args);
  },
  renderTile: (...args) => renderPageTileForDocument(...args),
  waarschuw: (...args) => console.warn(...args),
};
let host = standaardHost;

/** Alleen voor tests: vervang (delen van) de host; zonder argument terug naar de standaard. */
export function _zetOcrHost(vervanging) {
  host = vervanging ? { ...standaardHost, ...vervanging } : standaardHost;
}

/** Alleen voor tests: alle engines weg. */
export function _wisOcrEngines() {
  engines.clear();
  meld();
}

function meld() {
  for (const f of luisteraars) {
    try { f(); } catch (e) { console.warn('[ocr] listener failed', e); }
  }
}

/** Aanroep bij elke wijziging van de lijst (venster Tekst herkennen). Geeft een afmelder. */
export function onOcrEnginesChanged(f) {
  luisteraars.add(f);
  return () => luisteraars.delete(f);
}

/**
 * Registreer een engine van extensie `pluginId`. `descriptor`: { id, label,
 * languages?: string[], region?: boolean, recognize(request) => words[] }.
 * @returns {string} het volledige id `<pluginId>:<id>`
 */
export function registreerOcrEngine(pluginId, descriptor) {
  const { id, label, recognize } = descriptor || {};
  if (typeof pluginId !== 'string' || !pluginId) throw new TypeError('OCR engine: extension id required');
  if (typeof id !== 'string' || !ID.test(id)) throw new TypeError('OCR engine id: letters, digits, . _ - (max 64)');
  if (typeof label !== 'string' || !label.trim()) throw new TypeError('OCR engine label is required');
  if (typeof recognize !== 'function') throw new TypeError('OCR engine recognize(request) is required');
  const sleutel = `${pluginId}:${id}`;
  if (engines.has(sleutel)) throw new Error(`OCR engine ${sleutel} is already registered`);
  engines.set(sleutel, {
    id: sleutel,
    label: label.trim().slice(0, 80),
    pluginId,
    languages: Array.isArray(descriptor.languages) ? descriptor.languages.filter((l) => typeof l === 'string').slice(0, 50) : [],
    region: descriptor.region === true,
    recognize,
  });
  meld();
  return sleutel;
}

/** Verwijder een engine (volledig id). */
export function verwijderOcrEngine(sleutel) {
  const weg = engines.delete(sleutel);
  if (weg) meld();
  return weg;
}

/** [{ id, label, languages, region }], de ingebouwde engine eerst. */
export function lijstOcrEngines() {
  return [
    { id: INGEBOUWD, label: 'Tesseract (built-in)', languages: ['auto', 'eng', 'chi_tra', 'chi_tra+eng'], region: false },
    ...[...engines.values()].map(({ id, label, languages, region }) => ({ id, label, languages: [...languages], region })),
  ];
}

/** De engine die draait: de voorkeursengine als die geregistreerd is, anders null (ingebouwd). */
export function actieveOcrEngine() {
  const voorkeur = host.voorkeur();
  return (typeof voorkeur === 'string' && engines.get(voorkeur)) || null;
}

/**
 * Uitvoer van een engine controleren: alleen woorden met tekst en eindige,
 * niet-negatieve vakken; zekerheid geklemd op 0..100 (ontbreekt: 0).
 */
export function geldigeOcrWoorden(woorden) {
  if (!Array.isArray(woorden)) throw new TypeError('OCR engine returned no word list');
  return woorden
    .filter((w) => w && typeof w.text === 'string' && w.text.trim()
      && [w.left, w.top, w.width, w.height].every(Number.isFinite) && w.width >= 0 && w.height >= 0)
    .map((w) => ({
      text: w.text, left: w.left, top: w.top, width: w.width, height: w.height,
      confidence: Number.isFinite(w.confidence) ? Math.max(0, Math.min(100, w.confidence)) : 0,
    }));
}

/**
 * Herken de woorden op één pagina met de voorkeursengine, met de ingebouwde
 * als terugval.
 * @param {object} doc
 * @param {number} pageNum 1-based
 * @param {{ lang?: string, region?: {x,y,width,height}|null, signal?: AbortSignal, rotation?: number }} [opties]
 *   `region`: het vak (in woordruimte) dat er toe doet; alleen engines met
 *   `region: true` krijgen het, de rest leest de hele pagina. `rotation`
 *   (90/180/270, #954): de pagina eerst zoveel rechtsom draaien; dat doet
 *   alleen de ingebouwde engine, de woorden staan dan in die gedraaide ruimte.
 * @returns {Promise<Array<{text,left,top,width,height,confidence}>>}
 */
export async function herkenPagina(doc, pageNum, { lang = 'auto', region = null, signal, rotation = 0 } = {}) {
  const engine = rotation ? null : actieveOcrEngine();
  // Extensie-engines renderen via het actieve document (zoals de rest van de
  // plug-in-API); een ander document gaat naar de ingebouwde engine.
  if (engine && doc && doc === host.actiefDocument() && doc.pdfDoc) {
    try {
      const page = await doc.pdfDoc.getPage(pageNum);
      const vp = page.getViewport({ scale: 1 });
      const woorden = await engine.recognize({
        documentId: doc.id,
        pageNum,
        lang,
        region: engine.region && region ? { x: region.x, y: region.y, width: region.width, height: region.height } : null,
        page: { width: vp.width, height: vp.height },
        signal,
        // Een rastertegel van de pagina in woordruimte (zonder app-draaiing),
        // met de grenzen van renderPageTile (docs/plugin-page-analysis-api.md).
        renderTile: (rect, options = {}) => host.renderTile(doc, pageNum, rect, {
          ...options, signal: options.signal || signal, rotation: 0,
          isCurrent: (candidate) => host.actiefDocument() === candidate,
        }),
      });
      return geldigeOcrWoorden(woorden);
    } catch (e) {
      if (signal?.aborted) throw e;
      host.waarschuw(`[ocr] ${engine.label} failed, using the built-in engine:`, e?.message || e);
    }
  }
  if (signal?.aborted) throw new DOMException('OCR aborted', 'AbortError');
  if (!doc?.filePath) return [];
  const woorden = await host.ingebouwd({
    path: doc.filePath, pageIndex: pageNum - 1, lang, ...(rotation ? { rotation } : {}),
  });
  return Array.isArray(woorden) ? woorden : [];
}
