// De app als gereedschap voor een assistent buiten de app (de OpenAEC-werkplek).
//
// In de werkplek zet de app `window.__OPDS_APP__` neer: `tools()`, `run(naam,
// argumenten)` en `stand()`. De brug van de werkplek (in hetzelfde frame) roept
// `run` aan voor een opdracht van de gastpagina; de assistent van de site
// bestuurt zo de geopende PDF. Alles draait hier in de browser, ook zonder de
// MCP-server van de desktop-app: tekst en zoeken met pdf.js, annotaties met
// dezelfde handlers als de MCP-brug (`mcp:*` in js/mcp-bridge.js).
//
// De namen, argumenten en waarden liggen vast (het protocol met de werkplek):
//
//   pdf_stand                  {}                          -> {pagina, paginas, bestandsnaam, gewijzigd, geselecteerd, paginamaat}
//   pdf_naar_pagina            {pagina}                    -> {pagina}
//   pdf_paginatekst            {pagina}                    -> {pagina, tekst, afgekapt?}
//   pdf_zoeken                 {tekst}                     -> {treffers: [{pagina, fragment}], afgekapt?}
//   pdf_annotaties             {pagina?}                   -> {annotaties: [{id, pagina, soort, tekst?, kleur?, rechthoek?}]}
//   pdf_annotatie_maken        {pagina, soort, eigenschappen} -> {id}
//   pdf_annotatie_wijzigen     {id, eigenschappen}         -> {id}
//   pdf_annotatie_verwijderen  {id}                        -> {id}
//
// Coördinaten zijn PDF-punten op de pagina zoals hij in beeld staat, met de
// oorsprong linksboven en y naar beneden (de annotatiecoördinaten van de app op
// schaal 1). Een fout is een afgewezen belofte met een Nederlandse melding.
//
// Deze module is vrij van app-imports: de omgeving (het document, pdf.js en de
// handlers) komt binnen via `maakWerkplekApp(omgeving)`, zie werkplek-app-omgeving.js.

/** De gereedschappen, in de volgorde van het protocol. */
export const TOOL_NAMEN = Object.freeze([
  'pdf_stand',
  'pdf_naar_pagina',
  'pdf_paginatekst',
  'pdf_zoeken',
  'pdf_annotaties',
  'pdf_annotatie_maken',
  'pdf_annotatie_wijzigen',
  'pdf_annotatie_verwijderen',
]);

/** De soorten van het protocol en het annotatietype in de app. */
export const SOORT_NAAR_TYPE = Object.freeze({
  stamp: 'stamp',
  highlight: 'highlight',
  textbox: 'textbox',
  note: 'comment',
  rectangle: 'box',
  ellipse: 'circle',
  cloud: 'cloud',
  arrow: 'arrow',
  line: 'line',
});

export const SOORTEN = Object.freeze(Object.keys(SOORT_NAAR_TYPE));

const TYPE_NAAR_SOORT = Object.freeze(
  Object.fromEntries(Object.entries(SOORT_NAAR_TYPE).map(([soort, type]) => [type, soort])),
);

/** Paginatekst: meer dan dit wordt afgekapt (met `afgekapt: true`). */
export const MAX_PAGINATEKST = 20000;
/** Zoeken: hoogstens zoveel treffers. */
export const MAX_TREFFERS = 50;
/** Zoeken: tekens context aan weerszijden van een treffer. */
const CONTEXT = 60;
/** Een tekst in een annotatie in de lijst: hoogstens zoveel tekens. */
const MAX_ANNOTATIETEKST = 500;

/** De eigenschappen die een annotatie kent, per soort (ook de tooldefinitie noemt ze). */
export const EIGENSCHAPPEN = Object.freeze({
  stamp: ['rechthoek', 'tekst', 'kleur', 'dekking'],
  highlight: ['rechthoek', 'kleur', 'dekking'],
  textbox: ['rechthoek', 'tekst', 'kleur', 'tekstkleur', 'vulkleur', 'lettergrootte', 'lijndikte', 'dekking'],
  note: ['positie', 'tekst', 'kleur'],
  rectangle: ['rechthoek', 'kleur', 'vulkleur', 'lijndikte', 'dekking'],
  ellipse: ['rechthoek', 'kleur', 'vulkleur', 'lijndikte', 'dekking'],
  cloud: ['rechthoek', 'kleur', 'lijndikte', 'dekking'],
  arrow: ['begin', 'eind', 'kleur', 'lijndikte', 'dekking'],
  line: ['begin', 'eind', 'kleur', 'lijndikte', 'dekking'],
});

