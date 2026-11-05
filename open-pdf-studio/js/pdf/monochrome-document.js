// Verliesloze monochroomoptimalisatie van een heel document (#902).
//
// Alleen bestaande beeld-XObjects worden vervangen, elk onder zijn eigen
// objectreferentie (gedeelde beelden blijven op elke pagina goed). Inhouds-
// streams, fonts, tekst, de OCR-laag, annotaties, formulieren en de
// paginageometrie gaan ongewijzigd mee: pdf-lib schrijft hun streambytes
// zoals ze gelezen zijn. Per beeld beslist optimizeMonochromeImage()
// (monochrome-image.js) of het verliesloos kleiner kan; zo niet, dan blijft
// het oorspronkelijke object staan met een reden.
//
// Het resultaat telt pas als het complete nieuwe bestand kleiner is dan het
// bronbestand; anders komen er geen bytes terug en schrijft de aanroeper niets.
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream } from 'pdf-lib';
import { optimizeMonochromeImage, MONOCHROME_LIMITS } from './monochrome-image.js';

/** Grenzen over het hele document; per beeld gelden MONOCHROME_LIMITS. */
export const DOCUMENT_LIMITS = Object.freeze({ images: 20000, totalDecodedBytes: 1024 * 1024 * 1024 });

const checkAbort = (signal) => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
const N = (key) => PDFName.of(key);

function resolve(context, value) {
  for (let i = 0; value instanceof PDFRef && i < 16; i++) value = context.lookup(value);
  return value instanceof PDFRef ? undefined : value;
}
const nameOf = (value) => (value instanceof PDFName ? value.decodeText() : null);
const numberOf = (value) => (value instanceof PDFNumber ? value.asNumber() : null);

function dictOf(object) {
  if (object instanceof PDFDict) return object;
  if (object instanceof PDFStream) return object.dict;
  return null;
}

// Loopt de directe (niet-indirecte) subwoordenboeken en -arrays van één object
// af; indirecte objecten komen elk zelf aan de beurt in de opsomming.
function walkDirect(value, visit, depth = 0) {
  if (depth > 8) return;
  if (value instanceof PDFDict) {
    visit(value);
    for (const [, child] of value.entries()) if (!(child instanceof PDFRef)) walkDirect(child, visit, depth + 1);
  } else if (value instanceof PDFArray) {
    for (const child of value.asArray()) if (!(child instanceof PDFRef)) walkDirect(child, visit, depth + 1);
  }
}

/**
 * Een ondertekend document kan niet herschreven worden zonder de handtekening
 * te breken: een signatuurwoordenboek of een ingevuld handtekeningveld.
 */
export function isSignedDocument(context) {
  for (const [, object] of context.enumerateIndirectObjects()) {
    let signed = false;
    walkDirect(dictOf(object), (dict) => {
      const type = dict.get(N('Type'));
      if ((type === N('Sig') || type === N('DocTimeStamp')) && dict.get(N('ByteRange'))) signed = true;
      if (dict.get(N('FT')) === N('Sig') && dict.get(N('V'))) signed = true;
    });
    if (signed) return true;
  }
  return false;
}

/**
 * Waarom DeviceRGB-zwart/wit hier niet gelijk te stellen is aan DeviceGray,
 * of null als dat wel veilig is. Een uitvoerprofiel, een DefaultRGB/DefaultGray
 * in een resourcewoordenboek of een transparantiegroep met een andere
 * mengruimte kan RGB en grijs verschillend omzetten.
 */
export function rgbPackingBlocker(doc) {
  const context = doc.context;
  if (doc.catalog.get(N('OutputIntents'))) return 'output-intent';
  let blocker = null;
  for (const [, object] of context.enumerateIndirectObjects()) {
    walkDirect(dictOf(object), (dict) => {
      if (dict.get(N('DefaultRGB')) || dict.get(N('DefaultGray'))) blocker ??= 'default-color-space';
      const group = resolve(context, dict.get(N('Group')));
      if (group instanceof PDFDict && group.get(N('CS'))) {
        const cs = nameOf(resolve(context, group.get(N('CS'))));
        if (cs !== 'DeviceRGB' && cs !== 'DeviceGray') blocker ??= 'transparency-group';
      }
    });
    if (blocker) return blocker;
  }
  return null;
}

