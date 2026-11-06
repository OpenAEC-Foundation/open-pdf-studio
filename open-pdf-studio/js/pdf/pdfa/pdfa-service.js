// PDF/A in de app (#379): valideren van het actieve document, "Opslaan als
// PDF/A" en het opnieuw converteren bij opslaan van een PDF/A-document dat
// de gebruiker bewerkt. De regels zelf staan in validatie.js en conversie.js
// (zonder app-afhankelijkheden); hier zit alleen de koppeling met fonts,
// rasteren via PDF.js, het document en de schijf.

import { assetUrl, pdfjsBronnen } from '../../core/basis-url.js';
import { LIBERATION_BESTAND } from './fonts.js';
import { pdfaLabel } from './meldingen.js';

/** Liberation Sans uit de PDF.js-standaardfonts van de bundel. */
export async function laadLiberation(variant) {
  const bestand = LIBERATION_BESTAND[variant] || LIBERATION_BESTAND.Regular;
  const r = await fetch(assetUrl(`pdfjs/web/standard_fonts/${bestand}`));
  if (!r.ok) throw new Error(`font ${bestand}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const RASTER_DPI = 200;
const MAX_PIXELS = 20e6;

/**
 * Een rasterfunctie voor de conversie: tekent pagina's van `bytes` (met hun
 * annotaties) via PDF.js op wit en geeft de RGB-pixels. De CropBox wordt
 * zonder /Rotate getekend; de pagina houdt haar eigen /Rotate.
 */
export function maakRasteriseerder(bytes) {
  let laden = null;
  const doc = () => {
    laden ??= (async () => {
      await import('../loader.js'); // zet de PDF.js-worker op
      const pdfjsLib = await import('pdfjs-dist');
      return pdfjsLib.getDocument({ data: bytes.slice(), ...pdfjsBronnen(), isEvalSupported: false, verbosity: 0 }).promise
        .then((pdf) => ({ pdf, pdfjsLib }));
    })();
    return laden;
  };
  const functie = async (index) => {
    const { pdf, pdfjsLib } = await doc();
    const page = await pdf.getPage(index + 1);
    const basis = page.getViewport({ scale: 1, rotation: 0 });
    let schaal = RASTER_DPI / 72;
    const pixels = basis.width * basis.height * schaal * schaal;
    if (pixels > MAX_PIXELS) schaal *= Math.sqrt(MAX_PIXELS / pixels);
    const viewport = page.getViewport({ scale: schaal, rotation: 0 });
    const breedte = Math.max(1, Math.round(viewport.width));
    const hoogte = Math.max(1, Math.round(viewport.height));
    const canvas = document.createElement('canvas');
    canvas.width = breedte;
    canvas.height = hoogte;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, breedte, hoogte);
    await page.render({ canvasContext: ctx, viewport, annotationMode: pdfjsLib.AnnotationMode.ENABLE, background: '#ffffff' }).promise;
    const rgba = ctx.getImageData(0, 0, breedte, hoogte).data;
    const rgb = new Uint8Array(breedte * hoogte * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      // Op wit samenvoegen (het canvas is al wit, dit vangt resterende alfa).
      const a = rgba[i + 3] / 255;
      rgb[j] = Math.round(rgba[i] * a + 255 * (1 - a));
      rgb[j + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
      rgb[j + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
    }
    page.cleanup();
    return { breedte, hoogte, rgb };
  };
  functie.sluit = async () => {
    if (!laden) return;
    try { (await laden).pdf.destroy(); } catch { /* al gesloten */ }
  };
  return functie;
}

/** Converteert bytes met de app-fonts en de PDF.js-rasterfunctie. */
export async function converteerBytes(bytes, deel, opties = {}) {
  const { converteerNaarPdfA } = await import('./conversie.js');
  const rasteriseer = maakRasteriseerder(bytes);
  try {
    return await converteerNaarPdfA(bytes, { deel, laadFont: laadLiberation, rasteriseer, signal: opties.signal });
  } finally {
    await rasteriseer.sluit();
  }
}

/** De bytes van het document zoals ze op schijf staan (zonder onopgeslagen wijzigingen). */
async function opgeslagenBytes(doc) {
  const { getCachedPdfBytes } = await import('../loader.js');
  const cache = getCachedPdfBytes(doc.filePath) || getCachedPdfBytes(`__memory__${doc.id}`);
  if (cache) return new Uint8Array(cache).slice();
  return new Uint8Array(await doc.pdfDoc.getData());
}

/** De bytes zoals opslaan ze zou schrijven, met de annotaties uit de app. */
async function bytesMetWijzigingen(doc) {
  if (!doc.modified) return opgeslagenBytes(doc);
  const { bouwAnnotatieDocument } = await import('../saver.js');
  const { pdfDocLib } = await bouwAnnotatieDocument(doc);
  return new Uint8Array(await pdfDocLib.save({ useObjectStreams: false, updateFieldAppearances: false }));
}

/** Valideert het actieve document (de opgeslagen versie). */
export async function valideerDocument(doc, deel, opties = {}) {
  if (!doc?.pdfDoc) throw new Error('NO_DOCUMENT');
  const { valideerPdfA } = await import('./validatie.js');
  const bytes = await opgeslagenBytes(doc);
  return valideerPdfA(bytes, { deel, signal: opties.signal });
}

/**
 * Bewaart het document als PDF/A in een nieuw bestand. Lukt de conversie
 * niet volledig, dan wordt er niets geschreven.
 * @returns {Promise<null | { pad: string|null, resultaat: object }>} null = geannuleerd
 */
export async function slaOpAlsPdfA(doc, deel, opties = {}) {
  const { isTauri, saveFileDialog, writeBinaryFile } = await import('../../core/platform.js');
  const i18next = (await import('../../i18n/config.js')).default;
  const bytes = await bytesMetWijzigingen(doc);
  const resultaat = await converteerBytes(bytes, deel, opties);
  if (!resultaat.ok) return { pad: null, resultaat };
  const basis = String(doc.fileName || 'document').replace(/\.pdf$/i, '');
  const achtervoegsel = i18next.t('pdfa.fileSuffix', { ns: 'dialogs', defaultValue: '_PDFA' });
  const voorstel = `${basis}${achtervoegsel}-${deel}b.pdf`;
  let pad = voorstel;
  if (isTauri()) {
    const map = doc.filePath && !doc.isUntitled ? doc.filePath.replace(/[^\\/]*$/, '') : '';
    pad = await saveFileDialog(map + voorstel, [{ name: 'PDF/A', extensions: ['pdf'] }]);
    if (!pad) return null;
  }
  await writeBinaryFile(pad, resultaat.bytes);
  return { pad: isTauri() ? pad : null, resultaat };
}

/** Bij opslaan: een bewerkt PDF/A-document weer naar PDF/A (herconversie.js). */
export async function herconverteerBijOpslaan(bytes, doc) {
  const { herconverteerVoorOpslaan } = await import('./herconversie.js');
  return herconverteerVoorOpslaan(bytes, doc, (b, deel) => converteerBytes(b, deel));
}

export { pdfaLabel };
