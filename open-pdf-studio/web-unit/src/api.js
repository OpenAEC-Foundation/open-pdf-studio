// De inbeddings-afspraak van de web-unit: attributen lezen, gebeurtenissen
// vormen, en het postMessage-protocol voor de iframe-variant.
//
// Pure module: geen DOM, geen netwerk. Het element en de iframe-brug leunen
// hierop, zodat de afspraak zelf met gewone unit-tests te dekken is.

import { leesSchaal, kentEenheid } from './meten.js';

export const PROTOCOL_VERSIE = 1;

/** De attributen die het element bekijkt, in de volgorde van het ontwerp. */
export const ATTRIBUTEN = Object.freeze([
  'src', 'scale', 'unit', 'lang', 'engine', 'mode', 'tools', 'page', 'zoom',
  'storage', 'host-origin',
]);

export const MOTOREN = Object.freeze(['pdfjs', 'mupdf', 'auto']);
export const MODI = Object.freeze(['view', 'edit']);
export const GEREEDSCHAPPEN = Object.freeze(['measure', 'comment', 'shape']);
export const OPSLAGSOORTEN = Object.freeze(['none', 'local']);

export const STANDAARD = Object.freeze({
  src: null,
  schaal: null,
  eenheid: 'mm',
  taal: 'en',
  motor: 'pdfjs',
  modus: 'edit',
  gereedschappen: GEREEDSCHAPPEN,
  pagina: 1,
  zoom: 'fit',
  opslag: 'none',
  gastheerOrigins: [],
});

function kiesUit(waarde, toegestaan, standaard) {
  if (waarde == null) return standaard;
  const s = String(waarde).trim().toLowerCase();
  return toegestaan.includes(s) ? s : standaard;
}

function leesZoom(waarde) {
  if (waarde == null) return STANDAARD.zoom;
  const s = String(waarde).trim().toLowerCase();
  if (s === '' ) return STANDAARD.zoom;
  if (s === 'fit' || s === 'fit-width') return s;
  const pct = s.endsWith('%') ? Number(s.slice(0, -1)) : Number(s);
  if (!Number.isFinite(pct) || pct <= 0) return STANDAARD.zoom;
  // 175 -> 1.75, maar 1.75 blijft 1.75: alles boven 10 lezen we als procenten.
  return pct > 10 ? pct / 100 : pct;
}

function leesGereedschappen(waarde) {
  if (waarde == null) return STANDAARD.gereedschappen;
  const s = String(waarde).trim();
  if (s === '') return [];
  const lijst = s.split(',').map((d) => d.trim().toLowerCase())
    .filter((d) => GEREEDSCHAPPEN.includes(d));
  return Object.freeze([...new Set(lijst)]);
}

function leesOrigins(waarde) {
  if (waarde == null) return STANDAARD.gastheerOrigins;
  return Object.freeze(String(waarde).split(/[\s,]+/).map((o) => o.trim()).filter(Boolean));
}

/**
 * Attributen (een gewoon object naam->tekst) omzetten naar instellingen.
 * Onbekende of onzinnige waarden vallen terug op de standaard; er wordt nooit
 * gegooid, want een gastheer met een typefout hoort een werkende kijker te
 * krijgen, geen wit vlak.
 */
export function leesInstellingen(attributen = {}) {
  const a = (naam) => {
    const v = attributen[naam];
    return v === undefined ? null : v;
  };
  const eenheidRuw = a('unit');
  const eenheid = eenheidRuw && kentEenheid(String(eenheidRuw).trim())
    ? String(eenheidRuw).trim() : STANDAARD.eenheid;
  const paginaRuw = Number(a('page'));
  return {
    src: a('src') ? String(a('src')) : STANDAARD.src,
    schaal: leesSchaal(a('scale'), eenheid),
    eenheid,
    taal: a('lang') ? String(a('lang')).trim().toLowerCase() : STANDAARD.taal,
    motor: kiesUit(a('engine'), MOTOREN, STANDAARD.motor),
    modus: kiesUit(a('mode'), MODI, STANDAARD.modus),
    gereedschappen: leesGereedschappen(a('tools')),
    pagina: Number.isFinite(paginaRuw) && paginaRuw >= 1 ? Math.trunc(paginaRuw) : STANDAARD.pagina,
    zoom: leesZoom(a('zoom')),
    opslag: kiesUit(a('storage'), OPSLAGSOORTEN, STANDAARD.opslag),
    gastheerOrigins: leesOrigins(a('host-origin')),
  };
}

/** Mag dit gereedschap in deze modus? In `view` niets. */
export function magGereedschap(instellingen, gereedschap) {
  if (instellingen.modus !== 'edit') return false;
  return instellingen.gereedschappen.includes(gereedschap);
}

// ── Gebeurtenissen ──────────────────────────────────────────────────────────

export const GEBEURTENISSEN = Object.freeze({
  geladen: 'opds:geladen',
  gewijzigd: 'opds:gewijzigd',
  opgeslagen: 'opds:opgeslagen',
  fout: 'opds:fout',
});

export function geladenDetail({ paginas, breedtePt, hoogtePt, schaal }) {
  return {
    paginas,
    breedtePt,
    hoogtePt,
    schaal: schaal ? { eenheidPerPunt: schaal.eenheidPerPunt, noemer: schaal.noemer, eenheid: schaal.eenheid } : null,
  };
}

export function gewijzigdDetail(annotaties) {
  const lijst = annotaties || [];
  return { aantal: lijst.length, laatste: lijst.length ? lijst[lijst.length - 1] : null };
}

export function opgeslagenDetail(bytes, annotaties) {
  return { bytes, aantalAnnotaties: (annotaties || []).length };
}

export function foutDetail(code, bericht) {
  return { code: String(code || 'onbekend'), bericht: String(bericht || '') };
}

// ── postMessage-afspraak ────────────────────────────────────────────────────

export const OPDRACHTEN = Object.freeze([
  'laad', 'opslaan', 'zetSchaal', 'gaNaarPagina', 'zetModus', 'zetAnnotaties',
]);

export function maakBericht(type, id, velden = {}) {
  return { opds: PROTOCOL_VERSIE, id: String(id), type: String(type), ...velden };
}

export function maakAntwoord(opdracht, velden = {}) {
  return maakBericht(opdracht.type + ':klaar', opdracht.id, velden);
}

export function maakFoutAntwoord(opdracht, code, bericht) {
  return maakBericht(opdracht.type + ':fout', opdracht.id, foutDetail(code, bericht));
}

/**
 * Een binnenkomend bericht keuren. Geeft `{geldig:false, reden}` terug in
 * plaats van te gooien, zodat de brug een afgewezen bericht kan tellen en
 * negeren zonder de unit om te leggen.
 */
export function keurBericht(bericht, origin, toegestaneOrigins = []) {
  if (!bericht || typeof bericht !== 'object') return { geldig: false, reden: 'geen-object' };
  if (bericht.opds !== PROTOCOL_VERSIE) return { geldig: false, reden: 'verkeerde-versie' };
  if (!toegestaneOrigins.length) return { geldig: false, reden: 'geen-toegestane-origin' };
  if (!toegestaneOrigins.includes(origin)) return { geldig: false, reden: 'vreemde-origin' };
  if (typeof bericht.id !== 'string' || bericht.id === '') return { geldig: false, reden: 'geen-id' };
  if (!OPDRACHTEN.includes(bericht.type)) return { geldig: false, reden: 'onbekende-opdracht' };
  return { geldig: true, opdracht: bericht };
}
