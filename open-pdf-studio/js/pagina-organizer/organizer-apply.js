// Het plan van de pagina-organizer toepassen op het document (#764).
//
// Het plan (organizer-model.js) is een lijst pagina's: een deel komt uit het
// huidige document, een deel is nieuw (blanco of uit een ingevoegd bestand).
// Hier wordt daar in ÉÉN pdf-lib-ronde een nieuw document van gemaakt, zodat
// verplaatsen, draaien, verwijderen en invoegen samen één ongedaan-maakstap
// zijn — Ctrl+Z zet dus in één keer de hele organizer-sessie terug.
//
// De aanpak is die van reorderPages() in page-manager.js: pagina's kopiëren,
// een paginatoewijzing (oud → nieuw) opstellen, de annotaties en draaiingen
// daarmee mee laten verhuizen, en de nieuwe bytes via reloadFromBytes() in de
// app hangen. De draaiing van een pagina gaat mee in doc.pageRotations, niet in
// de bytes: de app tekent die draaiing bovenop /Rotate en de saver schrijft
// hem bij het opslaan weg — precies zoals de draaiknoppen het doen.

// Alleen pdf-lib en het plan-model staan hierboven: de app-modules (state,
// loader, page-manager, undo, platform, dialogen) komen pas binnen als een plan
// echt wordt toegepast. Zo blijft dit bestand importeerbaar in de unit-tests,
// die een nagebootste omgeving meegeven.
import { PDFDocument, degrees } from 'pdf-lib';
import { bouwToewijzing } from './organizer-model.js';

/** A4 in punten: de maat van een blanco pagina als er geen maat meekomt. */
export const A4 = Object.freeze({ breedte: 595.28, hoogte: 841.89 });

const PDF_FILTERS = [{ name: 'PDF Files', extensions: ['pdf'] }];

/**
 * De nieuwe bytes voor het plan.
 *
 * @param {object} plan
 * @param {Uint8Array} bronBytes  de bytes van het huidige document
 * @param {{ rotatieInBytes?: boolean, PDFDocumentImpl?: typeof PDFDocument }} [opties]
 *   `rotatieInBytes`: de draaiing van een pagina in /Rotate van het bestand
 *   zetten. Dat hoort bij een los bestand (uittreksel), niet bij de
 *   werkkopie van het document — daar reist de draaiing in pageRotations mee.
 * @returns {Promise<{bytes: Uint8Array, paginas: object[]}>}
 */
export async function bouwNieuweBytes(plan, bronBytes, { rotatieInBytes = false, PDFDocumentImpl = PDFDocument } = {}) {
  const uit = await PDFDocumentImpl.create();
  let bron = null;
  const perBestand = new Map();

  for (const item of plan.items) {
    let page = null;
    if (item.bron === 'doc') {
      if (!bron) bron = await PDFDocumentImpl.load(bronBytes.slice(), { ignoreEncryption: true, updateMetadata: false });
      [page] = await uit.copyPages(bron, [item.pagina - 1]);
    } else if (item.bron === 'bestand') {
      const bestand = plan.bestanden.get(item.bestandId);
      if (!bestand?.bytes) continue;
      let src = perBestand.get(item.bestandId);
      if (!src) {
        src = await PDFDocumentImpl.load(bestand.bytes.slice(), { ignoreEncryption: true, updateMetadata: false });
        perBestand.set(item.bestandId, src);
      }
      [page] = await uit.copyPages(src, [item.pagina - 1]);
    } else {
      // Blanco pagina: de maat die de gebruiker koos, of A4.
      const breedte = item.breedte || A4.breedte;
      const hoogte = item.hoogte || A4.hoogte;
      page = uit.addPage([breedte, hoogte]);
    }
    if (page && item.bron !== 'blanco') uit.addPage(page);
  }

  const paginas = uit.getPages();
  if (rotatieInBytes) {
    paginas.forEach((pagina, i) => {
      const extra = plan.items[i]?.rotatie;
      if (extra) pagina.setRotation(degrees(((pagina.getRotation().angle + extra) % 360 + 360) % 360));
    });
  }
  return { bytes: new Uint8Array(await uit.save()), paginas };
}

/** De annotaties van pagina's die blijven, op hun nieuwe paginanummer. */
export function remapAnnotaties(annotaties, pageMapping) {
  const uit = [];
  for (const ann of annotaties || []) {
    const nieuw = pageMapping[ann.page];
    if (nieuw !== undefined && nieuw !== null) uit.push({ ...ann, page: nieuw });
  }
  return uit;
}

