// Vectorknipsel — de pure inbedbewerking (alleen pdf-lib, dus node-testbaar).
//
// Een gebied uit de ene PDF in de andere plakken met behoud van vectordata komt
// neer op één ding: de bronpagina als Form XObject inbedden met een expliciet
// kader (het geknipte vak) en een matrix die dat vak naar de oorsprong haalt.
//
// Diezelfde valkuil staat in titleblock-compose.js beschreven en geldt hier net
// zo: `embedPage` normaliseert de BBox wel naar de oorsprong maar verschuift de
// inhoud niet. Zonder die matrix valt de inhoud buiten de BBox en houd je een
// leeg knipsel over — met hooguit wat randlijnen.
//
// Tweede valkuil, eigen aan dit gereedschap: pdf-lib kijkt niet naar de
// /Rotate van de bronpagina. Knip je uit een blad dat gedraaid wordt getoond,
// dan staat het knipsel zonder correctie op zijn kant. De rotatie hoort dus in
// de matrix, niet in het vak.
//
// Derde valkuil: het vak dat de gebruiker trekt leeft in WEERGAVE-ruimte
// (linksboven, y omlaag, ná de /Rotate), het PDF-vak in de ongedraaide
// gebruikersruimte. appVakNaarPdfVak en weergaveVak rekenen heen en terug;
// zonder die rotatie knipt een gedraaid blad een heel ander stuk papier.

/** Onder deze maat (in punten) is een selectie geen knipsel maar een misklik. */
export const MIN_VAK_PT = 1;

/**
 * Legt een vak op vaste vorm: linksonder/rechtsboven, ongeacht in welke
 * richting de gebruiker sleepte. Geeft null bij een ontaard vak.
 * @param {{left:number,bottom:number,right:number,top:number}|null} vak
 * @returns {{left:number,bottom:number,right:number,top:number}|null}
 */
export function normaliseerVak(vak) {
  if (!vak) return null;
  if (![vak.left, vak.bottom, vak.right, vak.top].every(Number.isFinite)) return null;
  const left = Math.min(vak.left, vak.right);
  const right = Math.max(vak.left, vak.right);
  const bottom = Math.min(vak.bottom, vak.top);
  const top = Math.max(vak.bottom, vak.top);
  if (right - left < MIN_VAK_PT || top - bottom < MIN_VAK_PT) return null;
  return { left, bottom, right, top };
}

/**
 * De matrix die het vak uit de bronpagina naar de oorsprong haalt, inclusief de
 * paginarotatie, plus de afmetingen zoals je ze op het scherm ziet.
 *
 * De afgeleiding per kwartslag: neem een punt (x, y), pas de rotatie toe, en
 * kies de verschuiving zo dat het vak precies op [0,breedte] x [0,hoogte] valt.
 * @returns {{matrix:number[], breedte:number, hoogte:number, rotatie:number}}
 */
export function knipselMatrix(vak, rotatie = 0) {
  const { left, bottom, right, top } = vak;
  const b = right - left;
  const h = top - bottom;
  switch (((Math.round(rotatie / 90) * 90) % 360 + 360) % 360) {
    case 90:  return { matrix: [0, -1, 1, 0, -bottom, right], breedte: h, hoogte: b, rotatie: 90 };
    case 180: return { matrix: [-1, 0, 0, -1, right, top],    breedte: b, hoogte: h, rotatie: 180 };
    case 270: return { matrix: [0, 1, -1, 0, top, -left],     breedte: h, hoogte: b, rotatie: 270 };
    default:  return { matrix: [1, 0, 0, 1, -left, -bottom],  breedte: b, hoogte: h, rotatie: 0 };
  }
}

const _kwartslag = (r) => ((Math.round((Number(r) || 0) / 90) * 90) % 360 + 360) % 360;

/**
 * Van weergaveruimte naar de ongedraaide paginaruimte, beide linksboven met y
 * omlaag, relatief aan de CropBox. Dezelfde afbeelding als de saver gebruikt
 * voor annotaties op gedraaide bladen (_rotVisualMapper in saver.js).
 */
function _naarOngedraaid(rot, cw, ch) {
  switch (rot) {
    case 90:  return (x, y) => ({ u: y,      v: ch - x });
    case 180: return (x, y) => ({ u: cw - x, v: ch - y });
    case 270: return (x, y) => ({ u: cw - y, v: x });
    default:  return (x, y) => ({ u: x,      v: y });
  }
}

/** De omgekeerde afbeelding: ongedraaide paginaruimte naar weergaveruimte. */
function _naarWeergave(rot, cw, ch) {
  switch (rot) {
    case 90:  return (u, v) => ({ x: ch - v, y: u });
    case 180: return (u, v) => ({ x: cw - u, y: ch - v });
    case 270: return (u, v) => ({ x: v,      y: cw - u });
    default:  return (u, v) => ({ x: u,      y: v });
  }
}

