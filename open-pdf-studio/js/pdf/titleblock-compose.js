// Onderhoek op een kader zetten — puur (alleen pdf-lib), dus node-testbaar.
//
// Een onderhoek-PDF hoeft niet op oorsprong (0,0) te staan: de meegeleverde
// OpenAEC-onderhoek is uit het A1-vel geknipt door de MediaBox/CropBox te
// zetten, dus zijn inhoud staat op x≈1817 pt. `embedPdf` normaliseert dan
// wel de BBox naar de oorsprong maar verschuift de inhoud niet — die valt
// buiten de BBox en wordt weggeclipt (alleen wat randlijnen bleven over).
// Daarom bedden we de pagina in met een expliciet kader (de CropBox, anders
// de MediaBox) én een verschuivingsmatrix die de inhoud naar de oorsprong
// haalt. Werkt daarmee ook voor onderhoeken die gebruikers zelf aanleveren.

const MM = 72 / 25.4;

/** Kadermarge waar de onderhoek tegenaan wordt gezet (10 mm, NEN-conventie). */
export const KADER_MARGE_PT = 10 * MM;

/** Het zichtbare vak van een pdf-lib-pagina: CropBox, anders MediaBox. */
export function zichtbaarVak(page) {
  const box = page.getCropBox?.() || page.getMediaBox();
  return {
    left: box.x, bottom: box.y,
    right: box.x + box.width, top: box.y + box.height,
  };
}

/**
 * Zet de onderhoek rechtsonder binnen de kadermarge. Een onderhoek die
 * groter is dan het vel (bv. een A1-blok op een A3-kader) wordt met behoud
 * van verhouding ingeschaald.
 * @returns {Promise<Uint8Array>} de samengestelde PDF
 */
export async function composeFrameWithTitleBlock(kaderBytes, onderhoekBytes) {
  const { PDFDocument } = await import('pdf-lib');
  const kader = await PDFDocument.load(kaderBytes);
  const bron = await PDFDocument.load(onderhoekBytes);
  const bronPagina = bron.getPage(0);
  const vak = zichtbaarVak(bronPagina);
  const ingebed = await kader.embedPage(bronPagina, vak, [1, 0, 0, 1, -vak.left, -vak.bottom]);

  const pagina = kader.getPage(0);
  const { width: vw, height: vh } = pagina.getSize();
  const bruikbaar = { w: vw - 2 * KADER_MARGE_PT, h: vh - 2 * KADER_MARGE_PT };
  let b = ingebed.width;
  let h = ingebed.height;
  const factor = Math.min(1, bruikbaar.w / b, bruikbaar.h / h);
  b *= factor;
  h *= factor;

  pagina.drawPage(ingebed, {
    x: vw - KADER_MARGE_PT - b,
    y: KADER_MARGE_PT,
    width: b,
    height: h,
  });
  return await kader.save();
}