/**
 * De draaiingen van het resultaat: de draaiing die de pagina al had (uit de
 * app) plus wat de gebruiker in de organizer deed, per nieuwe paginanummer.
 * Pagina's die nieuw zijn (blanco, ingevoegd) beginnen bij hun eigen draaiing.
 */
export function bouwRotaties(plan, oudeRotaties = {}, pageMapping = {}) {
  const uit = {};
  plan.items.forEach((item, i) => {
    const nieuw = i + 1;
    const oud = item.bron === 'doc' ? (oudeRotaties[item.pagina] || 0) : 0;
    const rotatie = (((oud + (item.rotatie || 0)) % 360) + 360) % 360;
    if (rotatie) uit[nieuw] = rotatie;
  });
  return uit;
}

/** De app zelf; de tests geven een nagebootste omgeving mee. */
async function appOmgeving() {
  const [st, loader, pm, undo, platform, dialogs, bridge, i18n] = await Promise.all([
    import('../core/state.js'),
    import('../pdf/loader.js'),
    import('../pdf/page-manager.js'),
    import('../core/undo-manager.js'),
    import('../core/platform.js'),
    import('../ui/chrome/dialogs.js'),
    import('../bridge.js'),
    import('../i18n/config.js'),
  ]);
  const i18next = i18n.default || i18n;
  return {
    document: () => st.getActiveDocument(),
    bytes: () => loader.getCachedPdfBytes(pm.getCacheKey()),
    herlaad: (bytes, ann, rot, pag, extra) => pm.reloadFromBytes(bytes, ann, rot, pag, extra),
    legVast: (...args) => undo.recordPageStructure(...args),
    kiesPad: (naam) => platform.saveFileDialog(naam, PDF_FILTERS),
    schrijf: (pad, bytes) => platform.writeBinaryFile(pad, bytes),
    toon: () => dialogs.showLoading(i18next.t('organizer.applying')),
    verberg: () => dialogs.hideLoading(),
    meld: (tekst) => bridge.showMessage(tekst),
  };
}

function documentNaam(doc) {
  return String(doc?.fileName || 'document').replace(/\.pdf$/i, '') || 'document';
}

/**
 * Schrijf elk deel van een gesplitst plan als eigen bestand. De delen komen uit
 * de NIEUWE bytes, met de paginanummers van het resultaat. Voor elk deel vraagt
 * de app waar het heen moet; annuleren slaat dat deel over.
 * @returns {Promise<string[]>} de geschreven paden
 */
export async function schrijfDelen(delen, {
  bytes, rotaties = {}, labels = null, bladwijzers = [], naam = 'document', omgeving,
} = {}) {
  const o = omgeving || await appOmgeving();
  const { laadBron, deelBytes } = await import('../pdf/splits-document.js');
  const bron = await laadBron(bytes);
  const geschreven = [];
  for (const deel of delen) {
    const pad = await o.kiesPad(`${naam}_${deel.nummer}van${delen.length}.pdf`);
    if (!pad) continue;
    const deelBytesUit = await deelBytes(bron, {
      start: deel.start, eind: deel.eind, rotaties, labels, bladwijzers,
    });
    await o.schrijf(pad, deelBytesUit);
    geschreven.push(pad);
  }
  return geschreven;
}

/**
 * Pas het plan toe op het document: één ongedaan-maakstap, en — als er
 * splitspunten staan — elk deel als eigen bestand.
 *
 * @param {object} plan
 * @param {object} [omgeving]  de app zelf; de tests geven een nagebootste
 * @returns {Promise<{toegepast: boolean, reden?: string, delen: string[]}>}
 *   `reden` zegt waarom er niets gebeurde: 'geen-document', 'leeg' of
 *   'geen-bytes'.
 */
