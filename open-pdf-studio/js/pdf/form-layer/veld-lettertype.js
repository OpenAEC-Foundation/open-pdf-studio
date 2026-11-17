// Het lettertype van een formulierveld op het scherm (#1154).
//
// Een bewerkbaar veld staat op het scherm alleen in de HTML-formulierlaag
// (formulierlaag-scherm.js); PDF.js geeft het invoervak de grootte en kleur
// uit de /DA van het veld, maar geen lettertype. Een veld in een ingebed
// lettertype (bijvoorbeeld machineleesbare cijfers op een cheque) stond
// daardoor in het gewone schermlettertype.
//
// De bestaande weergave van het veld (/AP /N) tekent zijn tekst in dat
// lettertype. PDF.js laadt het bij het uitlezen van de tekenopdrachten van de
// pagina en meldt het als weblettertype aan; het invoervak krijgt die naam,
// zodat het veld er met en zonder focus zo uitziet als in het bestand. Is het
// lettertype niet ingebed of niet te laden, dan blijft het invoervak zoals het
// was.

// Namen waarmee een /DA een van de standaardlettertypen aanwijst: daarvoor
// hoeft de pagina niet te worden uitgelezen.
const STANDAARD_NAMEN = new Set([
  'helv', 'hebo', 'heob', 'hebi', 'cour', 'cobo', 'coob', 'cobi',
  'tiro', 'tibo', 'tiit', 'tibi', 'symb', 'zadb',
  'helvetica', 'helvetica-bold', 'helvetica-oblique', 'helvetica-boldoblique',
  'courier', 'courier-bold', 'courier-oblique', 'courier-boldoblique',
  'times-roman', 'times-bold', 'times-italic', 'times-bolditalic',
  'symbol', 'zapfdingbats', 'arial', 'arialmt',
]);

/** Noemt dit veld in zijn /DA een eigen (niet-standaard) lettertype en heeft het een weergave? */
export function vraagtEigenLettertype(annotatie) {
  if (annotatie?.subtype !== 'Widget') return false;
  if (annotatie.fieldType !== 'Tx' && annotatie.fieldType !== 'Ch') return false;
  if (!annotatie.hasAppearance) return false;
  const naam = String(annotatie.defaultAppearanceData?.fontName || '');
  return naam !== '' && !STANDAARD_NAMEN.has(naam.toLowerCase());
}

/**
 * Per annotatie het eerste lettertype dat haar weergave gebruikt.
 * @param {{ fnArray: number[], argsArray: any[] }} opList tekenopdrachten van de pagina, met annotaties
 * @param {{ beginAnnotation: number, endAnnotation: number, setFont: number }} OPS
 * @returns {Map<string, string>} annotatie-id → naam van het lettertype-object
 */
export function lettertypenPerAnnotatie(opList, OPS) {
  const uit = new Map();
  const fn = opList?.fnArray || [];
  const args = opList?.argsArray || [];
  let huidige = null;
  for (let i = 0; i < fn.length; i++) {
    if (fn[i] === OPS.beginAnnotation) {
      huidige = args[i]?.[0] ?? null;
    } else if (fn[i] === OPS.endAnnotation) {
      huidige = null;
    } else if (fn[i] === OPS.setFont && huidige != null && !uit.has(huidige)) {
      const naam = args[i]?.[0];
      if (typeof naam === 'string' && naam) uit.set(huidige, naam);
    }
  }
  return uit;
}

function wachtOpObject(commonObjs, naam, maxMs = 5000) {
  return new Promise((klaar) => {
    const klok = setTimeout(() => klaar(null), maxMs);
    try {
      if (commonObjs.has(naam)) {
        clearTimeout(klok);
        klaar(commonObjs.get(naam));
        return;
      }
      commonObjs.get(naam, (obj) => { clearTimeout(klok); klaar(obj); });
    } catch {
      clearTimeout(klok);
      klaar(null);
    }
  });
}

/** De CSS-familie van een geladen PDF.js-lettertype, of '' als het niet ingebed of niet aangemeld is. */
export function cssFamilie(fontObj, isAangemeld) {
  const naam = fontObj?.loadedName;
  if (!naam || fontObj.missingFile || fontObj.isType3Font) return '';
  return isAangemeld(naam) ? naam : '';
}

/**
 * Geef de invoervakken van de velden met een eigen lettertype dat lettertype.
 * Loopt na het opbouwen van de formulierlaag en houdt die niet op.
 *
 * @returns {Promise<number>} het aantal velden dat een lettertype kreeg
 */
export async function pasVeldLettertypenToe(page, formLayerDiv, annotaties, { OPS, AnnotationMode }) {
  const velden = annotaties.filter(vraagtEigenLettertype);
  if (velden.length === 0) return 0;
  const opList = await page.getOperatorList({ intent: 'display', annotationMode: AnnotationMode.ENABLE });
  const perAnnotatie = lettertypenPerAnnotatie(opList, OPS);
  const isAangemeld = (naam) => {
    try { return document.fonts.check(`12px "${naam}"`); } catch { return false; }
  };
  let gezet = 0;
  for (const veld of velden) {
    const objNaam = perAnnotatie.get(veld.id);
    if (!objNaam) continue;
    const familie = cssFamilie(await wachtOpObject(page.commonObjs, objNaam), isAangemeld);
    if (!familie) continue;
    const sectie = formLayerDiv.querySelector(`[data-annotation-id="${veld.id}"]`);
    const vakken = sectie ? sectie.querySelectorAll('input, textarea, select') : [];
    for (const vak of vakken) vak.style.fontFamily = `"${familie}", sans-serif`;
    if (vakken.length) gezet += 1;
  }
  return gezet;
}
