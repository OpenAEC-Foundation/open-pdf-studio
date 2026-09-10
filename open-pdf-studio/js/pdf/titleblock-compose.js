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

// Velden die we van een invulveld overnemen. De appearance stream (/AP) gaat
// bewust NIET mee: die verwijst naar lettertypen in het bronbestand, en zowel
// de app als elke PDF-lezer maakt hem opnieuw uit /Contents en /DA.
const VELD_SLEUTELS = ['Contents', 'T', 'DA', 'Q', 'C', 'F', 'Subj', 'IT', 'RD', 'Border'];

/**
 * Schaalt de puntgrootte in een /DA-string mee. Een /DA ziet er uit als
 * "0 g /Helv 9 Tf"; alleen het getal vóór Tf hoort mee te schalen.
 */
export function schaalDa(da, factor) {
  if (typeof da !== 'string' || !(factor > 0) || factor === 1) return da;
  return da.replace(/(\/[^\s]+\s+)(\d*\.?\d+)(\s+Tf)/g,
    (_, voor, maat, na) => `${voor}${Math.round(parseFloat(maat) * factor * 100) / 100}${na}`);
}

/**
 * De transformatie van bronpagina-punt naar punt op het samengestelde vel.
 * Zelfde plaatsing als drawPage hieronder gebruikt.
 */
export function veldTransform({ vak, factor, doelX, doelY }) {
  return (x, y) => ({
    x: doelX + (x - vak.left) * factor,
    y: doelY + (y - vak.bottom) * factor,
  });
}

/**
 * Neemt de invulvelden (FreeText-annotaties) van de onderhoek mee naar het
 * samengestelde vel, verschoven en geschaald met dezelfde plaatsing als het
 * lijnwerk.
 *
 * Zonder deze stap houd je een bladhoofd over met lege hokjes: de LABELS
 * (PROJECT, SCHAAL) staan in de inhoudstroom en overleven het inbedden, maar de
 * invulbare WAARDEN zitten uitsluitend in annotaties — en embedPage walst de
 * pagina plat tot een XObject en gooit die weg.
 *
 * @returns {number} aantal overgenomen velden
 */
export async function neemVeldenOver(kaderDoc, kaderPagina, bronPagina, plaatsing) {
  const { PDFName, PDFString } = await import('pdf-lib');
  const bronContext = bronPagina.doc.context;
  const annots = bronPagina.node.lookup(PDFName.of('Annots'));
  if (!annots || typeof annots.size !== 'function') return 0;

  const naar = veldTransform(plaatsing);
  const uit = [];

  for (let i = 0; i < annots.size(); i++) {
    const bronAnnot = bronContext.lookup(annots.get(i));
    if (!bronAnnot || typeof bronAnnot.get !== 'function') continue;
    const subtype = bronAnnot.get(PDFName.of('Subtype'));
    if (!subtype || subtype.asString() !== '/FreeText') continue;

    const rectRaw = bronAnnot.get(PDFName.of('Rect'));
    const rect = rectRaw && rectRaw.asArray ? rectRaw.asArray().map((n) => n.asNumber()) : null;
    if (!rect || rect.length !== 4) continue;
    const lb = naar(Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]));
    const rb = naar(Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3]));

    const nieuw = { Type: 'Annot', Subtype: 'FreeText', Rect: [lb.x, lb.y, rb.x, rb.y] };
    for (const sleutel of VELD_SLEUTELS) {
      const waarde = bronAnnot.get(PDFName.of(sleutel));
      if (waarde === undefined || waarde === null) continue;
      if (sleutel === 'DA') {
        const da = waarde.decodeText ? waarde.decodeText() : waarde.value;
        if (typeof da === 'string') nieuw.DA = PDFString.of(schaalDa(da, plaatsing.factor));
        continue;
      }
      const tekst = waarde.decodeText ? waarde.decodeText() : (typeof waarde.value === 'string' ? waarde.value : null);
      if (tekst !== null && tekst !== undefined) {
        nieuw[sleutel] = PDFString.of(tekst);
      } else if (waarde.asArray) {
        nieuw[sleutel] = waarde.asArray().map((n) => (n.asNumber ? n.asNumber() : 0));
      } else if (waarde.asNumber) {
        nieuw[sleutel] = waarde.asNumber();
      }
    }
    uit.push(kaderDoc.context.register(kaderDoc.context.obj(nieuw)));
  }

  if (uit.length === 0) return 0;
  const bestaand = kaderPagina.node.lookup(PDFName.of('Annots'));
  const alles = [];
  if (bestaand && typeof bestaand.size === 'function') {
    for (let i = 0; i < bestaand.size(); i++) alles.push(bestaand.get(i));
  }
  kaderPagina.node.set(PDFName.of('Annots'), kaderDoc.context.obj([...alles, ...uit]));
  return uit.length;
}

/**
 * Zet de onderhoek rechtsonder binnen de kadermarge. Een onderhoek die
 * groter is dan het vel (bv. een A1-blok op een A3-kader) wordt met behoud
 * van verhouding ingeschaald. De invulvelden van het bladhoofd gaan als
 * annotatie mee, zodat je ze na het samenstellen gewoon kunt invullen.
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

  const doelX = vw - KADER_MARGE_PT - b;
  const doelY = KADER_MARGE_PT;
  pagina.drawPage(ingebed, { x: doelX, y: doelY, width: b, height: h });

  await neemVeldenOver(kader, pagina, bronPagina, { vak, factor, doelX, doelY });

  return await kader.save();
}
