/**
 * Symbool-SVG's van buiten de app (online bibliotheek, geimporteerde groepen,
 * catalogi, bewerkte symbooltypen) schoonmaken met een ALLOWLIST.
 *
 * De module parseert de tekst met een eigen, strikte XML-parser, houdt alleen
 * bekende tekenelementen en attributen over en schrijft de SVG daarna opnieuw
 * uit de geparseerde boom. Wat de app daarna toont of opslaat is dus nooit de
 * ruwe tekst, maar wat deze module zelf heeft uitgeschreven.
 *
 * Regels in het kort:
 *   - alleen bekende tekenelementen (svg, g, path, rect, ..., gradienten,
 *     clipPath, mask, pattern, marker, symbol, use); al het andere gaat er met
 *     de hele deelboom uit (script, foreignObject, animatie-elementen,
 *     elementen in een andere namespace, ...). <a> wordt uitgepakt: de
 *     kinderen blijven, de link verdwijnt;
 *   - alleen bekende opmaak- en geometrie-attributen, met een waardecontrole
 *     per soort; nooit on*-attributen, nooit een waarde die (na het oplossen
 *     van entiteiten en het weghalen van witruimte en stuurtekens) een
 *     URL-schema bevat zoals javascript:, data: of http:;
 *   - href/xlink:href alleen als verwijzing binnen het document (#id), en op
 *     <image> alleen een raster-data-URL of een afbeelding uit de eigen
 *     /assets/ van de app;
 *   - CSS (style-attribuut en <style>) alleen zonder at-regels, zonder
 *     backslash-escapes en met alleen bekende functies; url() alleen naar #id.
 *
 * Zuivere module zonder DOM, zodat hij onder node:test draait en in de app
 * precies dezelfde code loopt als in de tests.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

const MAX_LENGTE = 16 * 1024 * 1024;
const MAX_ELEMENTEN = 50000;
const MAX_DIEPTE = 200;

// --- Allowlists ---------------------------------------------------------------

const ELEMENTEN = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop',
  'clipPath', 'mask', 'pattern', 'marker',
  'style', 'image',
]);

// Uitgepakt: de kinderen blijven, het element zelf niet.
const UITPAKKEN = new Set(['a']);

// Elementen waarvan de tekstinhoud betekenis heeft.
const MET_TEKST = new Set(['text', 'tspan', 'title', 'desc', 'style']);
// Alleen tekst, geen kindelementen.
const ALLEEN_TEKST = new Set(['title', 'desc', 'style']);

// Elementen die met href naar een ander element in hetzelfde document mogen
// verwijzen.
const HREF_LOKAAL = new Set(['use', 'linearGradient', 'radialGradient', 'pattern']);

// Waardecontrole per soort. De algemene controle (schema's, url()) komt daar
// altijd nog bovenop.
const SOORT = {
  getal: /^[\w\s.,%+-]*$/,
  pad: /^[\w\s.,+-]*$/,
  transform: /^[\w\s.,()+-]*$/,
  verf: /^[\w\s.,()#%+'-]*$/,
  naam: /^[\w\s.:-]*$/,
  woord: /^[\w\s-]*$/,
  lettertype: /^[\w\s.,'\u00C0-\uFFFF-]*$/,
  tekst: /^[^<>"`\\]*$/,
};

const ATTRIBUTEN = new Map(Object.entries({
  // identiteit
  id: 'naam', class: 'naam', 'xml:space': 'woord',
  // geometrie
  x: 'getal', y: 'getal', x1: 'getal', y1: 'getal', x2: 'getal', y2: 'getal',
  cx: 'getal', cy: 'getal', r: 'getal', rx: 'getal', ry: 'getal',
  fx: 'getal', fy: 'getal', fr: 'getal', dx: 'getal', dy: 'getal',
  width: 'getal', height: 'getal', points: 'getal', d: 'pad', pathLength: 'getal',
  viewBox: 'getal', preserveAspectRatio: 'woord', version: 'getal', baseProfile: 'woord',
  transform: 'transform', gradientTransform: 'transform', patternTransform: 'transform',
  gradientUnits: 'woord', spreadMethod: 'woord', offset: 'getal',
  patternUnits: 'woord', patternContentUnits: 'woord', clipPathUnits: 'woord',
  maskUnits: 'woord', maskContentUnits: 'woord',
  markerWidth: 'getal', markerHeight: 'getal', markerUnits: 'woord',
  refX: 'getal', refY: 'getal', orient: 'getal',
  textLength: 'getal', lengthAdjust: 'woord', rotate: 'getal',
  // opmaak
  fill: 'verf', 'fill-opacity': 'getal', 'fill-rule': 'woord',
  stroke: 'verf', 'stroke-width': 'getal', 'stroke-linecap': 'woord', 'stroke-linejoin': 'woord',
  'stroke-miterlimit': 'getal', 'stroke-dasharray': 'getal', 'stroke-dashoffset': 'getal',
  'stroke-opacity': 'getal', opacity: 'getal', color: 'verf',
  'stop-color': 'verf', 'stop-opacity': 'getal',
  'clip-path': 'verf', 'clip-rule': 'woord', mask: 'verf',
  'marker-start': 'verf', 'marker-mid': 'verf', 'marker-end': 'verf',
  display: 'woord', visibility: 'woord', overflow: 'woord',
  'vector-effect': 'woord', 'shape-rendering': 'woord', 'text-rendering': 'woord',
  'image-rendering': 'woord', 'color-interpolation': 'woord', 'paint-order': 'woord',
  'mix-blend-mode': 'woord', isolation: 'woord',
  // tekst
  'font-family': 'lettertype', 'font-size': 'getal', 'font-weight': 'getal', 'font-style': 'woord',
  'font-variant': 'woord', 'font-stretch': 'getal', 'text-anchor': 'woord',
  'dominant-baseline': 'woord', 'alignment-baseline': 'woord', 'baseline-shift': 'getal',
  'letter-spacing': 'getal', 'word-spacing': 'getal', 'text-decoration': 'woord',
  'writing-mode': 'woord', direction: 'woord', 'unicode-bidi': 'woord',
  // css (eigen controle)
  style: 'css',
}));

const CSS_FUNCTIES = new Set([
  '', 'url', 'rgb', 'rgba', 'hsl', 'hsla', 'calc', 'var',
  'translate', 'translatex', 'translatey', 'rotate', 'scale', 'scalex', 'scaley',
  'matrix', 'skewx', 'skewy',
]);

// --- Hulpfuncties ---------------------------------------------------------------

class ParseFout extends Error {}
const fout = (reden) => { throw new ParseFout(reden); };

const isWit = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t';
const NAAM = /[A-Za-z_\u00C0-\uFFFF][\w.\-:\u00B7\u00C0-\uFFFF]*/y;

