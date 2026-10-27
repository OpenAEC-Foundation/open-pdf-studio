// PDF/A behouden bij opslaan (#379), zonder app-afhankelijkheden.
//
// Een PDF/A-document opent alleen-lezen. Wie bewerken inschakelt, kiest of
// het document bij opslaan weer PDF/A wordt ('herconverteer', standaard) of
// een gewone PDF ('verwijder'). Zonder keuze (bv. een bewerking via een
// extensie) geldt herconverteren: nooit stilzwijgend de conformiteit kwijt.

/**
 * Welk deel opnieuw gemaakt kan worden: 1, 2 of 3 (altijd niveau b), of null
 * (deel 4 of onbekend).
 */
export function herconversieDeel(compliance) {
  const deel = Number(compliance?.part);
  return [1, 2, 3].includes(deel) ? deel : null;
}

/** Moet dit document bij opslaan opnieuw naar PDF/A? */
export function moetHerconverteren(doc) {
  if (!doc?.pdfaCompliance) return false;
  return doc.pdfaOpslaan !== 'verwijder';
}

/**
 * De bytes die opslaan schrijft voor een (bewerkt) PDF/A-document.
 * @param {Uint8Array} bytes wat de saver zonder PDF/A zou schrijven
 * @param {object} doc
 * @param {(bytes: Uint8Array, deel: number) => Promise<{ ok: boolean, bytes: Uint8Array, onopgelost: Array }>} converteer
 * @returns {Promise<{ bytes: Uint8Array, behouden: {part:number, conformance:string}|null, deel: number|null,
 *   redenen: Array, nietOndersteund: boolean, fout?: any }>}
 */
export async function herconverteerVoorOpslaan(bytes, doc, converteer) {
  if (!moetHerconverteren(doc)) return { bytes, behouden: null, deel: null, redenen: [], nietOndersteund: false };
  const deel = herconversieDeel(doc.pdfaCompliance);
  if (!deel) return { bytes, behouden: null, deel: null, redenen: [], nietOndersteund: true };
  try {
    const r = await converteer(bytes, deel);
    if (r.ok) return { bytes: r.bytes, behouden: { part: deel, conformance: 'B' }, deel, redenen: [], nietOndersteund: false };
    return { bytes, behouden: null, deel, redenen: r.onopgelost || [], nietOndersteund: false };
  } catch (fout) {
    return { bytes, behouden: null, deel, redenen: [], nietOndersteund: false, fout };
  }
}
