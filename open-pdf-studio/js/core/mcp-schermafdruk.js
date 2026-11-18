// Rekenregels van app_screenshot_view (#583), los van de DOM zodat ze onder
// node:test te toetsen zijn. De bridge (mcp-bridge.js) doet de DOM en het
// canvas; hier staat alleen welke invoer geldig is en welk stuk van de
// vensteropname in de PNG komt.
//
//   scope 'document'  de PDF-weergave met annotaties (zoals altijd, standaard)
//   scope 'window'    het hele venster: lint, panelen, statusbalk
//   scope 'element'   de vensteropname bijgesneden tot één element (selector)

export const SCOPES = Object.freeze(['document', 'window', 'element']);
export const STANDAARD_BREEDTE = 2000;

/**
 * Lees de argumenten van app_screenshot_view.
 * Zonder scope maar met een selector wordt het 'element'; zonder beide
 * 'document', zodat bestaande aanroepen niets merken.
 * @returns {{ scope: string, selector: string|null, width: number } | { error: string }}
 */
export function leesSchermafdrukArgumenten(params) {
  const p = params && typeof params === 'object' ? params : {};
  const width = Number(p.width) > 0 ? Number(p.width) : STANDAARD_BREEDTE;
  const heeftSelector = p.selector !== undefined && p.selector !== null;
  if (heeftSelector && (typeof p.selector !== 'string' || !p.selector.trim())) {
    return { error: 'selector must be a non-empty CSS selector' };
  }
  let scope = p.scope;
  if (scope === undefined || scope === null) scope = heeftSelector ? 'element' : 'document';
  if (!SCOPES.includes(scope)) {
    return { error: 'scope must be "document", "window" or "element"' };
  }
  if (scope === 'element' && !heeftSelector) {
    return { error: 'scope "element" needs a CSS selector' };
  }
  if (scope !== 'element' && heeftSelector) {
    return { error: `selector is only used with scope "element" (got scope "${scope}")` };
  }
  return { scope, selector: heeftSelector ? p.selector.trim() : null, width };
}

const isMaat = (v) => typeof v === 'number' && Number.isFinite(v);
const rond = (v) => Math.round(v * 100) / 100;

/**
 * Welk stuk van de vensteropname komt in de PNG, en hoe groot wordt die?
 *
 * `bounds` en `viewport` zijn CSS-pixels (getBoundingClientRect en
 * innerWidth/innerHeight); `beeld` is de opname in fysieke pixels. De schaal
 * volgt uit opname gedeeld door viewport, niet uit devicePixelRatio: zo klopt
 * de uitsnede ook als de opname een andere maat heeft dan verwacht.
 * Het gebied wordt eerst tot het venster beperkt; daarna past de langste kant
 * binnen `maxBreedte` (zoals bij scope 'document').
 *
 * @param {{ bounds: {x:number,y:number,width:number,height:number},
 *   viewport: {width:number,height:number}, beeld: {width:number,height:number},
 *   maxBreedte?: number }} invoer
 * @returns {{ sx:number, sy:number, sw:number, sh:number, outW:number, outH:number,
 *   bounds: {x:number,y:number,width:number,height:number}, schaal: {x:number,y:number} } | { error: string }}
 */