const VOORGEDEFINIEERD = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// Witruimte, stuurtekens en onzichtbare opmaaktekens weg: daarmee kan een
// schema als "java\tscript:" niet langs de controle glippen.
const ONZICHTBAAR = /[\u0000- \u007f-\u00A0\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028-\u202F\u205F-\u206F\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFF8]/g;
const normaliseer = (v) => String(v).replace(ONZICHTBAAR, '').toLowerCase();

// Een waarde die een URL-schema bevat of een url() die niet naar #id wijst.
const GEVAARLIJK = /(?:java|vb|live|ecma|j|mocha)script:|data:|expression\(|-moz-binding|behavior:|@import/;
const SCHEMA_BEGIN = /^[a-z][a-z0-9+.-]*:/;

function urlsLokaal(genormaliseerd) {
  let i = genormaliseerd.indexOf('url(');
  while (i >= 0) {
    let j = i + 4;
    if (genormaliseerd[j] === '"' || genormaliseerd[j] === "'") j++;
    if (genormaliseerd[j] !== '#') return false;
    i = genormaliseerd.indexOf('url(', j);
  }
  return true;
}

function waardeVeilig(waarde) {
  const n = normaliseer(waarde);
  if (GEVAARLIJK.test(n) || SCHEMA_BEGIN.test(n)) return false;
  return urlsLokaal(n);
}

/**
 * CSS (style-attribuut of <style>-inhoud) controleren. Geeft de CSS zonder
 * commentaar terug, of null als er iets in zit dat niet mag.
 */
function saneerCss(css) {
  const zonderCommentaar = String(css).replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (zonderCommentaar.includes('/*')) return null;
  if (/[\\<@`]/.test(zonderCommentaar)) return null;
  const n = normaliseer(zonderCommentaar);
  if (GEVAARLIJK.test(n) || /(?:java|vb)script|expression|behavior|binding/.test(n)) return null;
  for (const m of n.matchAll(/([a-z0-9-]*)\(/g)) {
    if (!CSS_FUNCTIES.has(m[1])) return null;
  }
  if (!urlsLokaal(n)) return null;
  return zonderCommentaar;
}

const LOKAAL_ID = /^#[\w.:\-\u00C0-\uFFFF]+$/;
const RASTER_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=\s]*$/i;
const ASSET_PAD = /^\/assets\/[\w\-./%]+\.(?:png|jpe?g|gif|webp|bmp|avif)$/i;

function standaardOorsprong() {
  try {
    const o = globalThis.location && globalThis.location.origin;
    return typeof o === 'string' && /^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/i.test(o) ? o : null;
  } catch { return null; }
}

function beeldHrefVeilig(waarde, oorsprong) {
  const v = String(waarde).trim();
  if (RASTER_DATA_URL.test(v)) return true;
  if (oorsprong && v.startsWith(oorsprong + '/')) {
    const pad = v.slice(oorsprong.length);
    return ASSET_PAD.test(pad) && !pad.includes('..');
  }
  return false;
}

function decodeer(tekst, ctx) {
  if (!tekst.includes('&')) return tekst;
  return tekst.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*)?;?/g, (m, e) => {
    if (!e || !m.endsWith(';')) { ctx.ruis = true; return m; }
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      const geldig = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return geldig ? String.fromCodePoint(code) : '\uFFFD';
    }
    if (Object.prototype.hasOwnProperty.call(VOORGEDEFINIEERD, e)) return VOORGEDEFINIEERD[e];
    // Onbekende entiteit: letterlijk laten staan (wordt bij het uitschrijven
    // als tekst ge-escaped).
    ctx.ruis = true;
    return m;
  });
}

const escTekst = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');

// --- Parser -------------------------------------------------------------------

function parseer(tekst, ctx) {
  let i = 0;
  const n = tekst.length;
  if (tekst.charCodeAt(0) === 0xfeff) i = 1;
  const document = { kinderen: [] };
  const stapel = [];
  let wortel = null;
  let aantal = 0;

  const huidig = () => (stapel.length ? stapel[stapel.length - 1] : document);
  const slaWitOver = () => { while (i < n && isWit(tekst[i])) i++; };
  const leesNaam = () => {
    NAAM.lastIndex = i;
    const m = NAAM.exec(tekst);
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };

  while (i < n) {
    if (tekst[i] !== '<') {
      const eind = tekst.indexOf('<', i);
      const ruw = tekst.slice(i, eind < 0 ? n : eind);
      i = eind < 0 ? n : eind;
      if (!stapel.length) {
        if (ruw.trim()) fout('tekst buiten het wortelelement');
        continue;
      }
      huidig().kinderen.push({ tekst: decodeer(ruw, ctx) });
      continue;
    }
    if (tekst.startsWith('<!--', i)) {
      const eind = tekst.indexOf('-->', i + 4);
      if (eind < 0) fout('commentaar niet afgesloten');
      i = eind + 3;
      continue;
    }
    if (tekst.startsWith('<![CDATA[', i)) {
      const eind = tekst.indexOf(']]>', i + 9);
      if (eind < 0 || !stapel.length) fout('ongeldige CDATA');
      huidig().kinderen.push({ tekst: tekst.slice(i + 9, eind) });
      i = eind + 3;
      continue;
    }
    if (tekst.startsWith('<?', i)) {
      const eind = tekst.indexOf('?>', i + 2);
      if (eind < 0) fout('verwerkingsinstructie niet afgesloten');
      // De XML-declaratie is neutraal; elke andere instructie (bv. een
      // stylesheet-koppeling) valt weg en telt als verwijderd.
      if (!/^<\?xml[\s?]/.test(tekst.slice(i, i + 6))) ctx.verwijderd.push('verwerkingsinstructie');
      i = eind + 2;
      continue;
    }
    if (tekst.startsWith('<!DOCTYPE', i)) {
      if (stapel.length || wortel) fout('doctype op een verkeerde plek');
      let j = i + 9;
      let quote = null;
      for (; j < n; j++) {
        const c = tekst[j];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '[') fout('doctype met eigen entiteiten');
        else if (c === '>') break;
      }
      if (j >= n) fout('doctype niet afgesloten');
      i = j + 1;
      continue;
    }
    if (tekst.startsWith('<!', i)) fout('onbekende declaratie');

    if (tekst[i + 1] === '/') {
      i += 2;
      const naam = leesNaam();
      if (!naam) fout('ongeldige sluittag');
      slaWitOver();
      if (tekst[i] !== '>') fout('ongeldige sluittag');
      i++;
      const open = stapel.pop();
      if (!open || open.qnaam !== naam) fout(`onverwachte </${naam}>`);
      continue;
    }

    // Openingstag
    i++;
    const qnaam = leesNaam();
    if (!qnaam) fout('ongeldige tag');
    if (!stapel.length && wortel) fout('meer dan een wortelelement');
    if (stapel.length >= MAX_DIEPTE) fout('te diep genest');
    if (++aantal > MAX_ELEMENTEN) fout('te veel elementen');

    const attributen = [];
    let zelfsluitend = false;
    for (;;) {
      const voor = i;
      slaWitOver();
      if (i >= n) fout('tag niet afgesloten');
      if (tekst.startsWith('/>', i)) { i += 2; zelfsluitend = true; break; }
      if (tekst[i] === '>') { i++; break; }
      if (i === voor) fout('attributen moeten door witruimte gescheiden zijn');
      const a = leesNaam();
      if (!a) fout('ongeldig attribuut');
      slaWitOver();
      if (tekst[i] !== '=') fout(`attribuut ${a} zonder waarde`);
      i++;
      slaWitOver();
      const quote = tekst[i];
      if (quote !== '"' && quote !== "'") fout(`attribuut ${a} zonder aanhalingstekens`);
      const eind = tekst.indexOf(quote, i + 1);
      if (eind < 0) fout('attribuutwaarde niet afgesloten');
      const ruw = tekst.slice(i + 1, eind);
      i = eind + 1;
      if (ruw.includes('<')) fout(`"<" in attribuut ${a}`);
      if (attributen.some((x) => x.qnaam === a)) fout(`dubbel attribuut ${a}`);
      // Attribuutwaarde-normalisatie zoals XML die doet.
      attributen.push({ qnaam: a, waarde: decodeer(ruw.replace(/[\t\n\r]/g, ' '), ctx) });
    }

    const ouder = stapel.length ? stapel[stapel.length - 1] : null;
    const nsKaart = Object.create(ouder ? ouder.nsKaart : null);
    if (!ouder) { nsKaart.xml = XML_NS; nsKaart[''] = null; }
    for (const a of attributen) {
      if (a.qnaam === 'xmlns') nsKaart[''] = a.waarde || null;
      else if (a.qnaam.startsWith('xmlns:')) nsKaart[a.qnaam.slice(6)] = a.waarde || undefined;
    }
    const dp = qnaam.indexOf(':');
    const prefix = dp >= 0 ? qnaam.slice(0, dp) : '';
    const lokaal = dp >= 0 ? qnaam.slice(dp + 1) : qnaam;
    const element = {
      qnaam, prefix, lokaal,
      ns: nsKaart[prefix],
      nsKaart, attributen, zelfsluitend, kinderen: [],
    };
    huidig().kinderen.push(element);
    if (!ouder) wortel = element;
    if (!zelfsluitend) stapel.push(element);
  }
  if (stapel.length) fout(`<${stapel[stapel.length - 1].qnaam}> niet afgesloten`);
  if (!wortel) fout('geen wortelelement');
  return wortel;
}

// --- Uitschrijven ---------------------------------------------------------------

function attribuutSleutel(el, a) {
  const dp = a.qnaam.indexOf(':');
  if (dp < 0) return a.qnaam;
  const prefix = a.qnaam.slice(0, dp);
  const lokaal = a.qnaam.slice(dp + 1);
  // xlink: zonder declaratie werkt in HTML ook; daarom die prefix toestaan.
  const ns = prefix === 'xlink' && el.nsKaart.xlink === undefined ? XLINK_NS : el.nsKaart[prefix];
  if (ns === XLINK_NS) return 'xlink:' + lokaal;
  if (ns === XML_NS) return 'xml:' + lokaal;
  return null;
}

function schrijfAttributen(el, ctx, isWortel) {
  const uit = [];
  for (const a of el.attributen) {
    const q = a.qnaam;
    if (q === 'xmlns' || q.startsWith('xmlns:')) {
      if (q === 'xmlns' && a.waarde === SVG_NS) uit.push(` xmlns="${SVG_NS}"`);
      else if (q === 'xmlns:xlink' && a.waarde === XLINK_NS) { uit.push(` xmlns:xlink="${XLINK_NS}"`); if (isWortel) ctx.xlinkGedeclareerd = true; }
      // Andere declaraties (editor-metadata, eigen prefixen) zijn niet nodig:
      // de uitvoer gebruikt alleen namen zonder prefix.
      continue;
    }
    const sleutel = attribuutSleutel(el, a);
    if (!sleutel) { ctx.verwijderd.push(`@${q}`); continue; }
    const waarde = a.waarde;

    if (sleutel === 'href' || sleutel === 'xlink:href') {
      const ok = el.lokaal === 'image'
        ? beeldHrefVeilig(waarde, ctx.oorsprong)
        : HREF_LOKAAL.has(el.lokaal) && LOKAAL_ID.test(waarde.trim());
      if (!ok) { ctx.verwijderd.push(`@${q}`); continue; }
      if (sleutel === 'xlink:href') ctx.xlinkGebruikt = true;
      uit.push(` ${sleutel}="${escAttr(waarde.trim())}"`);
      continue;
    }

    const soort = ATTRIBUTEN.get(sleutel);
    if (!soort) { ctx.verwijderd.push(`@${q}`); continue; }
    if (soort === 'css') {
      const css = saneerCss(waarde);
      if (css === null) { ctx.verwijderd.push(`@${q}`); continue; }
      uit.push(` style="${escAttr(css)}"`);
      continue;
    }
    if (!SOORT[soort].test(waarde) || !waardeVeilig(waarde)) { ctx.verwijderd.push(`@${q}`); continue; }
    uit.push(` ${sleutel}="${escAttr(waarde)}"`);
  }
  return uit.join('');
}

function heeftGeldigeHref(el, ctx) {
  for (const a of el.attributen) {
    const s = attribuutSleutel(el, a);
    if (s !== 'href' && s !== 'xlink:href') continue;
    return el.lokaal === 'image' ? beeldHrefVeilig(a.waarde, ctx.oorsprong) : LOKAAL_ID.test(a.waarde.trim());
  }
  return false;
}

function schrijfKinderen(el, ctx) {
  let uit = '';
  for (const k of el.kinderen) {
    if (k.tekst !== undefined) {
      if (MET_TEKST.has(el.lokaal)) uit += escTekst(k.tekst);
      else if (!k.tekst.trim()) uit += k.tekst;
      // Losse tekst in een vorm- of groepselement heeft geen betekenis.
      continue;
    }
    if (ALLEEN_TEKST.has(el.lokaal)) { ctx.verwijderd.push(`<${k.qnaam}>`); continue; }
    uit += schrijfElement(k, ctx);
  }
  return uit;
}

function schrijfElement(el, ctx) {
  if (el.ns !== SVG_NS && el.ns !== null) { ctx.verwijderd.push(`<${el.qnaam}>`); return ''; }
  if (UITPAKKEN.has(el.lokaal)) { ctx.verwijderd.push(`<${el.qnaam}>`); return schrijfKinderen(el, ctx); }
  if (!ELEMENTEN.has(el.lokaal)) { ctx.verwijderd.push(`<${el.qnaam}>`); return ''; }

  if (el.lokaal === 'style') {
    if (ctx.zonderStijl) { ctx.verwijderd.push('<style>'); return ''; }
    if (el.kinderen.some((k) => k.tekst === undefined)) { ctx.verwijderd.push('<style>'); return ''; }
    const css = saneerCss(el.kinderen.map((k) => k.tekst).join(''));
    if (css === null) { ctx.verwijderd.push('<style>'); return ''; }
    const attr = schrijfAttributen({ ...el, attributen: el.attributen.filter((a) => a.qnaam !== 'type' && a.qnaam !== 'media') }, ctx, false);
    return `<style${attr}>${escTekst(css)}</style>`;
  }
  if ((el.lokaal === 'use' || el.lokaal === 'image') && !heeftGeldigeHref(el, ctx)) {
    ctx.verwijderd.push(`<${el.qnaam}>`);
    return '';
  }

  const attr = schrijfAttributen(el, ctx, false);
  const binnen = schrijfKinderen(el, ctx);
  if (!binnen && el.zelfsluitend) return `<${el.lokaal}${attr}/>`;
  return `<${el.lokaal}${attr}>${binnen}</${el.lokaal}>`;
}

/**
 * Maak een SVG schoon en geef ook terug wat er is weggehaald.
 * @param {string} tekst
 * @param {{ zonderStijl?: boolean, beeldOorsprong?: string|null }} [opties]
 *   zonderStijl: ook <style>-elementen weghalen (voor SVG die rechtstreeks in
 *   de pagina komt, waar een <style> de hele app zou opmaken);
 *   beeldOorsprong: oorsprong waarvan /assets/-afbeeldingen mogen komen
 *   (standaard de oorsprong van de app zelf).
 * @returns {{ svg: string|null, verwijderd: string[], reden?: string }}
 */
export function saneerSvgDetail(tekst, opties = {}) {
  if (typeof tekst !== 'string' || !tekst.trim()) return { svg: null, verwijderd: [], reden: 'geen tekst' };
  if (tekst.length > MAX_LENGTE) return { svg: null, verwijderd: [], reden: 'te groot' };
  const ctx = {
    verwijderd: [],
    ruis: false,
    zonderStijl: opties.zonderStijl === true,
    oorsprong: opties.beeldOorsprong !== undefined ? opties.beeldOorsprong : standaardOorsprong(),
    xlinkGebruikt: false,
    xlinkGedeclareerd: false,
  };
  let wortel;
  try {
    wortel = parseer(tekst, ctx);
  } catch (e) {
    if (e instanceof ParseFout) return { svg: null, verwijderd: [], reden: e.message };
    throw e;
  }
  if (wortel.lokaal !== 'svg' || (wortel.ns !== SVG_NS && wortel.ns !== null)) {
    return { svg: null, verwijderd: [], reden: 'het wortelelement is geen <svg>' };
  }
  const attr = schrijfAttributen(wortel, ctx, true);
  const binnen = schrijfKinderen(wortel, ctx);
  const xlink = ctx.xlinkGebruikt && !ctx.xlinkGedeclareerd ? ` xmlns:xlink="${XLINK_NS}"` : '';
  const svg = !binnen && wortel.zelfsluitend
    ? `<svg${attr}${xlink}/>`
    : `<svg${attr}${xlink}>${binnen}</svg>`;
  return { svg, verwijderd: ctx.verwijderd };
}

/**
 * Maak een SVG schoon. Geeft de opnieuw uitgeschreven SVG, of null als de
 * tekst geen goedgevormde SVG is.
 * @param {string} tekst
 * @param {{ zonderStijl?: boolean, beeldOorsprong?: string|null }} [opties]
 * @returns {string|null}
 */
export function saneerSvg(tekst, opties) {
  return saneerSvgDetail(tekst, opties).svg;
}

/**
 * Data-URL van een (al schoongemaakte) SVG, voor weergave in een <img>: daar
 * draait nooit een script, wat er ook in de SVG staat.
 * @param {string} svg
 */
export function svgAlsDataUrl(svg) {
  let s = String(svg);
  const kop = /^<svg\b[^>]*>/.exec(s);
  if (kop && !/\sxmlns\s*=/.test(kop[0])) s = `<svg xmlns="${SVG_NS}"` + s.slice(4);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

/**
 * Een lijst symbolen ({ svg, ... }) schoonmaken: symbolen waarvan de SVG
 * onbruikbaar is vallen weg. Symbolen zonder svg (bv. alleen parametrisch)
 * blijven ongemoeid.
 * @returns {{ symbolen: object[], gewijzigd: boolean }}
 */
export function saneerSymbolen(symbolen, opties) {
  if (!Array.isArray(symbolen)) return { symbolen: [], gewijzigd: symbolen != null };
  let gewijzigd = false;
  const uit = [];
  for (const s of symbolen) {
    if (!s || typeof s !== 'object') { gewijzigd = true; continue; }
    if (s.svg == null) { uit.push(s); continue; }
    const schoon = saneerSvg(s.svg, opties);
    if (schoon === null) { gewijzigd = true; continue; }
    if (schoon !== s.svg) { gewijzigd = true; uit.push({ ...s, svg: schoon }); } else uit.push(s);
  }
  return { symbolen: uit, gewijzigd };
}

/**
 * Opgeslagen symboolgroepen (voorkeuren) schoonmaken.
 * @returns {{ groepen: object[], gewijzigd: boolean }}
 */
export function saneerSymboolGroepen(groepen, opties) {
  if (!Array.isArray(groepen)) return { groepen: [], gewijzigd: groepen != null };
  let gewijzigd = false;
  const uit = groepen.map((g) => {
    if (!g || typeof g !== 'object') return g;
    const r = saneerSymbolen(g.symbols, opties);
    if (!r.gewijzigd) return g;
    gewijzigd = true;
    return { ...g, symbols: r.symbolen };
  });
  return { groepen: uit, gewijzigd };
}

/**
 * Opgeslagen bewerkte symbooltypen ({ sleutel: { svg, name } }) schoonmaken.
 * @returns {{ overrides: object, gewijzigd: boolean }}
 */
export function saneerTypeOverrides(overrides, opties) {
  if (!overrides || typeof overrides !== 'object') return { overrides: {}, gewijzigd: overrides != null };
  let gewijzigd = false;
  const uit = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (!v || typeof v !== 'object' || typeof v.svg !== 'string') { gewijzigd = true; continue; }
    const schoon = saneerSvg(v.svg, opties);
    if (schoon === null) { gewijzigd = true; continue; }
    if (schoon !== v.svg) gewijzigd = true;
    uit[k] = schoon === v.svg ? v : { ...v, svg: schoon };
  }
  return { overrides: uit, gewijzigd };
}
