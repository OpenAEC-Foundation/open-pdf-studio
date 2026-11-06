// Paginalabels in de app: lezen bij het openen, hernoemen, meeverhuizen met
// paginabewerkingen en de vakken van de naambouwer lezen. De pure logica
// (normaliseren, /PageLabels schrijven, tekst in een vak) staat in
// pagina-labels.js.

import { isTauri } from '../core/platform.js';
import { herkenPagina, actieveOcrEngine } from './ocr-engines.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import {
  normaliseerLabels, zijnGewoneNummers, herschikLabels, labelVan, vulLabelsAan,
  tekstInGebied, draaiVak, ocrLezing, moetGedraaidLezen, kiesBesteOcrLezing,
  vakNaarOcrDraaiing, OCR_DRAAIINGEN,
} from './pagina-labels.js';

/**
 * /PageLabels uit de PDF in doc.pageLabels. Gewone nummering 1..N wordt null,
 * zodat de interface gewoon paginanummers blijft tonen. Onopgeslagen
 * bewerkingen overleven het opnieuw laden van hetzelfde document, zolang het
 * aantal pagina's gelijk bleef.
 */
export async function laadPaginaLabels(doc) {
  if (!doc?.pdfDoc) return;
  const aantal = doc.pdfDoc.numPages;
  if (doc.pageLabelsDirty && doc.pageLabels?.length === aantal) return;
  let labels = null;
  try {
    labels = await doc.pdfDoc.getPageLabels();
  } catch (e) {
    console.warn('[paginalabels] /PageLabels niet gelezen:', e?.message || e);
  }
  const geldig = Array.isArray(labels) && labels.length === aantal && !zijnGewoneNummers(labels);
  doc.pageLabels = geldig ? labels.map((l) => (typeof l === 'string' ? l : String(l ?? ''))) : null;
  doc.pageLabelsDirty = false;
}

/** Alle labels vervangen (lijst; leeg of null = paginanummer). */
export function zetPaginaLabels(doc, labels) {
  const aantal = doc?.pdfDoc?.numPages;
  if (!aantal) return;
  // Eén keer toewijzen: het document bewaart een kopie van de lijst.
  doc.pageLabels = normaliseerLabels(labels, aantal);
  doc.pageLabelsDirty = true;
  markDocumentModified(doc);
}

/** Eén pagina hernoemen; leeg zet haar terug op haar nummer. */
export function zetPaginaLabel(doc, pageNum, label) {
  const aantal = doc?.pdfDoc?.numPages;
  if (!aantal || !(pageNum >= 1 && pageNum <= aantal)) return;
  const lijst = Array.from({ length: aantal }, (_, i) => labelVan(doc.pageLabels, i + 1));
  lijst[pageNum - 1] = typeof label === 'string' ? label : '';
  zetPaginaLabels(doc, lijst);
}

// Labels per stand van de bytes. Ongedaan maken en opnieuw doen van een
// paginabewerking laden dezelfde bytes opnieuw; zo komen de labels van die
// stand mee terug in plaats van op de verkeerde pagina's te blijven staan.
const _labelsBijBytes = new WeakMap();

/**
 * Na het herladen van een document uit nieuwe bytes (reloadFromBytes).
 * Met een paginatoewijzing (invoegen, verwijderen, verplaatsen) verhuizen de
 * namen mee met hun pagina en schrijft de volgende save de /PageLabels
 * opnieuw: de bytes van zo'n bewerking dragen de oude (of geen) labels.
 * `ingevoegdeLabels` (paginanummer → label): de labels van ingevoegde
 * pagina's die het samenvoegen in de nieuwe bytes schreef.
 */
export async function labelsNaHerladen(doc, { oudeBytes = null, nieuweBytes = null, pageMapping = null, ingevoegdeLabels = null } = {}) {
  if (!doc?.pdfDoc) return;
  const aantal = doc.pdfDoc.numPages;
  const voor = { labels: doc.pageLabels ? Array.from(doc.pageLabels) : null, dirty: !!doc.pageLabelsDirty };
  if (oudeBytes) _labelsBijBytes.set(oudeBytes, voor);

  const bewaard = nieuweBytes ? _labelsBijBytes.get(nieuweBytes) : null;
  let na;
  if (bewaard && (!bewaard.labels || bewaard.labels.length === aantal)) {
    na = bewaard;
  } else if (pageMapping) {
    const labels = vulLabelsAan(herschikLabels(voor.labels, pageMapping, aantal), ingevoegdeLabels, aantal);
    na = { labels, dirty: voor.dirty || !!labels || !!voor.labels };
  } else if (!voor.labels || voor.labels.length === aantal) {
    na = voor;
  } else {
    doc.pageLabelsDirty = false;
    await laadPaginaLabels(doc);
    na = { labels: doc.pageLabels ? Array.from(doc.pageLabels) : null, dirty: false };
  }
  doc.pageLabels = na.labels ? [...na.labels] : null;
  doc.pageLabelsDirty = na.dirty;
  if (nieuweBytes) _labelsBijBytes.set(nieuweBytes, na);
}

// ── Vakken lezen voor de naambouwer ──────────────────────────────────────

// OCR-woorden per pagina. Bewust niet in doc.ocrResults: daarvan schrijft de
// saver een onzichtbare tekstlaag in het bestand, en de naambouwer leest alleen.
const _ocrWoorden = new Map();