export function berekenUitsnede({ bounds, viewport, beeld, maxBreedte = STANDAARD_BREEDTE } = {}) {
  if (!viewport || !isMaat(viewport.width) || !isMaat(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    return { error: 'the window has no size' };
  }
  if (!beeld || !isMaat(beeld.width) || !isMaat(beeld.height) || beeld.width < 1 || beeld.height < 1) {
    return { error: 'the window capture is empty' };
  }
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(isMaat)) {
    return { error: 'invalid bounds' };
  }
  const x0 = Math.max(0, bounds.x);
  const y0 = Math.max(0, bounds.y);
  const x1 = Math.min(viewport.width, bounds.x + bounds.width);
  const y1 = Math.min(viewport.height, bounds.y + bounds.height);
  if (!(x1 - x0 > 0) || !(y1 - y0 > 0)) {
    return { error: 'the element has no visible area inside the window' };
  }
  const schaalX = beeld.width / viewport.width;
  const schaalY = beeld.height / viewport.height;
  // Naar buiten afronden, zodat een rand van het element niet wegvalt.
  const sx = Math.min(beeld.width - 1, Math.max(0, Math.floor(x0 * schaalX + 1e-6)));
  const sy = Math.min(beeld.height - 1, Math.max(0, Math.floor(y0 * schaalY + 1e-6)));
  const ex = Math.min(beeld.width, Math.max(sx + 1, Math.ceil(x1 * schaalX - 1e-6)));
  const ey = Math.min(beeld.height, Math.max(sy + 1, Math.ceil(y1 * schaalY - 1e-6)));
  const sw = ex - sx;
  const sh = ey - sy;
  const max = Number(maxBreedte) > 0 ? Number(maxBreedte) : STANDAARD_BREEDTE;
  const langste = Math.max(sw, sh);
  const factor = langste > max ? max / langste : 1;
  return {
    sx, sy, sw, sh,
    outW: Math.max(1, Math.round(sw * factor)),
    outH: Math.max(1, Math.round(sh * factor)),
    bounds: { x: rond(x0), y: rond(y0), width: rond(x1 - x0), height: rond(y1 - y0) },
    schaal: { x: schaalX, y: schaalY },
  };
}

/** Een DOMRect (of iets dat erop lijkt) als { x, y, width, height } in CSS-pixels. */
export function rechthoek(r) {
  return {
    x: rond(Number(r?.left ?? r?.x ?? 0)),
    y: rond(Number(r?.top ?? r?.y ?? 0)),
    width: rond(Number(r?.width ?? 0)),
    height: rond(Number(r?.height ?? 0)),
  };
}

/**
 * De lagen van één pagina in de volgorde waarin ze over het paginabeeld
 * getekend worden, met hun mengwijze. `lagen` beschrijft elk canvas met zijn
 * `id` en `klasse` (className). Het paginabeeld zelf (`pdf-canvas`) hoort er
 * niet bij (ook niet als het een uitsnede van de pagina is: dat tekent de
 * aanroeper zelf, op de achtergrond van de pagina). Volgorde: de markeerlaag
 * (vermenigvuldigen, zoals op het scherm), de annotatielaag en haar scherpe
 * tegels; onbekende lagen komen erna, in de volgorde waarin ze stonden.
 * @param {Array<{id?:string, klasse?:string}>} lagen
 * @returns {Array<{index:number, mengen:'multiply'|'source-over'}>}
 */
export function laagVolgorde(lagen) {
  const rang = (l) => {
    const naam = `${l?.id || ''} ${l?.klasse || ''}`;
    if (naam.includes('highlight')) return 1;
    if (naam.includes('annotation-canvas-sharp')) return 3;
    if (naam.includes('annotation-canvas')) return 2;
    return 4;
  };
  return (lagen || [])
    .map((l, index) => ({ index, rang: rang(l), mengen: rang(l) === 1 ? 'multiply' : 'source-over' }))
    .sort((a, b) => a.rang - b.rang || a.index - b.index)
    .map(({ index, mengen }) => ({ index, mengen }));
}

/**
 * Waar een laag in de uitvoer komt: haar plek ten opzichte van het
 * paginabeeld, geschaald naar de uitvoermaat. Een scherpe tegel dekt maar een
 * deel van de pagina; een volledige laag valt precies over het geheel.
 */
export function laagPlek(laag, basis, uit) {
  if (!laag || !basis || !(basis.width > 0) || !(basis.height > 0)) return { x: 0, y: 0, w: uit.width, h: uit.height };
  const sx = uit.width / basis.width;
  const sy = uit.height / basis.height;
  return {
    x: (laag.left - basis.left) * sx,
    y: (laag.top - basis.top) * sy,
    w: laag.width * sx,
    h: laag.height * sy,
  };
}
