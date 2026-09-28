// Annotaties die de loader van een pagina heeft omgezet, in één keer in het
// document zetten.
//
// doc.annotations is een reactieve store (createMutable). Elke losse push liet
// alles wat de annotatielijst leest meteen opnieuw rekenen: de
// hoeveelhedenstaat, de statusbalk, de lagenlijst, de metingen. Bij het openen
// van een PDF met 500 rechthoeken gebeurde dat 500 keer, telkens over een
// langere lijst: 57 s waarin het venster niet reageerde. Gebundeld rekent
// alles één keer, na de laatste.

import { batch } from 'solid-js';

/**
 * @param {{annotations: object[]}} doc
 * @param {object[]} nieuw  omgezette annotaties, in paginavolgorde
 * @param {(fn: () => void) => void} [bundel]  Solid's batch; de tests geven een eigen
 */
export function voegAnnotatiesToe(doc, nieuw, bundel = batch) {
  if (!nieuw?.length) return;
  bundel(() => {
    // Eén voor één binnen de bundel: een spread over tienduizenden elementen
    // loopt tegen de grens van het aantal argumenten aan.
    for (const annotatie of nieuw) doc.annotations.push(annotatie);
  });
}
