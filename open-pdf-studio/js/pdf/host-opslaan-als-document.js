// Het document na Opslaan als op de site (#726).
//
// savePDF() schrijft naar het nieuwe bestand en markeert het document als
// opgeslagen. Daarna kiest de gebruiker:
//  - "Het nieuwe bestand openen": het tabblad wordt dat bestand op de site
//    (pad opds-host://<id>/<naam>, naam in het tabblad, id en versie in
//    doc.hostBestand). Opslaan schrijft daarna terug naar het nieuwe bestand.
//    Een alleen-lezen bron (een oudere versie, #712) is dan een gewoon
//    bewerkbaar document.
//  - "Verder met het origineel": het document blijft zoals het was, ook
//    gewijzigd als het dat was (het origineel is niet opgeslagen), en Opslaan
//    gaat nog steeds naar het origineel.
//
// Alleen de velden van het document; de weergave, de caches en de titel
// regelt pdf/saver.js. Vrij van imports, zodat het zonder app te testen is.

/** Wat er vóór het opslaan was, om naar terug te gaan. */
export function legDocumentVast(doc) {
  return {
    filePath: doc?.filePath ?? null,
    saveTargetPath: doc?.saveTargetPath ?? null,
    modified: !!doc?.modified,
  };
}

/**
 * Verder met het origineel: het opslagdoel terug naar het origineel. Heeft
 * het opslaan de weergave op een werkkopie gezet (ingebakken tekstbewerkingen),
 * dan blijft die staan en schrijft Opslaan via saveTargetPath naar het origineel.
 * @returns {{ weerGewijzigd: boolean }} of het document weer als gewijzigd moet gelden
 */
export function blijfBijOrigineel(doc, voor) {
  if (!doc || !voor) return { weerGewijzigd: false };
  if (doc.filePath !== voor.filePath) doc.saveTargetPath = voor.saveTargetPath ?? voor.filePath;
  else doc.saveTargetPath = voor.saveTargetPath;
  return { weerGewijzigd: voor.modified };
}

/**
 * Het tabblad wordt het nieuwe bestand op de site.
 * @param {{ id: string, name: string, version?: unknown, pad: string }} uitkomst
 * @returns {{ weergavePad: string|null, nieuwPad: string }} het pad waar de weergave
 *   uit tekende, en het nieuwe pad
 */
export function wisselNaarNieuwBestand(doc, uitkomst) {
  const weergavePad = doc.filePath ?? null;
  doc.filePath = uitkomst.pad;
  doc.fileName = uitkomst.name;
  doc.isUntitled = false;
  doc.saveTargetPath = null;
  doc._renderTemp = false;
  // Het nieuwe bestand is van de gebruiker: bewerkbaar, de huidige versie.
  doc.hostAlleenLezen = false;
  doc.hostVersie = null;
  doc.hostBestand = { id: uitkomst.id, versie: uitkomst.version ?? null };
  return { weergavePad, nieuwPad: uitkomst.pad };
}
