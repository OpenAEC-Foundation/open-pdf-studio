// Een bestand dat de gebruiker in het venster laat vallen.
//
// De bureaubladschil geeft bij een drop een PAD; die weg loopt via
// setupTauriDragDrop(). Een browser geeft dat pad niet — `File.path` bestaat
// daar niet — en de oude terugval las precies dat veld. Gevolg (#456): een
// gesleepte PDF werd zonder melding genegeerd.
//
// In de browser is er wel een File-object, en dus bytes. Die gaan langs
// dezelfde weg als de bestandskiezer: de bytes onder de bestandsNAAM in de
// webbestandscache, daarna een tabblad op die naam. Zo is er maar één
// in-geheugenroute om te onderhouden.
//
// Deze module bevat de beslissing en de volgorde; wát er opengaat komt via
// `haken` binnen, zodat het geheel zonder DOM te testen is.

const AFBEELDINGEN = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
const TEKENINGEN = ['.dwg', '.dxf'];

/** '.pdf' uit 'map/Bestand.PDF'; lege string zonder punt. */
export function bestandsExtensie(naam) {
  const punt = String(naam || '').lastIndexOf('.');
  return punt >= 0 ? String(naam).substring(punt).toLowerCase() : '';
}

/**
 * Wat is dit voor bestand, en kan de webversie er iets mee?
 * @returns {'pdf'|'afbeelding'|'tekening'|'onbekend'}
 */
export function soortVanBestand(naam) {
  const ext = bestandsExtensie(naam);
  if (ext === '.pdf') return 'pdf';
  if (AFBEELDINGEN.includes(ext)) return 'afbeelding';
  if (TEKENINGEN.includes(ext)) return 'tekening';
  return 'onbekend';
}

/**
 * Open de gesleepte bestanden in de webversie.
 *
 * @param {Iterable<File>} bestanden
 * @param {object} haken
 * @param {(naam: string, bytes: Uint8Array) => Promise<void>} haken.openPdf
 * @param {(bestand: File) => Promise<void>} haken.openAfbeelding
 * @param {(functie: string) => void} [haken.geenWebvariant] voor tekeningen
 * @returns {Promise<Array<{naam: string, soort: string, gelukt: boolean}>>}
 */
export async function openGesleepteBestanden(bestanden, haken) {
  const uitkomst = [];
  for (const bestand of Array.from(bestanden || [])) {
    const naam = bestand?.name || '';
    const soort = soortVanBestand(naam);
    try {
      if (soort === 'pdf') {
        const bytes = new Uint8Array(await bestand.arrayBuffer());
        await haken.openPdf(naam, bytes);
        uitkomst.push({ naam, soort, gelukt: true });
      } else if (soort === 'afbeelding') {
        await haken.openAfbeelding(bestand);
        uitkomst.push({ naam, soort, gelukt: true });
      } else if (soort === 'tekening') {
        // CAD-invoer draait op de Rust-kant en bestaat hier niet. Eén melding
        // in plaats van stilte.
        haken.geenWebvariant?.('cadImport');
        uitkomst.push({ naam, soort, gelukt: false });
      } else {
        uitkomst.push({ naam, soort, gelukt: false });
      }
    } catch (e) {
      console.warn('[drop] kon gesleept bestand niet openen:', naam, e);
      uitkomst.push({ naam, soort, gelukt: false });
    }
  }
  return uitkomst;
}
