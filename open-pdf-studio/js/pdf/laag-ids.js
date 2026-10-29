// Laag-id's (#377), zonder afhankelijkheden: ook bruikbaar in stores en het
// eigenschappenpaneel zonder pdf-lib te laden. Laag-id's van pdf.js zijn
// Ref.toString(): `12R`, met generatie `12R3`.

/** Laag-id van pdf.js naar objectnummer en generatie, of null. */
export function refVanPdfjsId(id) {
  const m = /^(\d+)R(\d*)$/.exec(String(id || ''));
  return m ? { nummer: Number(m[1]), generatie: m[2] ? Number(m[2]) : 0 } : null;
}

// Een annotatie die op een laag van de tekening staat, heeft als `layer` het
// id van een "vreemde" annotatielaag (saver/annotatie-lagen.js, #621):
// `ocg-<object>-<generatie>`. Hiermee gaan die twee vormen over en weer.
const OCG_LAAG = /^ocg-(\d+)-(\d+)$/;

/** Annotatielaag-id bij een laag van de tekening (pdf.js-id). */
export function annotatieLaagIdVoorOcg(pdfjsId) {
  const r = refVanPdfjsId(pdfjsId);
  return r ? `ocg-${r.nummer}-${r.generatie}` : null;
}

/** De laag van de tekening (pdf.js-id) achter een annotatielaag-id, of null. */
export function ocgVoorAnnotatieLaagId(laagId) {
  const m = OCG_LAAG.exec(String(laagId || ''));
  if (!m) return null;
  return Number(m[2]) ? `${m[1]}R${m[2]}` : `${m[1]}R`;
}
