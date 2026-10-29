import { execute } from '../core/undo-manager.js';

// Haal een textEdit-record uit het document, als ongedaan te maken stap.
// execute() legt alleen de stap vast; zoals bij elk ander commando moet de
// aanroeper de wijziging zelf toepassen. Zonder de splice bleef verwijderde
// ingevoegde tekst in doc.textEdits staan en kwam hij bij opslaan terug
// (GitHub #722). Ongedaan maken zet het record terug op dezelfde index,
// opnieuw uitvoeren haalt het weer weg (undo-manager, 'removeTextEdit').
export function verwijderTextEditRecord(doc, rec) {
  if (!doc || !doc.textEdits || !rec) return false;
  const index = doc.textEdits.findIndex(e => e.id === rec.id);
  if (index === -1) return false;
  const [weg] = doc.textEdits.splice(index, 1);
  execute({ type: 'removeTextEdit', textEdit: { ...weg }, index });
  return true;
}
