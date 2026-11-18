// Zoomen met het hand-gereedschap (#1161): beleid, zonder DOM of app-state.
//
// Het hand-gereedschap pant door te slepen. Met alleen de linkermuisknop kan
// er daarnaast gezoomd worden, zoals in andere markup-programma's:
//
//   slepen                 pannen (ongewijzigd)
//   Ctrl + klik            één stap inzoomen op het aangeklikte punt
//   Ctrl + Shift + klik    één stap uitzoomen
//   Ctrl + slepen          zoomrechthoek: het getrokken gebied vult het beeld
//   klik / Shift + klik    in- en uitzoomen zonder Ctrl, alleen als de
//                          voorkeur "Klikken met de hand zoomt in" aan staat
//
// (Op macOS is Ctrl hier Cmd: Ctrl + klik is daar de rechtermuisknop.)
//
// Een "klik" is indrukken en loslaten zonder noemenswaardige beweging en
// binnen korte tijd; lang vasthouden of een stukje slepen blijft pannen.
// Het gebaar telt alleen als de hand er ook echt een pan mee begon: een klik
// op een annotatie, link of formulierveld doet wat hij altijd deed.
//
// De bedrading (luisteraars, het echte zoomen, de rechthoek op het scherm)
// staat in hand-zoom.js.

/** Grootste beweging (px) die nog als klik telt. */
export const KLIK_MAX_PX = 4;
/** Langste duur (ms) van indrukken tot loslaten die nog als klik telt. */
export const KLIK_MAX_MS = 500;
/** Kleinste zijde (px) van een zoomrechthoek; kleiner is geen rechthoek. */
export const RECHTHOEK_MIN_PX = 8;

const begrens = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * Wat doet een losgelaten klik met de hand?
 * @param {object} g
 * @param {number} g.afstand      grootste afstand tot het startpunt (px)
 * @param {number} g.duurMs       tijd tussen indrukken en loslaten
 * @param {boolean} g.ctrl        Ctrl (Cmd op macOS) bij het indrukken
 * @param {boolean} g.shift       Shift bij het indrukken
 * @param {boolean} [g.alt]       Alt bij het indrukken (blijft vrij)
 * @param {boolean} g.klikZoomAan voorkeur: klikken zonder Ctrl zoomt
 * @returns {1 | -1 | 0} zoomrichting, 0 = niets doen
 */
export function klikZoomRichting({ afstand, duurMs, ctrl, shift, alt = false, klikZoomAan }) {
  if (!(afstand <= KLIK_MAX_PX) || !(duurMs <= KLIK_MAX_MS)) return 0;
  if (alt) return 0;
  if (!ctrl && !klikZoomAan) return 0;
  return shift ? -1 : 1;
}

