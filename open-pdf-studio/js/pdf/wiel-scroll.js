// Wielscrollen met een korte, tijdgebonden uitloop (issue #522).
//
// Eén helper voor ALLE weergaven: de enkelpagina-viewport (verschuiving in
// pdf-viewport.js, gepompt door zijn render-lus) en de scrollende weergaven
// (doorlopend, boek, naast elkaar en lege documenten: scrollTop/scrollLeft
// van #pdf-container, via requestAnimationFrame).
//
// Vroeger gaf de enkelpagina-weergave elke wielklik snelheid mee die per
// FRAME met 0,88 afnam. Een klik liep daardoor altijd 41 frames uit: 0,7 s
// bij 60 fps, ruim 2 s zodra een zware vectorpagina het tempo naar 20 fps
// drukte, en hij legde ruim twee keer de wieldelta af. De doorlopende
// weergaven scrolden native, met de uitloop van de webview. Twee
// verschillende gevoelens, en één ervan veel te lang.
//
// Nu:
//  - een muiswielklik schuift precies zijn delta op, met een korte ease-out
//    van WIEL_DUUR_MS. De verstreken TIJD bepaalt de voortgang, niet het
//    aantal frames: ook bij trage frames staat de pagina op tijd stil.
//  - een klik tijdens de uitloop telt op bij wat nog moest komen en start de
//    curve opnieuw vanaf de huidige plek: geen klik gaat verloren, er bouwt
//    geen achterstand op, en omdat de curve monotoon is en exact op het doel
//    eindigt schiet hij nooit door. Een klik de andere kant op keert meteen
//    om; de eindpositie is altijd de som van de klikken. Aan de rand telt
//    alleen mee wat er nog bij past (zoals de browser zijn scrolldoel
//    klemt), zodat een klik terug ook daar meteen en volledig omkeert.
//  - touchpad- en fijne (hoge-resolutie) wieldelta's gaan direct 1-op-1
//    door. Het besturingssysteem levert daar zelf de traagheid bij; nog een
//    eigen uitloop erbovenop voelt zweverig.
//
// Puur: geen DOM. Klok en animatieframe worden meegegeven (testbaar met een
// nepklok, zie wiel-scroll.test.mjs).

// Duur van de uitloop van één wielklik.
export const WIEL_DUUR_MS = 180;

// Vanaf deze delta (px) is een los event een muiswielklik. Chromium meldt per
// klik 100 px (3 regels), bij één regel per klik 33 px. Touchpads en wielen
// met hoge resolutie leveren een stroom kleine delta's.
export const STAP_MIN_PX = 30;

// Een fijn event binnen dit venster maakt ook een grote delta tot onderdeel
// van hetzelfde touchpadgebaar (snelle veeg, traagheid van het OS).
export const STROOM_VENSTER_MS = 150;

// deltaMode 1 (regels): drie regels = 100 px, zoals Chromium een klik meldt.
export const REGEL_PX = 100 / 3;

// deltaMode 2 (pagina's): de browser bladert 87,5 % van het zichtbare gebied.
export const PAGINA_FRACTIE = 0.875;

// Ease-out (kubisch): snel vertrek, zachte landing, eindigt exact op 1.
export function uitloop(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const r = 1 - u;
  return 1 - r * r * r;
}

/**
 * Wieldelta in CSS-pixels per as.
 * @param {{deltaX?: number, deltaY?: number, deltaMode?: number, shiftKey?: boolean}} e
 * @param {number} [paginaPx]  hoogte van het zichtbare gebied (voor deltaMode 2)
 * @returns {{dx: number, dy: number}}
 */
export function leesWielDelta(e, paginaPx = 0) {
  let dx = Number(e.deltaX) || 0;
  let dy = Number(e.deltaY) || 0;
  // Shift+wiel = horizontaal. Chromium zet dat zelf al om naar deltaX;
  // andere webviews niet altijd.
  if (e.shiftKey && dx === 0 && dy !== 0) {
    dx = dy;
    dy = 0;
  }
  const factor = e.deltaMode === 1 ? REGEL_PX
    : e.deltaMode === 2 ? PAGINA_FRACTIE * (paginaPx || 0)
      : 1;
  return { dx: dx * factor, dy: dy * factor };
}

