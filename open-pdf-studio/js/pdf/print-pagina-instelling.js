// Beslisregels van de Pagina-instelling (bereikbaar vanuit de printdialoog).
//
// De dialoog begon altijd op A4 staand, ongeacht het document, en wat erin
// werd ingesteld bereikte de printer niet. Hier staat de pure logica:
// afleiden uit de pagina, een handmatige keuze per document onthouden, en de
// argumenten voor print_pdf. Geen DOM, geen state — volledig te testen.

/** Een verlengd vel is het basisvel plus één A4-breedte in de lengte; het vouwt terug naar A4. */
export const VERLENGING_MM = 210;

/**
 * Papierformaten in mm (staand), in de volgorde van de keuzelijst.
 *
 * A1, A0 en de verlengde vellen (A3L, A2L, A1L, A0L) hebben in Windows geen
 * vaste papiercode. Rust zoekt de maat in de papierlijst van de driver en
 * stuurt hem anders als eigen maat; kan de driver het vel niet maken (de
 * pdf-printer van Windows kent alleen zijn vaste lijst, dus wel A1 en A0 maar
 * geen verlengde vellen), dan blijft het papier van de printer staan en
 * meldt de printdialoog dat (zie print_formulieren.rs, waar dezelfde maten
 * staan; een test bewaakt dat).
 */
export const PAPIERFORMATEN = Object.freeze({
  a0: { breedte: 841, hoogte: 1189, label: 'A0' },
  a1: { breedte: 594, hoogte: 841, label: 'A1' },
  a2: { breedte: 420, hoogte: 594, label: 'A2' },
  a3: { breedte: 297, hoogte: 420, label: 'A3' },
  a4: { breedte: 210, hoogte: 297, label: 'A4' },
  a5: { breedte: 148, hoogte: 210, label: 'A5' },
  a0l: { breedte: 841, hoogte: 1189 + VERLENGING_MM, label: 'A0L' },
  a1l: { breedte: 594, hoogte: 841 + VERLENGING_MM, label: 'A1L' },
  a2l: { breedte: 420, hoogte: 594 + VERLENGING_MM, label: 'A2L' },
  a3l: { breedte: 297, hoogte: 420 + VERLENGING_MM, label: 'A3L' },
  letter: { breedte: 216, hoogte: 279, label: 'Letter' },
  legal: { breedte: 216, hoogte: 356, label: 'Legal' },
  tabloid: { breedte: 279, hoogte: 432, label: 'Tabloid' },
});

/** Tekst in de keuzelijst en in de kop van de printdialoog: "A3L (297 x 630 mm)". */
export function formaatTekst(sleutel) {
  const f = PAPIERFORMATEN[sleutel];
  return f ? `${f.label} (${f.breedte} x ${f.hoogte} mm)` : null;
}

const TOLERANTIE_MM = 3;
const PT_NAAR_MM = 25.4 / 72;

function geldig(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Breder dan hoog → liggend; vierkant of onbekend → staand. */
export function paginaOrientatie(breedtePt, hoogtePt) {
  return geldig(breedtePt) && geldig(hoogtePt) && breedtePt > hoogtePt ? 'landscape' : 'portrait';
}

/** Formaat uit de lijst dat binnen de tolerantie past, in beide oriëntaties; anders 'printer'. */
export function paginaFormaat(breedtePt, hoogtePt) {
  if (!geldig(breedtePt) || !geldig(hoogtePt)) return 'printer';
  const kort = Math.min(breedtePt, hoogtePt) * PT_NAAR_MM;
  const lang = Math.max(breedtePt, hoogtePt) * PT_NAAR_MM;
  for (const [sleutel, f] of Object.entries(PAPIERFORMATEN)) {
    if (Math.abs(kort - f.breedte) <= TOLERANTIE_MM && Math.abs(lang - f.hoogte) <= TOLERANTIE_MM) {
      return sleutel;
    }
  }
  return 'printer';
}

/**
 * Waarmee de dialoog opent. Een handmatige keuze blijft staan zolang het om
 * hetzelfde document gaat; anders volgt de dialoog de huidige pagina.
 */
export function startPaginaInstelling({ bewaard, docId, breedtePt, hoogtePt }) {
  if (bewaard && bewaard.handmatig && bewaard.docId === docId) {
    return { size: bewaard.size, orientation: bewaard.orientation, handmatig: true };
  }
  if (!geldig(breedtePt) || !geldig(hoogtePt)) {
    return {
      size: bewaard?.size || 'a4',
      orientation: bewaard?.orientation || 'portrait',
      handmatig: false,
    };
  }
  return {
    size: paginaFormaat(breedtePt, hoogtePt),
    orientation: paginaOrientatie(breedtePt, hoogtePt),
    handmatig: false,
  };
}

/** Wat er bij OK bewaard wordt. Handmatig = afwijkend van de start, of dat al was. */
export function bewaarPaginaInstelling({ start, gekozen, docId }) {
  const afwijkend = gekozen.size !== start.size || gekozen.orientation !== start.orientation;
  return {
    docId,
    size: gekozen.size,
    orientation: gekozen.orientation,
    handmatig: Boolean(start.handmatig || afwijkend),
  };
}

/**
 * Argumenten voor print_pdf. Alleen een Pagina-instelling die voor dít
 * document is bevestigd telt; anders geen verzonnen A4-standaard maar het
 * gedrag van vóór deze wijziging (per pagina draaien, papier van de printer).
 */
export function printArgumenten({ autoRotate, paginaInstelling, docId }) {
  const voorDitDocument = Boolean(paginaInstelling) && paginaInstelling.docId === docId;
  return {
    orientatie: autoRotate || !voorDitDocument ? 'auto' : paginaInstelling.orientation,
    papier: voorDitDocument ? paginaInstelling.size : 'printer',
  };
}

/**
 * Welke gekozen stand "Automatisch draaien" stil overstemt, zodat de
 * printdialoog dat kan zeggen: de stand uit de voor dít document bevestigde
 * Pagina-instelling, als Automatisch draaien aan staat (printArgumenten stuurt
 * dan 'auto') en de getoonde pagina daardoor de andere kant op gaat. Ligt de
 * pagina al zoals gekozen, dan verandert er niets en is er niets te melden.
 * @returns {'portrait'|'landscape'|null}
 */
export function overstemdeStand({ autoRotate, paginaInstelling, docId, pagina }) {
  if (!autoRotate || !paginaInstelling || paginaInstelling.docId !== docId) return null;
  const gekozen = paginaInstelling.orientation;
  if (gekozen !== 'portrait' && gekozen !== 'landscape') return null;
  if (!pagina || !geldig(pagina.breedtePt) || !geldig(pagina.hoogtePt)) return null;
  return paginaOrientatie(pagina.breedtePt, pagina.hoogtePt) === gekozen ? null : gekozen;
}