/** Een fout voor de assistent (de melding gaat zo terug als `fout`). */
export class WerkplekAppFout extends Error {
  constructor(melding) {
    super(melding);
    this.name = 'WerkplekAppFout';
  }
}

const fout = (melding) => new WerkplekAppFout(melding);

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const rond = (v) => Math.round(v * 100) / 100;

/** Alleen gewone JSON-waarden terug (ze gaan met postMessage het frame uit). */
function alsJson(waarde) {
  return waarde === undefined ? null : JSON.parse(JSON.stringify(waarde));
}

function geheelGetal(waarde, naam) {
  const n = typeof waarde === 'string' && waarde.trim() !== '' ? Number(waarde) : waarde;
  if (!Number.isInteger(n)) throw fout(`${naam} moet een geheel getal zijn`);
  return n;
}

function paginaUit(waarde, paginas) {
  const pagina = geheelGetal(waarde, 'pagina');
  if (pagina < 1 || pagina > paginas) throw fout(`pagina ${pagina} bestaat niet (het document heeft ${paginas} pagina's)`);
  return pagina;
}

// --- Tekst ---------------------------------------------------------------------------------------

/** De tekst van een pagina uit de items van pdf.js (`getTextContent().items`): regels volgen `hasEOL`. */
export function tekstUitItems(items) {
  let tekst = '';
  for (const item of items || []) {
    if (!item || typeof item.str !== 'string') continue;
    tekst += item.str;
    if (item.hasEOL) tekst += '\n';
  }
  return tekst.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Afkappen op `max` tekens. */
export function kapAf(tekst, max = MAX_PAGINATEKST) {
  if (tekst.length <= max) return { tekst, afgekapt: false };
  return { tekst: tekst.slice(0, max), afgekapt: true };
}

/** Zonder hoofdletters en accenten, witruimte als één spatie; met de plek van elk teken in het origineel. */
function normaliseer(tekst) {
  let uit = '';
  const plek = [];
  let witruimte = false;
  for (let i = 0; i < tekst.length; i++) {
    const teken = tekst[i];
    if (/\s/.test(teken)) {
      if (!witruimte && uit.length) {
        uit += ' ';
        plek.push(i);
      }
      witruimte = true;
      continue;
    }
    witruimte = false;
    const kaal = teken.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const k of kaal) {
      uit += k;
      plek.push(i);
    }
  }
  return { uit, plek };
}

/** De treffers van `zoekterm` in de tekst van één pagina, elk met een fragment eromheen. */
export function zoekInTekst(tekst, zoekterm, pagina, max = MAX_TREFFERS) {
  const term = normaliseer(String(zoekterm)).uit.trim();
  if (!term || !tekst) return [];
  const { uit, plek } = normaliseer(tekst);
  const treffers = [];
  let vanaf = 0;
  while (treffers.length < max) {
    const index = uit.indexOf(term, vanaf);
    if (index < 0) break;
    const begin = plek[index];
    const eind = plek[index + term.length - 1] + 1;
    const van = Math.max(0, begin - CONTEXT);
    const tot = Math.min(tekst.length, eind + CONTEXT);
    const fragment = (van > 0 ? '…' : '') + tekst.slice(van, tot).replace(/\s+/g, ' ').trim() + (tot < tekst.length ? '…' : '');
    treffers.push({ pagina, fragment });
    vanaf = index + term.length;
  }
  return treffers;
}

// --- Annotaties ----------------------------------------------------------------------------------

/** De soort van het protocol voor een annotatietype van de app (een ander type houdt zijn eigen naam). */
export function soortVanType(type) {
  return TYPE_NAAR_SOORT[type] || type;
}

