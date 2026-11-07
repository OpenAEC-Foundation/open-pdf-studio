// De samenvatting van een open document waar export-verlies.js mee rekent
// (#629): pagina's, tekst, annotaties, formuliervelden, lagen, bijlagen,
// bladwijzers, scripts en onopgeslagen wijzigingen. Alles via de pdf.js-API
// van doc.pdfDoc; een vraag die mislukt telt als "niet aanwezig", zodat de
// export nooit op de samenvatting vastloopt.

import { heeftFormuliervelden } from './formuliervelden.js';
import { pdfjsRecord } from './pdfjs-record.js';

// Zoveel pagina's bekijken we op tekst: genoeg om een gescand document te
// herkennen, zonder een set van honderden bladen helemaal te lezen.
const TEKST_PAGINAS = 3;

async function probeer(fn, terugval) {
  try {
    return await fn();
  } catch {
    return terugval;
  }
}

async function heeftTekst(pdfDoc, paginas) {
  if (typeof pdfDoc?.getPage !== 'function') return true;
  for (let n = 1; n <= Math.min(paginas, TEKST_PAGINAS); n++) {
    const items = await probeer(async () => {
      const pagina = await pdfDoc.getPage(n);
      const inhoud = await pagina.getTextContent();
      return inhoud?.items || [];
    }, null);
    // Kon de tekst niet gelezen worden, dan gaan we uit van tekst: liever
    // een waarschuwing te veel dan "bevat geen tekst" bij een gewone PDF.
    if (items === null) return true;
    if (items.some((it) => typeof it?.str === 'string' && it.str.trim())) return true;
  }
  return false;
}

async function telLagen(pdfDoc) {
  if (typeof pdfDoc?.getOptionalContentConfig !== 'function') return 0;
  return probeer(async () => {
    const config = await pdfDoc.getOptionalContentConfig();
    return config ? new Map(config).size : 0;
  }, 0);
}

async function telBijlagen(pdfDoc, doc) {
  const inPdf = typeof pdfDoc?.getAttachments === 'function'
    ? await probeer(async () => Object.keys(pdfjsRecord(await pdfDoc.getAttachments()) || {}).length, 0)
    : 0;
  const w = doc?.bijlagenWijzigingen;
  const bij = Array.isArray(w?.toegevoegd) ? w.toegevoegd.length : 0;
  const af = Array.isArray(w?.verwijderd) ? w.verwijderd.length : 0;
  return Math.max(0, inPdf + bij - af);
}

async function heeftBladwijzers(pdfDoc, doc) {
  if (Array.isArray(doc?.bookmarks) && doc.bookmarks.length) return true;
  if (typeof pdfDoc?.getOutline !== 'function') return false;
  return probeer(async () => {
    const outline = await pdfDoc.getOutline();
    return Array.isArray(outline) && outline.length > 0;
  }, false);
}

async function heeftScripts(pdfDoc) {
  if (typeof pdfDoc?.getJSActions !== 'function') return false;
  return probeer(async () => {
    const acties = pdfjsRecord(await pdfDoc.getJSActions());
    return !!acties && Object.keys(acties).length > 0;
  }, false);
}

/**
 * @param {object} doc  een document uit state.documents
 * @param {{annotaties?: object[]}} [opties]  annotaties: alleen deze (bv. de
 *   selectie die naar XFDF gaat); standaard alle annotaties van het document
 * @returns {Promise<object>} de samenvatting voor exportVerliezen
 */
export async function verzamelExportInhoud(doc, opties = {}) {
  const pdfDoc = doc?.pdfDoc || null;
  const paginas = Number(pdfDoc?.numPages) || 0;
  const annotaties = Array.isArray(opties.annotaties) ? opties.annotaties
    : Array.isArray(doc?.annotations) ? doc.annotations : [];
  if (!pdfDoc) {
    return { paginas: 0, tekst: false, annotaties, formuliervelden: false, lagen: 0, bijlagen: 0,
      bladwijzers: false, scripts: false, gewijzigd: !!doc?.modified };
  }
  const [tekst, formuliervelden, lagen, bijlagen, bladwijzers, scripts] = await Promise.all([
    heeftTekst(pdfDoc, paginas),
    probeer(() => heeftFormuliervelden(pdfDoc), false),
    telLagen(pdfDoc),
    telBijlagen(pdfDoc, doc),
    heeftBladwijzers(pdfDoc, doc),
    heeftScripts(pdfDoc),
  ]);
  return { paginas, tekst, annotaties, formuliervelden, lagen, bijlagen, bladwijzers, scripts, gewijzigd: !!doc?.modified };
}
