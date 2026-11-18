// Getal slepen (#1168): klik en sleep op een getalveld of op zijn label om
// de waarde te veranderen, zoals andere grafische programma's dat bieden.
//
// Eén keer gebouwd voor alle getalvelden (ui/getal-veld.js). Een veld doet
// mee als het in een gebied met het kenmerk data-getal-sleep staat (het
// eigenschappenpaneel); data-getal-sleep="uit" sluit een veld of deelgebied
// weer uit.
//
// - Slepen begint op het LABEL van het veld, of op het veld zelf zolang het
//   geen focus heeft, na 4 px beweging. Een gewone klik op het veld geeft
//   het focus (alles geselecteerd, klaar om te typen); in een veld met focus
//   blijft slepen gewoon tekst selecteren.
// - Naar rechts en omhoog is meer; de as met de grootste beweging wint.
//   Shift is tien keer sneller, Alt of Ctrl tien keer fijner. De stap komt
//   van data-step, anders step, anders de precisie van de waarde; min en
//   max (of data-min, data-max) en data-geheel (alleen hele getallen) gelden. Zie core/getal-slepen.js.
// - De waarde gaat tijdens het slepen via dezelfde weg als typen (een
//   input-event), bij loslaten volgt change. Escape zet de beginwaarde
//   terug. begin/einde laten de app er één ongedaan-stap van maken.
// - Alleen muis en pen: een vinger op een veld blijft het paneel schuiven.
// - Een leeg veld (ook "gemengd" bij een meervoudige selectie) sleept niet:
//   er is geen waarde om van uit te gaan.
// - De aanwijzer blijft de gewone pijl; het label zegt in zijn tooltip dat
//   er gesleept kan worden.

import { leesGetal, normaliseerGetalTekst, toonGetal } from '../core/getal-invoer.js';
import {
  kiesAs, sleepPixels, stapVoorVeld, beginSleep, sleepNaar, aantalDecimalen,
} from '../core/getal-slepen.js';
import { ontleedVoetInch, formatVoetInch, formatInchBreuk, lengteNotatie } from '../core/voet-inch.js';

const VELD = 'input[data-getal]';
const GEBIED = '[data-getal-sleep]';
const BEDIENING = 'input, select, textarea';
const HINT_KENMERK = 'data-getal-sleep-hint';

/** Het getalveld bij een label: zijn eigen veld, of het eerste veld erna. */
export function veldBijLabel(label) {
  const eigen = label.control;
  if (eigen) return eigen.matches?.(VELD) ? eigen : null;
  for (let n = label.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.tagName === 'LABEL') return null;
    const eerste = n.matches?.(BEDIENING) ? n : n.querySelector?.(BEDIENING);
    if (eerste) return eerste.matches?.(VELD) ? eerste : null;
  }
  return null;
}

/** Mag er op dit veld gesleept worden? */
export function sleeptMee(el) {
  if (!el?.matches?.(VELD) || el.disabled || el.readOnly) return false;
  const gebied = el.closest?.(GEBIED);
  return !!gebied && gebied.getAttribute('data-getal-sleep') !== 'uit';
}

/**
 * @param {Document} doc
 * @param {object} api
 * @param {(el: Element) => string} api.leesTekst  de tekst zoals het veld hem toont
 * @param {(el: Element, tekst: string) => void} api.schrijfTekst  zet die tekst
 * @param {() => string} [api.taal]  taal voor het decimaalteken
 * @param {() => string} [api.hint]  tooltip voor het label ("Sleep om te wijzigen")
 * @param {(veld: Element) => void} [api.begin]  een sleep begint
 * @param {(info: {veld: Element, geannuleerd: boolean}) => void} [api.einde]  een sleep is klaar
 */