/** Een annotatie van de app als `{id, pagina, soort, tekst?, kleur?, rechthoek?}` (lijnen ook `begin` en `eind`). */
export function annotatieSamenvatting(ann) {
  const uit = { id: String(ann.id), pagina: ann.page ?? 1, soort: soortVanType(ann.type) };
  const tekst = [ann.text, ann.stampText, ann.measureText].find((t) => typeof t === 'string' && t);
  if (tekst) uit.tekst = tekst.length > MAX_ANNOTATIETEKST ? `${tekst.slice(0, MAX_ANNOTATIETEKST)}…` : tekst;
  const kleur = ann.type === 'stamp' ? ann.stampColor || ann.color : ann.color || ann.strokeColor;
  if (typeof kleur === 'string' && kleur) uit.kleur = kleur;
  if (isGetal(ann.x) && isGetal(ann.y) && isGetal(ann.width) && isGetal(ann.height)) {
    uit.rechthoek = { x: rond(ann.x), y: rond(ann.y), breedte: rond(ann.width), hoogte: rond(ann.height) };
  } else if (isGetal(ann.startX) && isGetal(ann.startY) && isGetal(ann.endX) && isGetal(ann.endY)) {
    const x = Math.min(ann.startX, ann.endX);
    const y = Math.min(ann.startY, ann.endY);
    uit.rechthoek = { x: rond(x), y: rond(y), breedte: rond(Math.abs(ann.endX - ann.startX)), hoogte: rond(Math.abs(ann.endY - ann.startY)) };
  } else if (isGetal(ann.x) && isGetal(ann.y)) {
    uit.rechthoek = { x: rond(ann.x), y: rond(ann.y), breedte: 0, hoogte: 0 };
  }
  if (isGetal(ann.startX) && isGetal(ann.startY) && isGetal(ann.endX) && isGetal(ann.endY)) {
    uit.begin = { x: rond(ann.startX), y: rond(ann.startY) };
    uit.eind = { x: rond(ann.endX), y: rond(ann.endY) };
  }
  return uit;
}

function rechthoekUit(waarde) {
  if (!isObject(waarde)) throw fout('rechthoek moet {x, y, breedte, hoogte} zijn (PDF-punten)');
  const { x, y, breedte, hoogte } = waarde;
  if (![x, y, breedte, hoogte].every(isGetal)) throw fout('rechthoek moet {x, y, breedte, hoogte} met getallen zijn');
  if (breedte <= 0 || hoogte <= 0) throw fout('breedte en hoogte van de rechthoek moeten groter dan 0 zijn');
  return { x, y, width: breedte, height: hoogte };
}

function puntUit(waarde, naam) {
  if (!isObject(waarde) || !isGetal(waarde.x) || !isGetal(waarde.y)) throw fout(`${naam} moet {x, y} met getallen zijn`);
  return { x: waarde.x, y: waarde.y };
}

function kleurUit(waarde, naam) {
  if (typeof waarde !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(waarde.trim())) {
    throw fout(`${naam} moet een hexkleur zijn, bijvoorbeeld #ff0000`);
  }
  return waarde.trim().toLowerCase();
}

/** Geen vulling: null, "geen" of "none". */
function vulkleurUit(waarde) {
  if (waarde === null || waarde === 'geen' || waarde === 'none') return null;
  return kleurUit(waarde, 'vulkleur');
}

function getalUit(waarde, naam, min, max) {
  if (!isGetal(waarde) || waarde < min || waarde > max) throw fout(`${naam} moet een getal van ${min} tot ${max} zijn`);
  return waarde;
}

/**
 * De `eigenschappen` van het protocol als velden van een annotatie van de app. `nieuw`: voor het maken (dan is de
 * geometrie verplicht); anders een wijziging (alleen wat genoemd is). Een onbekende eigenschap is een fout.
 */