// `graden`: de pagina eerst zoveel rechtsom draaien (verticale tekst, #954);
// de woorden staan dan in die gedraaide ruimte.
async function ocrWoorden(doc, pageNum, graden = 0) {
  const bestaand = doc.ocrResults?.[pageNum];
  if (!graden && Array.isArray(bestaand) && bestaand.length) return bestaand;
  if (!doc.filePath || !isTauri()) return [];
  // Voorkeursengine (#970) hoort bij de sleutel: een andere keuze leest opnieuw.
  const engine = graden ? '' : (actieveOcrEngine()?.id || '');
  const sleutel = `${doc.id}|${doc.filePath}|${pageNum}|${graden}|${engine}`;
  if (_ocrWoorden.has(sleutel)) return _ocrWoorden.get(sleutel);
  const woorden = await herkenPagina(doc, pageNum, { lang: 'auto', rotation: graden });
  if (_ocrWoorden.size > 500) _ocrWoorden.clear();
  const lijst = Array.isArray(woorden) ? woorden : [];
  _ocrWoorden.set(sleutel, lijst);
  return lijst;
}

// Tekstlaag van één pagina in app-ruimte: schaal 1, met /Rotate en de
// draaiing die de gebruiker in de app gaf (zoals de annotaties).
async function paginaTekst(doc, pageNum) {
  const page = await doc.pdfDoc.getPage(pageNum);
  const extra = (((doc.pageRotations?.[pageNum] || 0) % 360) + 360) % 360;
  const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + extra) % 360 });
  const basis = page.getViewport({ scale: 1 });
  const inhoud = await page.getTextContent();
  return { items: inhoud.items, viewport, extra, breedte: basis.width, hoogte: basis.height };
}

/**
 * Tekst in `vak` (app-ruimte) op pagina `pageNum`: eerst de tekstlaag, dan
 * OCR als het vak daar leeg is en `ocr` aan staat.
 * @returns {Promise<{tekst:string, bron:'tekst'|'ocr'|''}>}
 */
export async function leesGebied(doc, pageNum, vak, { ocr = true, pagina = null } = {}) {
  let p = pagina;
  try {
    p = p || await paginaTekst(doc, pageNum);
    const tekst = tekstInGebied(p.items, p.viewport, vak);
    if (tekst) return { tekst, bron: 'tekst' };
  } catch (e) {
    console.warn('[paginalabels] tekstlaag niet gelezen:', e?.message || e);
  }
  if (ocr) {
    try {
      // OCR-woorden staan in de ruimte van de pagina mét /Rotate maar zonder
      // de draaiing uit de app; draai ze mee naar de ruimte van het vak.
      const extra = p?.extra || 0;
      // Een extensie-engine die vakken leest (#970) krijgt alleen dit vak, in
      // zijn eigen ruimte (zonder de app-draaiing); anders de hele pagina.
      let bron;
      if (actieveOcrEngine()?.region && p && doc.filePath && isTauri()) {
        bron = await herkenPagina(doc, pageNum, { lang: 'auto', region: vakNaarOcrDraaiing(vak, p.breedte, p.hoogte, extra, 0) });
      } else {
        bron = await ocrWoorden(doc, pageNum);
      }
      const woorden = bron.map((w) => {
        if (!extra || !p) return w;
        const r = draaiVak({ x: w.left, y: w.top, width: w.width, height: w.height }, p.breedte, p.hoogte, extra);
        return { ...w, left: r.x, top: r.y, width: r.width, height: r.height };
      });
      const lezingen = [ocrLezing(woorden, vak, 0)];
      // Leeg of onzeker: misschien staat de tekst verticaal (#954). Lees de
      // pagina dan ook een kwartslag gedraaid en neem de zekerste lezing.
      if (moetGedraaidLezen(lezingen[0]) && p && doc.filePath && isTauri()) {
        for (const graden of OCR_DRAAIINGEN) {
          try {
            const gedraaid = await ocrWoorden(doc, pageNum, graden);
            lezingen.push(ocrLezing(gedraaid, vakNaarOcrDraaiing(vak, p.breedte, p.hoogte, extra, graden), graden));
          } catch (e) {
            console.warn(`[paginalabels] OCR ${graden}° mislukt:`, e?.message || e);
          }
        }
      }
      const beste = kiesBesteOcrLezing(lezingen);
      if (beste) return { tekst: beste.tekst, bron: 'ocr' };
    } catch (e) {
      console.warn('[paginalabels] OCR mislukt:', e?.message || e);
    }
  }
  return { tekst: '', bron: '' };
}

/**
 * Alle vakken op alle pagina's lezen. `gebieden` = [{ n, rect }].
 * @returns {Promise<Array<{page:number, teksten:Object, ocr:boolean}>>}
 */
export async function leesAllePaginas(doc, gebieden, { ocr = true, bijVoortgang, isAfgebroken } = {}) {
  const pdf = doc.pdfDoc;
  const totaal = pdf.numPages;
  const rijen = [];
  for (let p = 1; p <= totaal; p++) {
    if (isAfgebroken?.() || doc.pdfDoc !== pdf) break;
    let pagina = null;
    try { pagina = await paginaTekst(doc, p); } catch { pagina = null; }
    const teksten = {};
    let metOcr = false;
    for (const g of gebieden) {
      const r = await leesGebied(doc, p, g.rect, { ocr, pagina });
      if (r.bron === 'ocr') metOcr = true;
      teksten[g.n] = r.tekst;
    }
    rijen.push({ page: p, teksten, ocr: metOcr });
    bijVoortgang?.(p, totaal);
  }
  return rijen;
}