/**
 * Onderscheidt muiswielklikken (krijgen de uitloop) van touchpad- en fijne
 * wieldelta's (gaan 1-op-1 door). Onthoudt het laatste fijne event, zodat
 * een grote delta midden in een touchpadveeg niet alsnog vertraagd wordt.
 */
export function maakWielHerkenning({ venster = STROOM_VENSTER_MS, stapMin = STAP_MIN_PX } = {}) {
  let laatsteFijn = -Infinity;
  return {
    /**
     * @param {{deltaMode?: number}} e
     * @param {number} dx  delta in px (na leesWielDelta)
     * @param {number} dy
     * @param {number} nu  klok in ms
     */
    isStap(e, dx, dy, nu) {
      const grootte = Math.max(Math.abs(dx), Math.abs(dy));
      if (grootte === 0) return false;
      // Regels of pagina's komen alleen van een muiswiel.
      if (e.deltaMode === 1 || e.deltaMode === 2) return true;
      if (grootte < stapMin || nu - laatsteFijn <= venster) {
        laatsteFijn = nu;
        return false;
      }
      return true;
    },
  };
}

// Klem v op [lo, hi]; een ontbrekende grens (geen eindig getal) begrenst niet.
// De huidige plek (0) valt altijd binnen het bereik.
function _klem(v, lo, hi) {
  const onder = Number.isFinite(lo) ? Math.min(0, lo) : -Infinity;
  const boven = Number.isFinite(hi) ? Math.max(0, hi) : Infinity;
  return Math.min(boven, Math.max(onder, v));
}

/**
 * Tijdgebonden uitloop voor beide assen. voegToe() legt een nieuw doel vast
 * (rest van het lopende doel + de nieuwe delta) en start de curve opnieuw
 * vanaf de huidige plek; verloop(nu) geeft de verschuiving sinds de vorige
 * aanroep. De som van alle verschuivingen is precies de som van de delta's,
 * binnen het scrollbereik dat voegToe() eventueel meekrijgt.
 */
export function maakWielAnimatie({ duur = WIEL_DUUR_MS } = {}) {
  let actief = false;
  let start = 0;
  let doelX = 0;
  let doelY = 0;
  let gedaanX = 0;
  let gedaanY = 0;
  return {
    /**
     * @param {number} dx
     * @param {number} dy
     * @param {number} nu  klok in ms
     * @param {{loX?: number, hiX?: number, loY?: number, hiY?: number} | null} [ruimte]
     *        scrollbereik vanaf de huidige plek; het nieuwe doel blijft daarbinnen
     */
    voegToe(dx, dy, nu, ruimte = null) {
      doelX = (actief ? doelX - gedaanX : 0) + dx;
      doelY = (actief ? doelY - gedaanY : 0) + dy;
      // Niet voorbij de rand mikken (zoals de browser zijn eigen scrolldoel
      // klemt): een restant dat er toch niet meer bij past, zou een klik
      // terug opeten.
      if (ruimte) {
        doelX = _klem(doelX, ruimte.loX, ruimte.hiX);
        doelY = _klem(doelY, ruimte.loY, ruimte.hiY);
      }
      gedaanX = 0;
      gedaanY = 0;
      start = nu;
      actief = doelX !== 0 || doelY !== 0;
    },
    // De rest van de uitloop vervalt op de opgegeven as(sen), bijv. omdat het
    // element daar tegen de rand loopt. Op 0 zetten (niet doel = gedaan): de
    // curve rekent met doel x voortgang en zou anders teruglopen.
    laatVallen(x, y) {
      if (x) doelX = gedaanX = 0;
      if (y) doelY = gedaanY = 0;
      if (doelX === 0 && doelY === 0) actief = false;
    },
    verloop(nu) {
      if (!actief) return { dx: 0, dy: 0 };
      const u = duur > 0 ? (nu - start) / duur : 1;
      const klaar = u >= 1;
      const f = uitloop(u);
      // Laatste stap: exact het restant, zodat de som precies klopt.
      const nieuwX = klaar ? doelX : doelX * f;
      const nieuwY = klaar ? doelY : doelY * f;
      const dx = nieuwX - gedaanX;
      const dy = nieuwY - gedaanY;
      gedaanX = nieuwX;
      gedaanY = nieuwY;
      if (klaar) actief = false;
      return { dx, dy };
    },
    stop() {
      actief = false;
      doelX = doelY = gedaanX = gedaanY = 0;
    },
    get actief() { return actief; },
  };
}

