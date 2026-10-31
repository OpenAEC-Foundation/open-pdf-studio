// Watermerken en kop-/voetteksten toevoegen en verwijderen zonder dialoog.
//
// De dialogen (WatermarkDialog, HeaderFooterDialog, ManageWatermarksDialog)
// en de MCP-opdracht app_watermarks gebruiken dezelfde functies: dezelfde
// ongedaan-maakstap, het document gewijzigd gemarkeerd, en het scherm opnieuw
// getekend.
//
// `o` is de app (undo, tabbladen, tekenen, kop-/voetweergave); de tests geven
// een nagebootste.

export function nieuwWatermerkId() {
  return 'wm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function appOmgeving() {
  const [st, undo, tabs, tekenen, kopvoet] = await Promise.all([
    import('../core/state.js'),
    import('../core/undo-manager.js'),
    import('../ui/chrome/tabs.js'),
    import('../annotations/rendering.js'),
    import('./kopvoet-weergave.js'),
  ]);
  return {
    document: st.getActiveDocument,
    legToevoegenVast: undo.recordAddWatermark,
    legVerwijderenVast: undo.recordRemoveWatermark,
    markeerGewijzigd: tabs.markDocumentModified,
    tekenOpnieuw: () => {
      if (st.getActiveDocument()?.viewMode === 'continuous') tekenen.redrawContinuous();
      else tekenen.redrawAnnotations();
    },
    kopVoetInWeergave: kopvoet.kopVoetInWeergave,
    haalKopVoetUitWeergave: kopvoet.haalKopVoetUitWeergave,
  };
}

/** Voegt `wm` toe aan het document. Geeft het watermerk zoals het in het document staat. */
export async function voegWatermerkToe(doc, wm, o) {
  o = o || await appOmgeving();
  if (!doc.watermarks) doc.watermarks = [];
  doc.watermarks.push(wm);
  o.legToevoegenVast(wm);
  o.markeerGewijzigd(doc);
  o.tekenOpnieuw();
  return doc.watermarks.find((w) => w.id === wm.id) || wm;
}

/**
 * Verwijdert het watermerk met dit id. Een kop-/voettekst die als
 * pagina-inhoud in de weergave staat, gaat daar eerst uit (kopvoet-weergave.js).
 * Geeft het verwijderde watermerk, of null (bestaat niet, of het document
 * wisselde intussen).
 */
export async function verwijderWatermerk(doc, id, o) {
  o = o || await appOmgeving();
  const wm = (doc?.watermarks || []).find((w) => w.id === id);
  if (!wm) return null;
  if (wm.type === 'headerFooter' && o.kopVoetInWeergave(doc, wm)) {
    await o.haalKopVoetUitWeergave(doc);
    if (o.document() !== doc) return null;
  }
  const idx = doc.watermarks.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  const weg = { ...doc.watermarks[idx] };
  doc.watermarks.splice(idx, 1);
  o.legVerwijderenVast(weg, idx);
  o.markeerGewijzigd(doc);
  o.tekenOpnieuw();
  return weg;
}
