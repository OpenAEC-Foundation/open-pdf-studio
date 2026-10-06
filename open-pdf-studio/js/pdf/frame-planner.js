// Render-lus op aanvraag voor de enkelpagina-viewport (pdf-viewport.js).
//
// Vroeger vroeg de lus na elk frame meteen het volgende aan, ook zonder werk.
// Een stilstaand venster tekende dan niets, maar liet de webview en de GPU
// toch elk schermframe wakker worden (op een 240 Hz-scherm ~15 % van een kern).
// De planner vraagt alleen een frame als heeftWerk() dat zegt, en nooit meer
// dan één tegelijk. Na elk frame kijkt hij opnieuw: blijft er werk (een
// wieluitloop, of iets in het frame zette opnieuw dirty), dan volgt er één.
//
// Puur: geen DOM. requestAnimationFrame/cancelAnimationFrame zijn mee te
// geven (testbaar met een nep-wachtrij, zie frame-planner.test.mjs); zonder
// die en zonder globale requestAnimationFrame (node) plant hij gewoon niets.

/**
 * @param {object} o
 * @param {() => boolean} o.heeftWerk  is er werk voor een volgend frame?
 * @param {(t: number) => void} o.frame  het werk van één frame
 * @param {((cb: (t: number) => void) => any) | null} [o.vraagFrame]  requestAnimationFrame
 * @param {((id: any) => void) | null} [o.annuleerFrame]  cancelAnimationFrame
 */
export function maakFramePlanner({ heeftWerk, frame, vraagFrame = null, annuleerFrame = null }) {
  let aan = false;
  let gepland = false;
  let id = 0;
  // Binnen frame(): schrijfacties vragen dan nog niets aan; na afloop kijkt
  // draai() zelf of er nog werk is (anders twee frames tegelijk).
  let bezig = false;

  function vraag() {
    if (vraagFrame) return vraagFrame;
    return typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
  }

  function annuleer() {
    if (annuleerFrame) return annuleerFrame;
    return typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null;
  }

  function draai(t) {
    gepland = false;
    id = 0;
    // Een frame dat na stop() toch nog afgaat, doet niets.
    if (!aan) return;
    bezig = true;
    try {
      frame(t);
    } finally {
      bezig = false;
    }
    // Gooit frame() een fout, dan komen we hier niet: pas de volgende
    // schrijfactie plant weer een frame (geen foutlus per frame).
    plan();
  }

  /** Vraag één frame aan als er werk is en er nog geen klaarstaat. */
  function plan() {
    if (!aan || bezig || gepland || !heeftWerk()) return false;
    const v = vraag();
    if (!v) return false;
    gepland = true;
    id = v(draai);
    return true;
  }

  return {
    plan,
    /** Lus aan; plant meteen een frame als er al werk wacht. */
    start() {
      aan = true;
      plan();
    },
    /** Lus uit; een klaarstaand frame vervalt. */
    stop() {
      aan = false;
      if (gepland) {
        gepland = false;
        const a = annuleer();
        if (a) a(id);
        id = 0;
      }
    },
    get aan() { return aan; },
    get gepland() { return gepland; },
  };
}

/**
 * Maak van obj[sleutel] een accessor (enumerable en configurable, dus gewoon
 * zichtbaar in JSON, spread en klonen) die na elke schrijfactie
 * naSchrijven(nieuw, oud) aanroept. De huidige waarde blijft staan, ook als
 * er al een accessor stond: een nieuwe module-instantie (HMR) neemt het over.
 *
 * @param {object} obj
 * @param {string} sleutel
 * @param {(nieuw: any, oud: any) => void} naSchrijven
 */
export function bewaakSchrijven(obj, sleutel, naSchrijven) {
  let waarde = obj[sleutel];
  Object.defineProperty(obj, sleutel, {
    enumerable: true,
    configurable: true,
    get() { return waarde; },
    set(nieuw) {
      const oud = waarde;
      waarde = nieuw;
      naSchrijven(nieuw, oud);
    },
  });
}