// Alle wielscrollers (in de app: die van de viewport en die van
// #pdf-container), zodat een vloeiende sprong ze kan stoppen zonder ze te
// hoeven importeren.
const _alleScrollers = new Set();

/**
 * Wielscroller: uitloop + aandrijving.
 *
 * verschuif(dx, dy, vers) past een verschuiving toe (dy > 0 = inhoud omhoog,
 * zoals deltaY). `vers` is true bij de eerste stap van een nieuwe uitloop en
 * bij directe (touchpad)delta's. Geeft verschuif false terug, dan stopt de
 * uitloop (bijv. omdat iets anders intussen gescrold heeft); geeft hij
 * {randX, randY} terug, dan vervalt de rest van de uitloop op de as die
 * tegen de rand liep.
 *
 * @param {object} o
 * @param {() => number} o.nu  klok in ms
 * @param {(dx: number, dy: number, vers: boolean) => (boolean|void|{randX?: boolean, randY?: boolean})} o.verschuif
 * @param {((f: () => void) => any) | null} [o.vraagFrame]  requestAnimationFrame;
 *        zonder deze roept de eigenaar zelf elk frame pomp() aan (render-lus)
 * @param {(() => ({loX?: number, hiX?: number, loY?: number, hiY?: number} | null)) | null} [o.ruimte]
 *        scrollbereik vanaf de huidige plek (zie maakElementVerschuiver):
 *        een klik mikt nooit voorbij de rand
 * @param {number} [o.duur]
 */
export function maakWielScroller({ nu, verschuif, vraagFrame = null, ruimte = null, duur = WIEL_DUUR_MS }) {
  const animatie = maakWielAnimatie({ duur });
  let vers = false;
  let frameGevraagd = false;

  function plan() {
    if (!vraagFrame || frameGevraagd || !animatie.actief) return;
    frameGevraagd = true;
    vraagFrame(() => {
      frameGevraagd = false;
      pomp(nu());
    });
  }

  function pomp(t) {
    if (!animatie.actief) return false;
    const { dx, dy } = animatie.verloop(t);
    if (dx !== 0 || dy !== 0) {
      const gelukt = verschuif(dx, dy, vers);
      vers = false;
      if (gelukt === false) {
        animatie.stop();
        return false;
      }
      if (gelukt && (gelukt.randX || gelukt.randY)) animatie.laatVallen(!!gelukt.randX, !!gelukt.randY);
    }
    plan();
    return animatie.actief;
  }

  const scroller = {
    /**
     * Verwerk een wieldelta in px. `stap` = muiswielklik (krijgt de
     * uitloop); anders direct 1-op-1 toepassen.
     */
    wiel(dx, dy, stap) {
      if (!dx && !dy) return;
      if (!stap) {
        verschuif(dx, dy, true);
        return;
      }
      if (!animatie.actief) vers = true;
      animatie.voegToe(dx, dy, nu(), ruimte ? ruimte() : null);
      plan();
    },
    pomp,
    stop() {
      animatie.stop();
      vers = false;
    },
    get actief() { return animatie.actief; },
  };
  _alleScrollers.add(scroller);
  return scroller;
}

/**
 * Stop elke lopende wieluitloop. Aanroepen vlak vóór een vloeiende sprong
 * (scrollIntoView/scrollTo met behavior 'smooth'): die beweegt in het eerste
 * frame nog niet, dus de volgende stap van de uitloop ziet niets veranderd,
 * schrijft scrollTop en breekt de sprong in de webview af.
 */