export function installeerGetalSlepen(doc, api) {
  const win = doc.defaultView;
  const Ev = win?.Event ?? globalThis.Event;
  /** Ingedrukt, nog geen sleep: {veld, vang, opVeld, id, x, y}. */
  let kandidaat = null;
  /** De lopende sleep. */
  let sleep = null;
  /** De klik die op een sleep volgt, hoort bij de sleep. */
  let slikKlik = false;

  function leesVeld(el) {
    const tekst = String(api.leesTekst(el) ?? '');
    const taal = api.taal?.();
    // data-min/data-max: grenzen die alleen voor het slepen gelden (een veld
    // dat zijn grenzen zelf bewaakt en de pijltoetsen wil laten zoals ze zijn).
    const minAttr = el.getAttribute('data-min') ?? el.getAttribute('min');
    const maxAttr = el.getAttribute('data-max') ?? el.getAttribute('max');
    if (el.getAttribute('data-getal') === 'lengte') {
      // Een voet-inchmaat sleept in inches: een inch per stap, de kleinste
      // breuk met Alt/Ctrl, een voet met Shift.
      const maat = ontleedVoetInch(tekst.trim());
      if (maat) {
        const breuk = 1 / lengteNotatie().precisie;
        return {
          toestand: beginSleep({
            waarde: maat.inches, stap: 1, fijneStap: breuk, groveStap: 12,
            min: minAttr != null && !(leesGetal(minAttr) < 0) ? breuk : null,
          }),
          toon: (n) => (maat.metVoet ? formatVoetInch(n, 'in') : formatInchBreuk(n, 'in')),
        };
      }
    }
    const waarde = leesGetal(tekst);
    if (!Number.isFinite(waarde)) return null;
    const geheel = el.hasAttribute('data-geheel') || el.getAttribute('inputmode') === 'numeric';
    const stap = stapVoorVeld({
      sleepStap: leesGetal(el.getAttribute('data-step') ?? ''),
      stap: leesGetal(el.getAttribute('step') ?? ''),
      waarde,
      decimalen: aantalDecimalen(normaliseerGetalTekst(tekst)),
      geheel,
    });
    return {
      toestand: beginSleep({ waarde, stap, min: leesGetal(minAttr ?? ''), max: leesGetal(maxAttr ?? ''), geheel }),
      toon: (n) => toonGetal(n, taal),
    };
  }

  function stuur(el, type) {
    el.dispatchEvent(new Ev(type, { bubbles: true }));
  }

  function zet(el, tekst) {
    api.schrijfTekst(el, tekst);
    stuur(el, 'input');
  }

  function start(as) {
    const k = kandidaat;
    kandidaat = null;
    const gelezen = sleeptMee(k.veld) ? leesVeld(k.veld) : null;
    if (!gelezen) return;
    sleep = {
      ...k, as, ...gelezen,
      beginTekst: String(api.leesTekst(k.veld) ?? ''),
      tekst: null,
    };
    slikKlik = true;
    try { k.vang.setPointerCapture?.(k.id); } catch { /* aanwijzer al weg */ }
    try { win?.getSelection?.()?.removeAllRanges?.(); } catch { /* geen selectie */ }
    k.veld.setAttribute('data-getal-slepend', '');
    try { api.begin?.(k.veld); } catch (err) { console.error(err); }
  }

  function beweeg(e) {
    const s = sleep;
    const pixels = sleepPixels(s.as, e.clientX - s.x, e.clientY - s.y);
    s.toestand = sleepNaar(s.toestand, pixels, { shift: !!e.shiftKey, fijn: !!(e.altKey || e.ctrlKey || e.metaKey) });
    const tekst = s.toon(s.toestand.waarde);
    if (tekst === (s.tekst ?? s.beginTekst)) return;
    s.tekst = tekst;
    zet(s.veld, tekst);
  }

  function eindig(bevestig) {
    const s = sleep;
    if (!s) return;
    sleep = null;
    try { s.vang.releasePointerCapture?.(s.id); } catch { /* al losgelaten */ }
    s.veld.removeAttribute?.('data-getal-slepend');
    const gewijzigd = s.tekst != null;
    if (s.veld.isConnected !== false && gewijzigd) {
      if (bevestig) stuur(s.veld, 'change');
      else zet(s.veld, s.beginTekst);
    }
    try { api.einde?.({ veld: s.veld, geannuleerd: !bevestig }); } catch (err) { console.error(err); }
  }

  doc.addEventListener('pointerdown', (e) => {
    slikKlik = false;
    // Een nieuwe druk ruimt op wat een gemist loslaten liet staan.
    kandidaat = null;
    if (sleep) { if (e.pointerId === sleep.id) eindig(true); else return; }
    if (e.button !== 0 || e.isPrimary === false) return;
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    const doel = e.target;
    if (!doel?.closest) return;
    let veld = null;
    let vang = null;
    let opVeld = false;
    if (doel.matches?.(VELD)) {
      // In een veld met focus is slepen tekst selecteren.
      if (doc.activeElement === doel) return;
      veld = doel; vang = doel; opVeld = true;
    } else {
      const label = doel.closest('label');
      // Een vinkje of keuzelijst binnen het label houdt zijn eigen klik.
      if (!label || doel.closest('input, select, textarea, button, a')) return;
      veld = veldBijLabel(label); vang = label;
    }
    if (!sleeptMee(veld) || !leesVeld(veld)) return;
    kandidaat = { veld, vang, opVeld, id: e.pointerId, x: e.clientX, y: e.clientY };
  }, true);

  // Op het veld zelf: het indrukken geeft nog geen focus (anders begint de
  // browser tekst te selecteren); dat volgt bij loslaten zonder sleep. Wat
  // focus had, raakt het wel kwijt, zoals bij elke klik ergens anders.
  doc.addEventListener('mousedown', (e) => {
    if (!kandidaat?.opVeld || e.button !== 0 || e.target !== kandidaat.veld) return;
    e.preventDefault();
    const actief = doc.activeElement;
    if (actief && actief !== doc.body && actief !== kandidaat.veld) actief.blur?.();
  }, true);

  doc.addEventListener('pointermove', (e) => {
    if (sleep) {
      if (e.pointerId !== sleep.id) return;
      // Het veld is weg, of de knop is buiten het venster losgelaten.
      if (sleep.veld.isConnected === false || e.buttons === 0) { eindig(true); return; }
      e.preventDefault();
      beweeg(e);
      return;
    }
    if (!kandidaat || e.pointerId !== kandidaat.id) return;
    if (e.buttons === 0) { kandidaat = null; return; }
    const as = kiesAs(e.clientX - kandidaat.x, e.clientY - kandidaat.y);
    if (!as) return;
    start(as);
    if (sleep) beweeg(e);
  }, true);

  doc.addEventListener('pointerup', (e) => {
    if (sleep) {
      if (e.pointerId === sleep.id) eindig(true);
      return;
    }
    if (!kandidaat || e.pointerId !== kandidaat.id) return;
    const k = kandidaat;
    kandidaat = null;
    // Gewone klik op het veld: focus, alles geselecteerd, klaar om te typen.
    if (k.opVeld && k.veld.isConnected !== false && !k.veld.disabled) {
      k.veld.focus?.();
      k.veld.select?.();
    }
  }, true);

  const breekAf = (e) => {
    if (sleep && (e.pointerId == null || e.pointerId === sleep.id)) eindig(true);
    if (kandidaat && (e.pointerId == null || e.pointerId === kandidaat.id)) kandidaat = null;
  };
  doc.addEventListener('pointercancel', breekAf, true);
  doc.addEventListener('lostpointercapture', (e) => {
    if (sleep && e.pointerId === sleep.id) eindig(true);
  }, true);
  win?.addEventListener?.('blur', breekAf);

  // Tekst selecteren hoort niet bij een sleep vanaf een label.
  doc.addEventListener('selectstart', (e) => {
    if (sleep || (kandidaat && !kandidaat.opVeld)) e.preventDefault();
  }, true);

  // De klik na het loslaten zou via het label het veld focus geven.
  doc.addEventListener('click', (e) => {
    if (!slikKlik) return;
    slikKlik = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // Escape zet de beginwaarde terug; de toetsen van de sleep (Shift, Alt,
  // Ctrl) doen tijdens het slepen niets anders (Alt opent geen menu).
  const SLEEPTOETSEN = new Set(['Shift', 'Alt', 'Control', 'Meta']);
  const toets = (e) => {
    if (!sleep) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'keydown') eindig(false);
    } else if (SLEEPTOETSEN.has(e.key)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const toetsDoel = win?.addEventListener ? win : doc;
  toetsDoel.addEventListener('keydown', toets, true);
  toetsDoel.addEventListener('keyup', toets, true);

  // Vindbaarheid zonder andere aanwijzer: de tooltip van het label.
  doc.addEventListener('pointerover', (e) => {
    const label = e.target?.closest?.('label');
    if (!label || typeof api.hint !== 'function') return;
    const eigen = label.hasAttribute(HINT_KENMERK);
    if (label.getAttribute('title') && !eigen) return;
    if (sleeptMee(veldBijLabel(label))) {
      const tekst = api.hint();
      if (tekst && label.getAttribute('title') !== tekst) label.setAttribute('title', tekst);
      if (tekst && !eigen) label.setAttribute(HINT_KENMERK, '');
    } else if (eigen) {
      label.removeAttribute('title');
      label.removeAttribute(HINT_KENMERK);
    }
  });

  return { isBezig: () => !!sleep };
}
