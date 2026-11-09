// Een link van de app (#953) via MCP: app_create_annotation met type 'link'.
// Puur (geen DOM of app-state): mcp-bridge.js roept het aan, de tests ook.
//
// props:
//   uri                     webadres (http, https, mailto, tel, ftp), of
//   page                    doelpagina in dit document (1-gebaseerd); de
//                           annotatie zelf komt op de `page` naast props
//   view                    bij page: 'XYZ' (standaard, bovenkant van de
//                           pagina) of 'Fit', of { type: 'XYZ', left, top, zoom }
//                           met left/top in PDF-punten
//   x, y, width, height     het klikvak (paginacoördinaten op 100%), of
//   quads                   [[{x,y} x4], ...] per tekstregel (linksboven,
//                           rechtsboven, linksonder, rechtsonder), zoals bij
//                           textHighlight: de regels worden /QuadPoints
//   border                  'none' (standaard) | 'solid' | 'underline'
//   color, lineWidth        kleur en dikte van de zichtbare rand
//
// Dezelfde velden als een link uit het venster (link-model.js nieuweLinkVelden).

import { nieuweLinkVelden, vakUitRegels, normaliseerDoel, LINK_RANDEN } from './link-model.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);

/** Wat de bouwer vastzet: invoer die geen veld van de link is, valt weg. */
export const LINK_MCP_VASTE_VELDEN = Object.freeze([
  'x', 'y', 'width', 'height', 'rects', 'linkTarget', 'linkBorder', 'linkHighlight',
  'color', 'strokeColor', 'lineWidth',
  'uri', 'view', 'quads', 'border', 'left', 'top', 'zoom',
]);

/** Het doel uit props.uri of props.page (+ view). */
export function linkDoelUitMcp(p, aantalPaginas) {
  const heeftUri = p.uri !== undefined && p.uri !== null;
  const heeftPagina = p.page !== undefined && p.page !== null;
  if (heeftUri === heeftPagina) {
    return { error: "type 'link' requires exactly one of props.uri (web address) or props.page (target page in this document)" };
  }
  if (heeftUri) {
    const doel = normaliseerDoel({ kind: 'uri', uri: p.uri });
    return doel ? { doel } : { error: `type 'link': props.uri is not a usable web address (http, https, mailto, tel, ftp): ${JSON.stringify(p.uri)}` };
  }
  const page = Number(p.page);
  if (!Number.isInteger(page) || page < 1 || page > aantalPaginas) {
    return { error: `type 'link': props.page ${JSON.stringify(p.page)} out of range (doc has ${aantalPaginas} pages)` };
  }
  const view = p.view;
  const soort = String((view && typeof view === 'object' ? view.type : view) ?? 'XYZ').toUpperCase();
  if (soort !== 'XYZ' && soort !== 'FIT') {
    return { error: "type 'link': props.view must be 'XYZ', 'Fit' or { type: 'XYZ', left, top, zoom }" };
  }
  const v = view && typeof view === 'object' ? view : {};
  const doel = normaliseerDoel(soort === 'FIT'
    ? { kind: 'page', page, fit: 'fit' }
    : {
      kind: 'page', page, fit: 'xyz',
      left: isGetal(v.left) ? v.left : null,
      top: isGetal(v.top) ? v.top : null,
      zoom: isGetal(v.zoom) && v.zoom > 0 ? v.zoom : null,
    }, aantalPaginas);
  return doel ? { doel } : { error: `type 'link': invalid page target` };
}

/** Het klikvak (en de regels) uit props.quads of x/y/width/height. */
export function linkVakUitMcp(p) {
  if (p.quads !== undefined) {
    const goed = Array.isArray(p.quads) && p.quads.length > 0 && p.quads.every((q) => Array.isArray(q) && q.length === 4
      && q.every((pt) => pt && isGetal(pt.x) && isGetal(pt.y)));
    if (!goed) return { error: "type 'link': props.quads must be [[{x,y} x4], ...] (upper left, upper right, lower left, lower right)" };
    const regels = p.quads.map((q) => {
      const xs = q.map((pt) => pt.x);
      const ys = q.map((pt) => pt.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    });
    const vak = vakUitRegels(regels);
    return vak ? { vak } : { error: "type 'link': props.quads must span an area" };
  }
  if (isGetal(p.x) && isGetal(p.y) && isGetal(p.width) && isGetal(p.height) && p.width > 0 && p.height > 0) {
    return { vak: { x: p.x, y: p.y, width: p.width, height: p.height } };
  }
  return { error: "type 'link' requires props.quads or numeric props x, y, width > 0, height > 0" };
}

/**
 * De velden van een nieuwe link uit MCP-props, of { error }.
 * @param {object} p  props van app_create_annotation
 * @param {number} placementPage  de pagina waarop de link komt
 * @param {number} aantalPaginas
 */
export function linkUitMcp(p, placementPage, aantalPaginas) {
  const props = p || {};
  const d = linkDoelUitMcp(props, aantalPaginas);
  if (d.error) return d;
  const v = linkVakUitMcp(props);
  if (v.error) return v;
  if (props.border !== undefined && !LINK_RANDEN.includes(props.border)) {
    return { error: `type 'link': props.border must be one of ${LINK_RANDEN.join(', ')}` };
  }
  const dikte = isGetal(props.lineWidth) && props.lineWidth > 0 ? props.lineWidth : 1;
  const velden = nieuweLinkVelden({
    page: placementPage, vak: v.vak, doel: d.doel, rand: props.border || 'none',
    kleur: typeof props.color === 'string' && props.color ? props.color : undefined, dikte,
  });
  return { base: velden };
}
