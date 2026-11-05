// Welke toets verwijdert de geselecteerde markering (#951)?
//
// Delete, zoals altijd. Daarnaast Backspace zonder Ctrl/Alt/Shift/Cmd: op een
// Mac-toetsenbord heet die toets "delete" en is er geen aparte Delete-toets,
// en ook op laptops grijpen gebruikers naar Backspace. Zonder deze regel was
// een tekstvak (gevuld of leeg) daar met het toetsenbord niet te verwijderen.
//
// Gereedschappen die Backspace zelf gebruiken (laatste punt weg bij een
// veelhoek of vlak) handelen hem eerder af en roepen preventDefault aan; in
// een invoerveld of de teksteditor komt de toets hier niet langs.
export function isVerwijderToets(e) {
  if (!e) return false;
  if (e.key === 'Delete') return true;
  return e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
}