function imageInfo(context, stream) {
  const get = (key) => resolve(context, stream.dict.get(N(key)));
  const width = numberOf(get('Width')), height = numberOf(get('Height'));
  const stencil = get('ImageMask')?.toString() === 'true';
  const bits = numberOf(get('BitsPerComponent')) ?? (stencil ? 1 : null);
  const color = get('ColorSpace');
  const channels = nameOf(color) === 'DeviceRGB' ? 3 : nameOf(color) === 'DeviceCMYK' ? 4 : 1;
  const decoded = Number.isSafeInteger(width) && Number.isSafeInteger(height) && Number.isSafeInteger(bits)
    ? Math.ceil(width * channels * bits / 8) * height : Infinity;
  return { width, height, bits, colorSpace: nameOf(color), decoded };
}

/**
 * Optimaliseert een PDF verliesloos: één-bit beelden worden opnieuw
 * gecomprimeerd, zuiver zwart/witte acht-bit grijs- of RGB-beelden naar één bit
 * gepakt. Alles buiten die beeldstreams blijft ongemoeid.
 *
 * @param {Uint8Array|ArrayBuffer} input  De bronbytes; worden niet gewijzigd.
 * @param {{signal?: AbortSignal, onProgress?: (p: {done: number, total: number}) => void,
 *          limits?: object, documentLimits?: object, checkpoint?: () => Promise<void>}} [options]
 * @returns {Promise<{bytes: Uint8Array|null, reason: string|null, origSize: number,
 *          newSize: number, replaced: number, images: Array<{ref: string, width: number|null,
 *          height: number|null, before: number, after: number|null, reason: string|null}>}>}
 *          `bytes` is null (met een reden) als er niets kleiners te schrijven valt.
 */
export async function optimizeMonochromeDocument(input, {
  signal, onProgress, limits = MONOCHROME_LIMITS, documentLimits = DOCUMENT_LIMITS, checkpoint,
} = {}) {
  checkAbort(signal);
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const origSize = source.length;
  const refused = (reason, images = [], replaced = 0) => ({ bytes: null, reason, origSize, newSize: origSize, replaced, images });

  let doc;
  try {
    // Kopie: pdf-lib mag de bronbytes nooit delen met wat de aanroeper bewaart.
    doc = await PDFDocument.load(source.slice(), { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  } catch {
    return refused('unreadable');
  }
  checkAbort(signal);
  if (doc.isEncrypted) return refused('encrypted');
  const context = doc.context;
  if (isSignedDocument(context)) return refused('signed');
  const rgbBlocker = rgbPackingBlocker(doc);

  const candidates = [];
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && nameOf(resolve(context, object.dict.get(N('Subtype')))) === 'Image') {
      candidates.push([ref, object]);
    }
  }
  candidates.sort((a, b) => a[0].objectNumber - b[0].objectNumber);
  if (!candidates.length) return refused('no-images');

  const images = [];
  let replaced = 0;
  let budget = documentLimits.totalDecodedBytes;
  for (let i = 0; i < candidates.length; i++) {
    checkAbort(signal);
    onProgress?.({ done: i, total: candidates.length });
    const [ref, stream] = candidates[i];
    const info = imageInfo(context, stream);
    const entry = { ref: `${ref.objectNumber} ${ref.generationNumber} R`, width: info.width, height: info.height, before: stream.sizeInBytes(), after: null, reason: null };
    images.push(entry);
    if (i >= documentLimits.images || info.decoded > budget) { entry.reason = 'document-budget'; continue; }
    const result = await optimizeMonochromeImage(stream, { signal, limits, allowRgb: !rgbBlocker, ...(checkpoint ? { checkpoint } : {}) });
    if (!result.replacement) {
      entry.reason = result.reason === 'color-profile-or-space' && rgbBlocker && info.colorSpace === 'DeviceRGB' && info.bits === 8
        ? rgbBlocker : result.reason;
      continue;
    }
    budget -= result.decodedBytes;
    entry.before = result.before;
    entry.after = result.after;
    context.assign(ref, result.replacement);
    replaced++;
  }
  onProgress?.({ done: candidates.length, total: candidates.length });
  if (!replaced) return refused('no-eligible-images', images);

  checkAbort(signal);
  // Objectstreams alleen als de bron al PDF 1.5 of nieuwer is: pdf-lib past de
  // versie in de kop niet aan.
  const header = String(context.header?.toString?.() ?? '');
  const version = Number((header.match(/%PDF-(\d+\.\d+)/) || [])[1]);
  const out = await doc.save({
    useObjectStreams: Number.isFinite(version) && version >= 1.5,
    updateFieldAppearances: false,
    addDefaultPage: false,
  });
  checkAbort(signal);
  if (out.length >= origSize) return { ...refused('not-smaller', images, replaced), newSize: out.length };
  return { bytes: out, reason: null, origSize, newSize: out.length, replaced, images };
}
