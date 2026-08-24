// Symboolbeelden voor component-in-cel (systeemraster/-plafond).
//
// Slaat per symbolId een HTMLImage op, geladen uit de symbolenbibliotheek
// (NEN 1414 + NL-IFC-palette). Synchronen API voor de tekenroutine:
// getSysteemSymbolImage() geeft het beeld zodra het geladen is en start de
// lading anders op de achtergrond; ná het laden wordt de geregistreerde
// redraw aangeroepen zodat de placeholder vanzelf door het echte symbool
// vervangen wordt.
//
// NEN 1414-symbolen zijn SVG-wrappers om een PNG (<image href>): een
// data-/blob-SVG mag als afbeelding geen EXTERNE resources laden, dus we
// laden dan de PNG-href rechtstreeks. Zelfstandige (vector-)SVG's gaan via
// een blob-URL.
import { NEN1414_CATEGORIES } from '../../solid/data/nen1414Library.js';
import { NL_CATEGORIES } from '../../solid/data/nlSymbolLibrary.js';

let _redraw = null;
let _redrawPending = false;

/** Registreer de redraw die na het laden van een symboolbeeld moet lopen. */
export function registerSysteemSymbolRedraw(fn) {
  _redraw = typeof fn === 'function' ? fn : null;
}

function _notify() {
  if (!_redraw || _redrawPending) return;
  _redrawPending = true;
  requestAnimationFrame(() => {
    _redrawPending = false;
    try { _redraw(); } catch (_) { /* redraw optioneel */ }
  });
}

/** Vind een symbool (id, naam, svg) in de bibliotheken, of null. */
export function findSysteemSymbol(symbolId) {
  if (!symbolId) return null;
  for (const cat of NEN1414_CATEGORIES) {
    const s = (cat.symbols || []).find(x => x.id === symbolId);
    if (s) return { id: s.id, name: s.name, svg: s.svg };
  }
  for (const cat of NL_CATEGORIES) {
    const s = (cat.symbols || []).find(x => x.id === symbolId && x.svg);
    if (s) return { id: s.id, name: s.name, svg: s.svg };
  }
  return null;
}

/** Platte lijst kiesbare symbolen voor de component-kiezer. */
export function systeemSymbolList() {
  const out = [];
  for (const cat of NEN1414_CATEGORIES) {
    for (const s of cat.symbols || []) {
      out.push({ id: s.id, name: s.name, svg: s.svg, categorie: cat.name });
    }
  }
  return out;
}

const _cache = new Map(); // symbolId → { img, ready }

/**
 * Beeld voor een symbool: HTMLImage zodra geladen, anders null (de
 * tekenroutine tekent dan de placeholder; na het laden volgt een redraw).
 */
export function getSysteemSymbolImage(symbolId) {
  let e = _cache.get(symbolId);
  if (e) return e.ready && e.img && e.img.naturalWidth > 0 ? e.img : null;
  const sym = findSysteemSymbol(symbolId);
  if (!sym || !sym.svg) {
    _cache.set(symbolId, { img: null, ready: true });
    return null;
  }
  const img = new Image();
  e = { img, ready: false };
  _cache.set(symbolId, e);
  img.onload = () => { e.ready = true; _notify(); };
  img.onerror = () => { e.img = null; e.ready = true; };
  const href = sym.svg.match(/<image[^>]*href="([^"]+)"/i);
  if (href) {
    img.src = href[1];
  } else {
    img.src = URL.createObjectURL(new Blob([sym.svg], { type: 'image/svg+xml' }));
  }
  return null;
}