export function stopAlleWielScrollers() {
  for (const s of _alleScrollers) s.stop();
}

/**
 * verschuif() voor een scrollend element (#pdf-container).
 *
 * - Browsers ronden scrollTop/scrollLeft af op (apparaat)pixels; het niet
 *   toegepaste deel (< 1 px) gaat mee naar de volgende stap, zodat een klik
 *   precies zijn delta oplevert.
 * - Wat aan de rand niet past (>= 1 px) vervalt, en met {randX, randY} ook de
 *   rest van de uitloop op die as: anders telt de uitloop dat deel als gedaan
 *   en eet het een klik terug op. verschuif.ruimte() geeft het scrollbereik,
 *   zodat maakWielScroller een klik al bij het optellen tot de rand beperkt.
 * - Staat het element bij een volgende stap ergens anders dan waar wij het
 *   lieten (schuifbalk gesleept, toetsen, directe sprong naar een pagina,
 *   zoom), dan heeft iets anders het overgenomen: false, zodat de uitloop
 *   stopt in plaats van ertegenin te duwen. Een VLOEIENDE sprong
 *   (scrollIntoView/scrollTo met behavior 'smooth') beweegt in het eerste
 *   frame nog niet en zou door de volgende stap worden afgebroken: roep
 *   daarvoor eerst stopAlleWielScrollers() aan.
 *
 * @param {() => ({scrollTop: number, scrollLeft: number,
 *   scrollHeight?: number, clientHeight?: number,
 *   scrollWidth?: number, clientWidth?: number} | null)} geefElement
 */
export function maakElementVerschuiver(geefElement) {
  let restX = 0;
  let restY = 0;
  let vorig = null;
  const verschuif = (dx, dy, vers = false) => {
    const el = geefElement();
    if (!el) {
      restX = restY = 0;
      vorig = null;
      return false;
    }
    if (!vers && vorig && vorig.el === el
      && (Math.abs(el.scrollTop - vorig.top) > 1 || Math.abs(el.scrollLeft - vorig.left) > 1)) {
      restX = restY = 0;
      vorig = null;
      return false;
    }
    let randX = false;
    let randY = false;
    if (dx !== 0) ({ rest: restX, rand: randX } = _zetScroll(el, 'scrollLeft', dx + restX));
    if (dy !== 0) ({ rest: restY, rand: randY } = _zetScroll(el, 'scrollTop', dy + restY));
    vorig = { el, top: el.scrollTop, left: el.scrollLeft };
    return randX || randY ? { randX, randY } : true;
  };
  // Scrollbereik vanaf de exacte plek (scrollpositie plus het nog niet
  // toegepaste breukdeel). Een as zonder maten is onbegrensd.
  verschuif.ruimte = () => {
    const el = geefElement();
    if (!el) return null;
    const [loX, hiX] = _bereik(el.scrollLeft + restX, el.scrollWidth, el.clientWidth);
    const [loY, hiY] = _bereik(el.scrollTop + restY, el.scrollHeight, el.clientHeight);
    return { loX, hiX, loY, hiY };
  };
  return verschuif;
}

function _bereik(plek, totaal, zicht) {
  if (!Number.isFinite(totaal) || !Number.isFinite(zicht)) return [-Infinity, Infinity];
  return [-plek, Math.max(0, totaal - zicht) - plek];
}

// Schuif één as op. Geeft het niet-toegepaste breukdeel terug (rest) en of
// het element afkapte omdat het doel voorbij de rand lag (rand).
function _zetScroll(el, as, delta) {
  const doel = el[as] + delta;
  // Op een miljoenste afgerond schrijven: float-ruis in de som van de stappen
  // (400,0000000001 of 399,9999999999) mag bij afkappen of naar boven
  // afronden geen hele pixel schelen. De rest rekent met het exacte doel.
  el[as] = Math.round(doel * 1e6) / 1e6;
  const over = doel - el[as];
  const rand = Math.abs(over) >= 1;
  return { rest: rand ? 0 : over, rand };
}