/** Genormaliseerde rechthoek tussen twee punten. */
export function rechthoekTussen(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Is de rechthoek groot genoeg om naar te zoomen? */
export function isZoomRechthoek(r) {
  return !!r && r.w >= RECHTHOEK_MIN_PX && r.h >= RECHTHOEK_MIN_PX;
}

/**
 * Zoom en anker voor een zoomrechthoek in een scrollende weergave. De
 * rechthoek staat in dezelfde coördinaten als het beeld (linksboven = 0,0).
 * Eerst zoomen met `factor` rond het anker (het midden van de rechthoek
 * blijft staan), daarna `schuifX/schuifY` scrollen: het midden van de
 * rechthoek komt dan in het midden van het beeld.
 * @returns {{zoom: number, factor: number, ankerX: number, ankerY: number, schuifX: number, schuifY: number} | null}
 */
export function zoomVoorRechthoek({ rechthoek, beeldW, beeldH, zoom, min, max }) {
  if (!isZoomRechthoek(rechthoek) || !(beeldW > 0) || !(beeldH > 0) || !(zoom > 0)) return null;
  const gewenst = zoom * Math.min(beeldW / rechthoek.w, beeldH / rechthoek.h);
  const nieuw = begrens(gewenst, min, max);
  const ankerX = rechthoek.x + rechthoek.w / 2;
  const ankerY = rechthoek.y + rechthoek.h / 2;
  return {
    zoom: nieuw,
    factor: nieuw / zoom,
    ankerX,
    ankerY,
    schuifX: ankerX - beeldW / 2,
    schuifY: ankerY - beeldH / 2,
  };
}

/**
 * Nieuwe stand van de vector-viewport voor een zoomrechthoek. Scherm =
 * pagina × zoom + offset (een weergaverotatie zit in "pagina" en verandert
 * dit niet): het punt in het midden van de rechthoek komt in het midden van
 * het canvas te staan.
 * @returns {{zoom: number, offsetX: number, offsetY: number} | null}
 */
export function viewportStandVoorRechthoek({ rechthoek, canvasW, canvasH, zoom, offsetX, offsetY, min, max }) {
  const z = zoomVoorRechthoek({ rechthoek, beeldW: canvasW, beeldH: canvasH, zoom, min, max });
  if (!z) return null;
  return {
    zoom: z.zoom,
    offsetX: canvasW / 2 - (z.ankerX - offsetX) * z.factor,
    offsetY: canvasH / 2 - (z.ankerY - offsetY) * z.factor,
  };
}

// Elementen waar een klik met de hand zijn eigen werk doet.
const EIGEN_KLIK = '.linkLayer .pdf-link, .formLayer, a[href], button, select, input, textarea, '
  + '[contenteditable="true"], .compare-view';

/**
 * Mag dit indrukken een hand-zoomgebaar worden? Alleen de linkermuisknop van
 * een muis, in de PDF-weergave, en niet op een link, formulierveld of
 * bedieningselement. Aanraking en pen houden hun eigen gebaren.
 * @param {object} e  pointerdown
 */
export function isHandZoomStart(e) {
  if (!e || e.button !== 0) return false;
  if (e.pointerType && e.pointerType !== 'mouse') return false;
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return false;
  if (!t.closest('#pdf-container')) return false;
  if (t.isContentEditable || t.closest(EIGEN_KLIK)) return false;
  return true;
}

/**
 * De toestandsmachine van het gebaar. Alle app-kennis komt via `d` binnen:
 *
 * @param {object} d
 * @param {() => boolean} d.actief         hand-gereedschap, document open, niets dat het gebaar blokkeert
 * @param {() => boolean} d.handPanLoopt   loopt er een pan van de hand (links)?
 * @param {() => void} d.breekPanAf        die pan afbreken (idempotent)
 * @param {() => boolean} d.klikZoomAan    voorkeur: klik zonder Ctrl zoomt
 * @param {(e: object) => boolean} d.ctrl  Ctrl (Cmd op macOS) ingedrukt?
 * @param {(x: number, y: number, richting: 1 | -1) => void} d.zoomStap  client-coördinaten
 * @param {(r: {x: number, y: number, w: number, h: number}) => void} d.zoomRechthoek  client-coördinaten
 * @param {(r: {x: number, y: number, w: number, h: number}) => void} d.toonRechthoek
 * @param {() => void} d.verbergRechthoek
 */
export function maakHandZoomHandlers(d) {
  // null = geen gebaar; anders het lopende gebaar.
  let g = null;

  function stop() {
    if (g?.rechthoek) d.verbergRechthoek();
    g = null;
  }

  const afstandTot = (e) => Math.hypot(e.clientX - g.x, e.clientY - g.y);
  const huidigeRechthoek = (e) => rechthoekTussen({ x: g.x, y: g.y }, { x: e.clientX, y: e.clientY });

  return {
    /** Loopt er een zoomrechthoek? */
    rechthoekActief: () => !!g?.rechthoek,
    reset: stop,

    onPointerDown(e) {
      stop();
      if (!isHandZoomStart(e) || !d.actief()) return;
      g = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        ctrl: !!d.ctrl(e),
        shift: !!e.shiftKey,
        alt: !!e.altKey,
        afstand: 0,
        rechthoek: false,
      };
    },

    onPointerMove(e) {
      if (!g || e.pointerId !== g.id) return;
      // Beweging zonder ingedrukte linkerknop: het loslaten is gemist.
      if (typeof e.buttons === 'number' && !(e.buttons & 1)) { stop(); return; }
      g.afstand = Math.max(g.afstand, afstandTot(e));
      if (g.rechthoek) {
        d.toonRechthoek(huidigeRechthoek(e));
        return;
      }
      if (!g.ctrl) return;
      // Ctrl + slepen: de pan die de hand net begon wordt een zoomrechthoek.
      // Begon er geen pan (annotatie, link), dan is dit gebaar niet van ons.
      if (!d.handPanLoopt()) { stop(); return; }
      d.breekPanAf();
      g.rechthoek = true;
      d.toonRechthoek(huidigeRechthoek(e));
    },

    onPointerUp(e) {
      if (!g || e.pointerId !== g.id) return;
      const gebaar = g;
      const afstand = Math.max(gebaar.afstand, afstandTot(e));
      const rechthoek = huidigeRechthoek(e);
      const duurMs = e.timeStamp - gebaar.t;
      const panLiep = d.handPanLoopt();
      stop();
      if (gebaar.rechthoek && isZoomRechthoek(rechthoek)) {
        d.zoomRechthoek(rechthoek);
        return;
      }
      // Een klik telt alleen als de hand er een pan mee begon (dus niet op
      // een annotatie of link), of als die pan net een rechthoek werd.
      if (!gebaar.rechthoek && !panLiep) return;
      const richting = klikZoomRichting({
        afstand,
        duurMs,
        ctrl: gebaar.ctrl,
        shift: gebaar.shift,
        alt: gebaar.alt,
        klikZoomAan: d.klikZoomAan(),
      });
      if (!richting) return;
      d.breekPanAf();
      d.zoomStap(gebaar.x, gebaar.y, richting);
    },

    onPointerCancel(e) {
      if (g && e.pointerId === g.id) stop();
    },

    /** Escape breekt een lopende zoomrechthoek af. */
    onKeyDown(e) {
      if (e.key !== 'Escape' || !g?.rechthoek) return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    },
  };
}