export function eigenschappenNaarVelden(soort, eigenschappen, { nieuw = false } = {}) {
  const toegestaan = EIGENSCHAPPEN[soort];
  if (!toegestaan) throw fout(`onbekende soort: ${soort} (kies uit ${SOORTEN.join(', ')})`);
  const e = eigenschappen ?? {};
  if (!isObject(e)) throw fout('eigenschappen moet een object zijn');
  const onbekend = Object.keys(e).filter((k) => !toegestaan.includes(k));
  if (onbekend.length) throw fout(`${soort} kent ${onbekend.join(', ')} niet (wel: ${toegestaan.join(', ')})`);

  const v = {};
  if ('rechthoek' in e) Object.assign(v, rechthoekUit(e.rechthoek));
  if ('positie' in e) Object.assign(v, puntUit(e.positie, 'positie'));
  if ('begin' in e) {
    const p = puntUit(e.begin, 'begin');
    v.startX = p.x;
    v.startY = p.y;
  }
  if ('eind' in e) {
    const p = puntUit(e.eind, 'eind');
    v.endX = p.x;
    v.endY = p.y;
  }
  if (nieuw) {
    if (toegestaan.includes('rechthoek') && !('rechthoek' in e)) throw fout(`${soort} heeft een rechthoek nodig: {x, y, breedte, hoogte}`);
    if (soort === 'note' && !('positie' in e)) throw fout('note heeft een positie nodig: {x, y}');
    if (toegestaan.includes('begin') && !('begin' in e && 'eind' in e)) throw fout(`${soort} heeft begin en eind nodig: {x, y}`);
  }

  if ('tekst' in e) {
    if (typeof e.tekst !== 'string') throw fout('tekst moet tekst zijn');
    if (soort === 'stamp') {
      v.stampText = e.tekst;
      v.stampName = e.tekst;
    } else {
      v.text = e.tekst;
    }
  }
  if ('kleur' in e) {
    const kleur = kleurUit(e.kleur, 'kleur');
    v.color = kleur;
    if (soort === 'stamp') v.stampColor = kleur;
    if (soort === 'highlight') v.fillColor = kleur;
    else if (soort === 'note') v.fillColor = kleur;
    else v.strokeColor = kleur;
  }
  if ('tekstkleur' in e) v.textColor = kleurUit(e.tekstkleur, 'tekstkleur');
  if ('vulkleur' in e) {
    const vul = vulkleurUit(e.vulkleur);
    v.fillColor = vul === null && soort === 'textbox' ? 'none' : vul;
  }
  if ('lettergrootte' in e) v.fontSize = getalUit(e.lettergrootte, 'lettergrootte', 1, 400);
  if ('lijndikte' in e) v.lineWidth = getalUit(e.lijndikte, 'lijndikte', 0, 100);
  if ('dekking' in e) v.opacity = getalUit(e.dekking, 'dekking', 0, 1);

  if (nieuw && soort === 'stamp') {
    // Een tekststempel zoals de ingebouwde stempels (stamps.js), zonder SVG-beeld.
    v.stampSvg = undefined;
    if (!('tekst' in e)) {
      v.stampText = 'STEMPEL';
      v.stampName = 'Stempel';
    }
    if (!('kleur' in e)) {
      v.color = '#ef4444';
      v.strokeColor = '#ef4444';
      v.stampColor = '#ef4444';
    }
    if (!('dekking' in e)) v.opacity = 0.85;
  }
  return v;
}

// --- De app -------------------------------------------------------------------------------------

/**
 * `window.__OPDS_APP__` voor de werkplek. De omgeving:
 *   document()                 het actieve document of null: {paginas, pagina, bestandsnaam, gewijzigd, geselecteerd,
 *                              paginamaat(pagina), annotaties}
 *   tekstItems(pagina)         de tekstitems van pdf.js van die pagina (belofte)
 *   naarPagina(pagina)         naar die pagina (belofte)
 *   opdracht(naam, params)     een `mcp:*`-handler van de app (belofte op {ok, error?, ...})
 */