export async function pasPlanToe(plan, omgeving) {
  const o = omgeving || await appOmgeving();
  const doc = o.document();
  if (!doc?.pdfDoc) return { toegepast: false, reden: 'geen-document', delen: [] };
  if (!plan?.items?.length) return { toegepast: false, reden: 'leeg', delen: [] };

  const aantal = doc.pdfDoc.numPages;
  const bronBytes = o.bytes();
  if (!bronBytes) return { toegepast: false, reden: 'geen-bytes', delen: [] };

  const { pageMapping, delen, doelPagina } = bouwToewijzing(plan, aantal, doc.currentPage);
  const oudeAnnotaties = (doc.annotations || []).map((a) => ({ ...a }));
  const oudeRotaties = { ...doc.pageRotations };
  const oudePagina = doc.currentPage;

  o.toon();
  try {
    const { bytes, paginas } = await bouwNieuweBytes(plan, bronBytes);
    const annotaties = remapAnnotaties(oudeAnnotaties, pageMapping);
    const rotaties = bouwRotaties(plan, oudeRotaties, pageMapping);
    // Meetschalen van de nieuwe pagina's komen uit de pagina's zelf (#400).
    const { viewportsVanPaginas } = await import('../pdf/pdf-viewports.js');
    const newViewports = viewportsVanPaginas(paginas, 1);

    const inModel = await o.herlaad(bytes, annotaties, rotaties, doelPagina, { pageMapping, newViewports });
    o.legVast(bronBytes, oudeAnnotaties, oudeRotaties, oudePagina, bytes, inModel || annotaties, rotaties, doelPagina);

    let geschreven = [];
    if (delen.length > 1) {
      geschreven = await schrijfDelen(delen, {
        bytes, rotaties, labels: doc.pageLabels || null, bladwijzers: doc.bookmarks || [],
        naam: documentNaam(doc), omgeving: o,
      });
    }
    return { toegepast: true, delen: geschreven };
  } catch (e) {
    console.error('[organizer] plan toepassen mislukt:', e);
    try { o.meld?.(`Page changes could not be applied: ${e?.message || e}`); } catch { /* melden is niet kritiek */ }
    return { toegepast: false, reden: 'fout', delen: [] };
  } finally {
    o.verberg();
  }
}

/**
 * De gekozen pagina's als nieuw PDF-bestand wegschrijven ("Uittreksel" in de
 * selectiebalk). De selectie mag blanco en ingevoegde pagina's bevatten: het
 * bestand wordt uit het plan zelf gebouwd, met de draaiingen erin.
 * @returns {Promise<string|null>} het pad, of null als de gebruiker afbrak
 */
export async function exporteerSelectie(plan, ids, omgeving) {
  const o = omgeving || await appOmgeving();
  const doc = o.document();
  if (!doc?.pdfDoc) return null;
  const bronBytes = o.bytes();
  if (!bronBytes) return null;

  const gekozen = new Set(Array.isArray(ids) ? ids : [ids]);
  const items = plan.items.filter((item) => gekozen.has(item.id));
  if (!items.length) return null;

  const i = bouwToewijzing(plan, doc.pdfDoc.numPages, doc.currentPage);
  const van = i.volgorde.findIndex((v) => v.id === items[0].id);
  const tot = i.volgorde.findIndex((v) => v.id === items[items.length - 1].id) + 1;
  const pad = await o.kiesPad(`${documentNaam(doc)}_${van + 1}-${tot}.pdf`);
  if (!pad) return null;

  const { bytes } = await bouwNieuweBytes(
    { items, splits: new Set(), bestanden: plan.bestanden },
    bronBytes,
    { rotatieInBytes: true },
  );
  await o.schrijf(pad, bytes);
  return pad;
}

/** De bytes van de gekozen pagina's (voor een voorbeeld of een test). */
export async function bytesVanSelectie(plan, ids, bronBytes) {
  const gekozen = new Set(Array.isArray(ids) ? ids : [ids]);
  const items = plan.items.filter((item) => gekozen.has(item.id));
  if (!items.length) return null;
  const { bytes } = await bouwNieuweBytes(
    { items, splits: new Set(), bestanden: plan.bestanden },
    bronBytes,
    { rotatieInBytes: true },
  );
  return bytes;
}

/** Hoeveel pagina's zitten er in deze bytes? Voor een ingevoegd bestand. */
export async function telPaginas(bytes, { PDFDocumentImpl = PDFDocument } = {}) {
  const lib = await PDFDocumentImpl.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false });
  return lib.getPageCount();
}

/** Leest een ingevoegde PDF van schijf: het aantal pagina's en de bytes. */
export async function leesInvoegBestand(pad, { leesBestand = null, PDFDocumentImpl = PDFDocument } = {}) {
  const lees = leesBestand || (await import('../core/platform.js')).readBinaryFile;
  const data = await lees(pad);
  const bytes = new Uint8Array(data);
  return { bytes, aantalPaginas: await telPaginas(bytes, { PDFDocumentImpl }) };
}
