// Formuliervelden op het scherm (#1101). Op het bureaublad tekent PDFium de
// pagina; de HTML-formulierlaag van PDF.js (form-layer.js) ligt erboven. De
// bewerkbare velden staan alleen in die laag, anders blijft de opgeslagen
// waarde onder de nieuw getypte zichtbaar. Handtekeningvelden en drukknoppen
// tekent die laag niet: die laat de schermrender in de paginabitmap staan
// (pdfium-worker/src/screen_widgets.rs, dezelfde indeling).
//
// Een beeld zonder formulierlaag erboven (de miniaturen) vraagt de pagina
// daarom met alle velden (`forms: true` bij renderPdfPage), en mag de
// schermbitmap alleen hergebruiken op een pagina zonder bewerkbare velden.

/** Tekent de HTML-formulierlaag dit veld (tekst, keuzelijst, vinkje, keuzerondje)? */
export function isBewerkbaarVeld(annotatie) {
  if (annotatie?.subtype !== 'Widget') return false;
  switch (annotatie.fieldType) {
    case 'Tx':
    case 'Ch':
      return true;
    case 'Btn':
      return !annotatie.pushButton;
    default:
      return false;
  }
}

async function veldenOp(pdfDoc, paginaNummer) {
  if (!pdfDoc) return [];
  const page = await pdfDoc.getPage(paginaNummer);
  return (await page.getAnnotations({ intent: 'display' })).filter((a) => a?.subtype === 'Widget');
}

/** Heeft pagina `paginaNummer` (1-gebaseerd) een bewerkbaar veld dat in beeld komt? */
export async function heeftBewerkbareVelden(pdfDoc, paginaNummer) {
  return (await veldenOp(pdfDoc, paginaNummer)).some(isBewerkbaarVeld);
}

/** Heeft pagina `paginaNummer` (1-gebaseerd) een formulierveld van welke soort ook? */
export async function heeftVeldWidgets(pdfDoc, paginaNummer) {
  return (await veldenOp(pdfDoc, paginaNummer)).length > 0;
}