export function maakWerkplekApp(omgeving) {
  function documentOfFout() {
    const doc = omgeving.document();
    if (!doc) throw fout('er is geen PDF geopend');
    return doc;
  }

  async function opdracht(naam, params) {
    const uit = await omgeving.opdracht(naam, params);
    if (!uit || uit.ok === false) throw fout(uit?.error || 'de app kon dit niet uitvoeren');
    return uit;
  }

  function stand() {
    const doc = omgeving.document();
    if (!doc) return { pagina: null, paginas: 0, bestandsnaam: null, gewijzigd: false, geselecteerd: [], paginamaat: null };
    const maat = doc.paginamaat(doc.pagina);
    return {
      pagina: doc.pagina,
      paginas: doc.paginas,
      bestandsnaam: doc.bestandsnaam,
      gewijzigd: Boolean(doc.gewijzigd),
      geselecteerd: doc.geselecteerd.map(String),
      paginamaat: maat ? { breedte: rond(maat.breedte), hoogte: rond(maat.hoogte) } : null,
    };
  }

  /** De paginateksten, per document en pagina bewaard (zoeken doet ze allemaal). */
  const teksten = new WeakMap();
  async function paginatekst(doc, pagina) {
    let perPagina = teksten.get(doc.sleutel);
    if (!perPagina) {
      perPagina = new Map();
      if (doc.sleutel) teksten.set(doc.sleutel, perPagina);
    }
    if (!perPagina.has(pagina)) perPagina.set(pagina, tekstUitItems(await omgeving.tekstItems(pagina)));
    return perPagina.get(pagina);
  }

  const tools = {
    pdf_stand: async () => stand(),

    pdf_naar_pagina: async ({ pagina }) => {
      const doc = documentOfFout();
      const n = paginaUit(pagina, doc.paginas);
      await omgeving.naarPagina(n);
      return { pagina: n };
    },

    pdf_paginatekst: async ({ pagina }) => {
      const doc = documentOfFout();
      const n = paginaUit(pagina ?? doc.pagina, doc.paginas);
      const { tekst, afgekapt } = kapAf(await paginatekst(doc, n));
      return afgekapt ? { pagina: n, tekst, afgekapt: true } : { pagina: n, tekst };
    },

    pdf_zoeken: async ({ tekst }) => {
      const doc = documentOfFout();
      if (typeof tekst !== 'string' || !tekst.trim()) throw fout('tekst moet een zoekterm zijn');
      const treffers = [];
      for (let p = 1; p <= doc.paginas && treffers.length <= MAX_TREFFERS; p++) {
        treffers.push(...zoekInTekst(await paginatekst(doc, p), tekst, p, MAX_TREFFERS + 1 - treffers.length));
      }
      if (treffers.length > MAX_TREFFERS) return { treffers: treffers.slice(0, MAX_TREFFERS), afgekapt: true };
      return { treffers };
    },

    pdf_annotaties: async ({ pagina }) => {
      const doc = documentOfFout();
      let lijst = doc.annotaties;
      if (pagina !== undefined && pagina !== null) {
        const n = paginaUit(pagina, doc.paginas);
        lijst = lijst.filter((a) => (a.page ?? 1) === n);
      }
      return { annotaties: lijst.map(annotatieSamenvatting) };
    },

    pdf_annotatie_maken: async ({ pagina, soort, eigenschappen }) => {
      const doc = documentOfFout();
      const n = paginaUit(pagina, doc.paginas);
      if (!SOORTEN.includes(soort)) throw fout(`onbekende soort: ${soort} (kies uit ${SOORTEN.join(', ')})`);
      const props = eigenschappenNaarVelden(soort, eigenschappen, { nieuw: true });
      const uit = await opdracht('mcp:create-annotation', { type: SOORT_NAAR_TYPE[soort], page: n, props });
      return { id: String(uit.id) };
    },

    pdf_annotatie_wijzigen: async ({ id, eigenschappen }) => {
      const doc = documentOfFout();
      if (typeof id !== 'string' || !id) throw fout('id moet het id van een annotatie zijn');
      const ann = doc.annotaties.find((a) => String(a.id) === id);
      if (!ann) throw fout(`geen annotatie met id ${id}`);
      const soort = soortVanType(ann.type);
      if (!EIGENSCHAPPEN[soort]) throw fout(`een annotatie van de soort ${soort} kan hier niet gewijzigd worden`);
      const props = eigenschappenNaarVelden(soort, eigenschappen);
      if (!Object.keys(props).length) throw fout('geef minstens één eigenschap om te wijzigen');
      await opdracht('mcp:update-annotation', { id, props });
      return { id };
    },

    pdf_annotatie_verwijderen: async ({ id }) => {
      documentOfFout();
      if (typeof id !== 'string' || !id) throw fout('id moet het id van een annotatie zijn');
      await opdracht('mcp:delete-annotation', { id });
      return { id };
    },
  };

  return {
    tools: () => [...TOOL_NAMEN],
    run: async (naam, argumenten) => {
      const tool = Object.prototype.hasOwnProperty.call(tools, naam) ? tools[naam] : null;
      if (!tool) throw fout(`onbekend gereedschap: ${naam}`);
      if (argumenten !== undefined && argumenten !== null && !isObject(argumenten)) throw fout('argumenten moet een object zijn');
      return alsJson(await tool(argumenten ?? {}));
    },
    stand,
  };
}