/**
 * Rekent een vak op het scherm (app-punten: linksboven, y omlaag, zoals je het
 * blad ziet) om naar de gebruikersruimte van de PDF-pagina (linksonder, y
 * omhoog, ongedraaid), inclusief de CropBox-verschuiving.
 * @param {{x:number,y:number,width:number,height:number}} vak
 * @param {{x:number,y:number,width:number,height:number}} cropBox
 * @param {number} [rotatie]  totale weergaverotatie van het blad
 * @returns {{left:number,bottom:number,right:number,top:number}|null}
 */
export function appVakNaarPdfVak(vak, cropBox, rotatie = 0) {
  const m = _naarOngedraaid(_kwartslag(rotatie), cropBox.width, cropBox.height);
  const a = m(vak.x, vak.y);
  const b = m(vak.x + vak.width, vak.y + vak.height);
  const boven = cropBox.y + cropBox.height;
  return normaliseerVak({
    left: Math.min(a.u, b.u) + cropBox.x,
    right: Math.max(a.u, b.u) + cropBox.x,
    top: boven - Math.min(a.v, b.v),
    bottom: boven - Math.max(a.v, b.v),
  });
}

/**
 * Het omgekeerde van appVakNaarPdfVak: waar een PDF-vak op het scherm staat.
 * Dat is de ruimte waarin de pdfium-worker een regio verwacht.
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function weergaveVak(srcBox, cropBox, rotatie = 0) {
  const m = _naarWeergave(_kwartslag(rotatie), cropBox.width, cropBox.height);
  const boven = cropBox.y + cropBox.height;
  const a = m(srcBox.left - cropBox.x, boven - srcBox.top);
  const b = m(srcBox.right - cropBox.x, boven - srcBox.bottom);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** De /Rotate van een pdf-lib-pagina, genormaliseerd naar 0/90/180/270. */
export function paginaRotatie(page) {
  const r = typeof page.getRotation === 'function' ? (page.getRotation()?.angle ?? 0) : 0;
  return ((Math.round(r / 90) * 90) % 360 + 360) % 360;
}

/**
 * Trekt één pagina uit een PDF los tot een zelfstandige eenpagina-PDF. Dat is
 * wat een knipsel bij zich draagt: de héle bronpagina, niet het bijgesneden
 * vak — want dat is wat bedKnipselIn nodig heeft. copyPages neemt alleen de
 * resources mee waar die pagina naar verwijst.
 *
 * `extraRotatie` is een draaiing die alleen in de app bestaat (nog niet
 * opgeslagen): die gaat mee in de /Rotate van de mini-PDF, zodat het knipsel
 * in dezelfde stand staat als het blad waaruit je knipte.
 * @returns {Promise<Uint8Array>}
 */
export async function knipselAlsMiniPdf(bronBytes, paginaIndex = 0, extraRotatie = 0) {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const bron = await PDFDocument.load(bronBytes);
  const mini = await PDFDocument.create();
  const [pagina] = await mini.copyPages(bron, [paginaIndex]);
  if (_kwartslag(extraRotatie)) {
    pagina.setRotation(degrees(_kwartslag(paginaRotatie(pagina) + _kwartslag(extraRotatie))));
  }
  mini.addPage(pagina);
  return await mini.save();
}

/**
 * Bedt het gekozen vak van een bronpagina in als Form XObject in `doelDoc`.
 *
 * `breedte`/`hoogte` zijn de afmetingen zoals de gebruiker ze ziet — bij een
 * kwartgedraaide bronpagina dus omgewisseld. Gebruik die, niet `ingebed.width`:
 * die laatste komt uit het ongedraaide vak.
 *
 * @param {import('pdf-lib').PDFDocument} doelDoc
 * @param {Uint8Array} bronBytes  bron-PDF (of de mini-PDF van het knipsel)
 * @param {{left:number,bottom:number,right:number,top:number}} srcBox
 * @param {number} [paginaIndex]
 * @returns {Promise<{ingebed:object, breedte:number, hoogte:number, rotatie:number}>}
 */
export async function bedKnipselIn(doelDoc, bronBytes, srcBox, paginaIndex = 0) {
  const vak = normaliseerVak(srcBox);
  if (!vak) throw new Error('vak te klein of ontaard');
  const { PDFDocument } = await import('pdf-lib');
  const bron = await PDFDocument.load(bronBytes);
  const pagina = bron.getPage(paginaIndex);
  const { matrix, breedte, hoogte, rotatie } = knipselMatrix(vak, paginaRotatie(pagina));
  const ingebed = await doelDoc.embedPage(pagina, vak, matrix);
  return { ingebed, breedte, hoogte, rotatie };
}
