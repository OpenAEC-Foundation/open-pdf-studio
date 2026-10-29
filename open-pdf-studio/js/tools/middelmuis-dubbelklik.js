// Herkenning van een dubbelklik met de middelste muisknop (issue #767).
//
// Een dubbelklik op het scrollwiel past de huidige pagina in het venster
// ("zoom alles"), zoals tekenprogramma's dat doen: middelslepen pant, het wiel
// zoomt, dubbelklikken op het wiel brengt alles weer in beeld.
//
// De browser levert geen 'dblclick' voor de middelknop, dus deze pure
// toestandsmachine bepaalt het zelf uit druk/beweeg/los. De tijdbron wordt
// meegegeven, zodat de tests zonder echte klok draaien.
//
// Regels:
//   - beide drukken liggen binnen `tijdMs` van elkaar (gemeten vanaf de eerste
//     druk, zoals de dubbelkliktijd van het besturingssysteem);
//   - elke druk is een korte klik: losgelaten binnen `tijdMs`;
//   - de cursor blijft binnen `margePx` van de eerste druk. Een middelsleep
//     (pan) breekt de reeks dus af, ook als die met een snelle klik begint;
//   - het gebaar vuurt pas bij het LOSLATEN van de tweede druk. Een pan die
//     direct na een klik start, heeft op dat moment al bewogen en vuurt niet;
//   - na een dubbelklik begint een derde klik een nieuwe reeks (geen herhaling).

/** Standaard dubbelkliktijd van Windows (GetDoubleClickTime). */
export const DUBBELKLIK_TIJD_MS = 500;
/** Bewegingsmarge in CSS-px rond de eerste druk. */
export const DUBBELKLIK_MARGE_PX = 4;

const RUST = 'rust';
const EERSTE_IN = 'eerste-in';
const EERSTE_LOS = 'eerste-los';
const TWEEDE_IN = 'tweede-in';

/**
 * @param {object} [o]
 * @param {() => number} [o.nu]     tijdbron in ms (standaard performance.now)
 * @param {number} [o.tijdMs]       maximale tijd tussen de twee drukken
 * @param {number} [o.margePx]      maximale verplaatsing tijdens de reeks
 */
export function maakMiddelmuisDubbelklik(o = {}) {
  const nu = o.nu || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const tijdMs = o.tijdMs ?? DUBBELKLIK_TIJD_MS;
  const margePx = o.margePx ?? DUBBELKLIK_MARGE_PX;

  let fase = RUST;
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let tweedeT = 0;

  const binnenMarge = (x, y) => Math.hypot(x - startX, y - startY) <= margePx;

  function begin(x, y, t) {
    fase = EERSTE_IN;
    startX = x;
    startY = y;
    startT = t;
  }

  return {
    /** Middelknop ingedrukt op (x, y). */
    druk(x, y) {
      const t = nu();
      if (fase === EERSTE_LOS && t - startT <= tijdMs && binnenMarge(x, y)) {
        fase = TWEEDE_IN;
        tweedeT = t;
        return;
      }
      begin(x, y, t);
    },

    /** Cursor bewogen naar (x, y); te ver weg breekt de reeks af. */
    beweeg(x, y) {
      if (fase !== RUST && !binnenMarge(x, y)) fase = RUST;
    },

    /**
     * Middelknop losgelaten op (x, y).
     * @returns {boolean} true als hiermee een dubbelklik voltooid is
     */
    los(x, y) {
      const t = nu();
      if (fase === EERSTE_IN) {
        fase = (t - startT <= tijdMs && binnenMarge(x, y)) ? EERSTE_LOS : RUST;
        return false;
      }
      if (fase === TWEEDE_IN) {
        fase = RUST;
        return t - tweedeT <= tijdMs && binnenMarge(x, y);
      }
      fase = RUST;
      return false;
    },

    /** Reeks afbreken (pointercancel, venster verliest focus, ...). */
    reset() {
      fase = RUST;
    },

    /** Alleen voor tests en diagnose. */
    get fase() {
      return fase;
    },
  };
}
