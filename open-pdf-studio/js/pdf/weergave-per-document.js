// Weergavestand per document voor de enkelpagina-viewport (#539).
//
// De viewport (pdf-viewport.js) is één singleton die alle tabbladen delen.
// Bij een tabwissel zag setPage() "een nieuw bestand" en maakte het document
// opnieuw passend: zoom en verschuiving van het document waar je vandaan kwam
// waren weg. Wie met Ctrl+Tab twee tekeningen om en om toont om verschillen
// te zien (op gelijke zoom, ingezoomd op hetzelfde detail), had daar niets
// aan. Nu bewaart de viewport bij elke documentwissel de stand van het
// vertrekkende document en zet hij die van het aankomende terug.
//
// Puur en zonder DOM: pdf-viewport.js levert de waarden aan.

/**
 * Momentopname van hoe een document in de viewport lag.
 * @param {any} vp  de viewport-singleton (of een object met dezelfde velden)
 * @param {{verankerd?: boolean, strikt?: boolean, cssW: number, cssH: number}} canvas
 *   verankerd/strikt: de ankervlaggen van de viewport (gebruiker heeft zelf
 *   gezoomd/gepand); cssW/cssH: de canvasmaat in CSS-pixels
 * @returns {object|null}  null als er niets zinnigs te bewaren valt
 */
export function maakWeergaveStand(vp, { verankerd = false, strikt = false, cssW, cssH } = {}) {
  if (!vp || !vp.filePath) return null;
  if (!(Number.isFinite(vp.zoom) && vp.zoom > 0)) return null;
  if (!(vp.pageW > 0 && vp.pageH > 0)) return null;
  if (!(cssW > 0 && cssH > 0)) return null;
  return {
    filePath: vp.filePath,
    pageNum: vp.pageNum,
    rotation: normaliseer(vp.rotation),
    viewRotation: normaliseer(vp.viewRotation),
    pageW: vp.pageW,
    pageH: vp.pageH,
    zoom: vp.zoom,
    offsetX: vp.offsetX,
    offsetY: vp.offsetY,
    pageType: vp.pageType,
    fitMode: vp.fitMode,
    verankerd: !!verankerd,
    strikt: !!strikt,
    cssW,
    cssH,
  };
}

function normaliseer(rotatie) {
  const r = Math.round(Number(rotatie) || 0) % 360;
  return r < 0 ? r + 360 : r;
}

/**
 * Hoort de stand bij wat setPage nu gaat tonen? Zelfde bestand, pagina,
 * paginarotatie, weergaverotatie en paginamaat; anders klopt de bewaarde
 * verschuiving niet meer en is opnieuw passend maken beter.
 * @param {object|null} stand
 * @param {{filePath: string, pageNum: number, rotation?: number, viewRotation?: number, pageW: number, pageH: number}} doel
 */
export function standPastBij(stand, doel) {
  if (!stand || !doel) return false;
  return stand.filePath === doel.filePath
    && stand.pageNum === doel.pageNum
    && stand.rotation === normaliseer(doel.rotation)
    && stand.viewRotation === normaliseer(doel.viewRotation)
    && Math.abs(stand.pageW - doel.pageW) < 0.01
    && Math.abs(stand.pageH - doel.pageH) < 0.01;
}

/**
 * De waarden om terug te zetten op het huidige canvas. Is het canvas niet van
 * maat veranderd, dan exact de bewaarde zoom en verschuiving. Wel veranderd
 * (bv. een paneel ging open terwijl het andere tabblad voor lag): hetzelfde
 * als bij een gewone venstermaatwijziging (pdf-viewport.js _resizeCanvas) —
 * een zelf ingesteld beeld houdt zijn middelpunt, een passend beeld wordt
 * opnieuw passend gemaakt.
 * @param {object} stand
 * @param {{cssW: number, cssH: number}} canvas
 */
export function herstelWaarden(stand, { cssW, cssH }) {
  const zelfdeMaat = Math.abs(stand.cssW - cssW) < 0.5 && Math.abs(stand.cssH - cssH) < 0.5;
  if (zelfdeMaat) {
    return {
      fitMode: stand.fitMode,
      zoom: stand.zoom,
      offsetX: stand.offsetX,
      offsetY: stand.offsetY,
      verankerd: stand.verankerd,
      strikt: stand.strikt,
      opnieuwPassend: false,
    };
  }
  if (!stand.verankerd) return { opnieuwPassend: true, fitMode: stand.fitMode };
  const midX = (stand.cssW / 2 - stand.offsetX) / stand.zoom;
  const midY = (stand.cssH / 2 - stand.offsetY) / stand.zoom;
  return {
    fitMode: stand.fitMode,
    zoom: stand.zoom,
    offsetX: cssW / 2 - midX * stand.zoom,
    offsetY: cssH / 2 - midY * stand.zoom,
    verankerd: true,
    strikt: stand.strikt,
    opnieuwPassend: false,
  };
}

/**
 * Geheugen van standen, één per bestandspad (de viewport kent documenten aan
 * hun pad). `neem` geeft een stand één keer terug: na het terugzetten is hij
 * verouderd, bij het volgende vertrek komt er een verse.
 */
export function maakStandGeheugen() {
  const standen = new Map();
  return {
    bewaar(stand) {
      if (stand && stand.filePath) standen.set(stand.filePath, stand);
    },
    neem(filePath) {
      if (!filePath || !standen.has(filePath)) return null;
      const stand = standen.get(filePath);
      standen.delete(filePath);
      return stand;
    },
    vergeet(filePath) {
      standen.delete(filePath);
    },
  };
}

/**
 * Een documentwissel in de viewport: bewaar de stand van het vertrekkende
 * document (alleen als dat nog open is — een net gesloten document laat niets
 * achter) en geef de terug te zetten waarden van het aankomende, of null als
 * het opnieuw passend gemaakt moet worden.
 * @param {ReturnType<typeof maakStandGeheugen>} geheugen
 * @param {{vertrek: object|null, openPaden: string[], aankomst: object, canvas: {cssW: number, cssH: number}}} wissel
 */
export function wisselWeergave(geheugen, { vertrek, openPaden, aankomst, canvas }) {
  if (vertrek && (openPaden || []).includes(vertrek.filePath)) geheugen.bewaar(vertrek);
  const stand = geheugen.neem(aankomst?.filePath);
  if (!standPastBij(stand, aankomst)) return null;
  return herstelWaarden(stand, canvas);
}

// Het geheugen van de app. Sluiten van een tabblad vergeet de stand van dat
// bestand (document-release.js), zodat opnieuw openen gewoon passend begint.
const _geheugen = maakStandGeheugen();

export function weergaveGeheugen() {
  return _geheugen;
}

export function vergeetWeergaveStand(filePath) {
  _geheugen.vergeet(filePath);
}
