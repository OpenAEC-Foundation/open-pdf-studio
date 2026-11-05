// Foto's van de camera of de galerij op mobiel (#953): als afbeelding op de
// pagina, of als gescande pagina (een nieuwe PDF-pagina per foto).
//
// Een camerafoto is groot (12 MP en meer) en staat vaak gedraaid opgeslagen
// met alleen een EXIF-draaiing erbij. pdf-lib sluit de JPEG-bytes onbewerkt
// in en kent die draaiing niet: de foto stond dan op zijn kant in de PDF.
// Daarom gaat elke foto eerst door een canvas: rechtop gezet (de browser
// past de EXIF-draaiing toe bij het decoderen), verkleind en als JPEG
// opnieuw gecodeerd. Het rekenwerk is puur en getest in foto.test.mjs.

/** Langste zijde van een gescande pagina in pixels: A4 bij 300 dpi. */
export const SCAN_MAX_PX = 3508;
/** Langste zijde van een foto als afbeelding op de pagina. */
export const AFBEELDING_MAX_PX = 2048;
/** Langste zijde van de pagina van een scan in punten (A4: 842 pt). */
export const SCAN_LANGE_ZIJDE_PT = 842;

/** Maat binnen `max` pixels voor de langste zijde, met dezelfde verhouding. */
export function schaalBinnen(breedte, hoogte, max) {
  const b = Math.max(1, Math.round(breedte || 0));
  const h = Math.max(1, Math.round(hoogte || 0));
  const lang = Math.max(b, h);
  if (!(max > 0) || lang <= max) return { breedte: b, hoogte: h };
  const f = max / lang;
  return { breedte: Math.max(1, Math.round(b * f)), hoogte: Math.max(1, Math.round(h * f)) };
}

/**
 * Resolutie voor een gescande foto, zodat de langste zijde van de pagina
 * `langeZijdePt` punten wordt (een A4-pagina, wat de camera ook levert).
 */
export function scanDpi(breedte, hoogte, langeZijdePt = SCAN_LANGE_ZIJDE_PT) {
  const lang = Math.max(breedte || 0, hoogte || 0);
  if (!(lang > 0) || !(langeZijdePt > 0)) return 300;
  return (lang * 72) / langeZijdePt;
}

/**
 * Gaat dit beeldbestand door het canvas (fotoNaarJpeg)? Een foto (JPEG, of
 * HEIC/HEIF dat pdf-lib niet kan insluiten, of zonder type) wel; een PNG,
 * GIF, WebP of SVG uit de galerij niet, zodat transparantie behouden blijft
 * (afbeelding-bron.js zet die zelf om).
 */
export function moetHercoderen(mime) {
  const m = String(mime || '').toLowerCase();
  return m === '' || m === 'image/jpeg' || m === 'image/jpg' || m === 'image/heic' || m === 'image/heif';
}

/** Bestandsnaam van een opnieuw gecodeerde foto: dezelfde naam, maar .jpg. */
export function jpegNaam(naam) {
  const kaal = String(naam || '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '');
  return `${kaal || 'photo'}.jpg`;
}

/**
 * Een gekozen beeldbestand rechtop, verkleind en als JPEG.
 * @param {Blob} bestand
 * @param {{ max?: number, kwaliteit?: number }} [o]
 * @returns {Promise<{ bytes: Uint8Array, breedte: number, hoogte: number }>}
 */
export async function fotoNaarJpeg(bestand, { max = AFBEELDING_MAX_PX, kwaliteit = 0.88 } = {}) {
  const beeld = await createImageBitmap(bestand, { imageOrientation: 'from-image' });
  try {
    const { breedte, hoogte } = schaalBinnen(beeld.width, beeld.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = breedte;
    canvas.height = hoogte;
    const ctx = canvas.getContext('2d');
    // JPEG kent geen transparantie: een wit vlak eronder.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, breedte, hoogte);
    ctx.drawImage(beeld, 0, 0, breedte, hoogte);
    const blob = await new Promise((klaar, mis) => canvas.toBlob(
      (b) => (b ? klaar(b) : mis(new Error('the photo could not be encoded'))), 'image/jpeg', kwaliteit));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), breedte, hoogte };
  } finally {
    beeld.close?.();
  }
}
