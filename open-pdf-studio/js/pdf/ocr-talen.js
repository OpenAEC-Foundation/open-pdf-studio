// OCR-talen van de ingebouwde Tesseract (#1083): leesbare namen, de
// taalopgave ('nld+eng') opbouwen en ontleden, en de keuze bij het openen.
// Pure functies; de vensters (OcrLanguagePicker.jsx) en de tests gebruiken ze.
//
// De lijst met talen komt uit src-tauri/src/ocr_talen.rs (opdracht
// ocr_languages_list); de regels voor een geldige code zijn daar dezelfde.

/** Sentinel van de app: Tesseract kiest niet zelf, ocr.rs maakt er 'chi_tra+eng' van. */
export const AUTO = 'auto';
export const ENGELS = 'eng';

/**
 * Tesseract-code (ISO 639-2/3, soms met schrift) → BCP 47-taalcode voor
 * Intl.DisplayNames. Waar een ISO 639-1-code bestaat die; anders de
 * drieletterige code zelf (Intl kent veel daarvan, bv. 'ceb', 'grc').
 */
export const TESSERACT_NAAR_BCP47 = Object.freeze({
  afr: 'af', amh: 'am', ara: 'ar', asm: 'as', aze: 'az', aze_cyrl: 'az-Cyrl', bel: 'be', ben: 'bn',
  bod: 'bo', bos: 'bs', bre: 'br', bul: 'bg', cat: 'ca', ceb: 'ceb', ces: 'cs', chi_sim: 'zh-Hans',
  chi_tra: 'zh-Hant', chr: 'chr', cos: 'co', cym: 'cy', dan: 'da', deu: 'de', div: 'dv', dzo: 'dz',
  ell: 'el', eng: 'en', enm: 'enm', epo: 'eo', est: 'et', eus: 'eu', fao: 'fo', fas: 'fa', fil: 'fil',
  fin: 'fi', fra: 'fr', frk: 'de', frm: 'frm', fry: 'fy', gla: 'gd', gle: 'ga', glg: 'gl', grc: 'grc',
  guj: 'gu', hat: 'ht', heb: 'he', hin: 'hi', hrv: 'hr', hun: 'hu', hye: 'hy', iku: 'iu', ind: 'id',
  isl: 'is', ita: 'it', jav: 'jv', jpn: 'ja', kan: 'kn', kat: 'ka', kaz: 'kk', khm: 'km', kir: 'ky',
  kmr: 'kmr', kor: 'ko', lao: 'lo', lat: 'la', lav: 'lv', lit: 'lt', ltz: 'lb', mal: 'ml', mar: 'mr',
  mkd: 'mk', mlt: 'mt', mon: 'mn', mri: 'mi', msa: 'ms', mya: 'my', nep: 'ne', nld: 'nl', nor: 'no',
  oci: 'oc', ori: 'or', pan: 'pa', pol: 'pl', por: 'pt', pus: 'ps', que: 'qu', ron: 'ro', rus: 'ru',
  san: 'sa', sin: 'si', slk: 'sk', slv: 'sl', snd: 'sd', spa: 'es', sqi: 'sq', srp: 'sr', srp_latn: 'sr-Latn',
  sun: 'su', swa: 'sw', swe: 'sv', syr: 'syr', tam: 'ta', tat: 'tt', tel: 'te', tgk: 'tg', tha: 'th',
  tir: 'ti', ton: 'to', tur: 'tr', uig: 'ug', ukr: 'uk', urd: 'ur', uzb: 'uz', uzb_cyrl: 'uz-Cyrl',
  vie: 'vi', yid: 'yi', yor: 'yo',
});

/** Achtervoegsels van Tesseract die een variant aangeven (sleutel in `varianten`). */
const VARIANTEN = { vert: 'vertical', old: 'historic' };
/** Codes zonder taal in Intl, met een eigen tekst (sleutel in `varianten`). */
const BIJZONDER = { equ: 'equations' };
/** Codes die een schrift van een andere taal zijn. */
const SCHRIFT_VARIANT = { frk: 'fraktur' };

const CODE = /^[a-z]{3}(?:_[a-z]+){0,2}$/;
const MAX_DELEN = 8;

/** Een geldige Tesseract-taalcode (zelfde regel als ocr_talen.rs). */
export function isGeldigeCode(code) {
  return typeof code === 'string' && code.length <= 24 && CODE.test(code);
}

/** 'auto' of geldige codes met '+' ertussen (geen 'osd'), hoogstens acht. */
export function isGeldigeTaalSpec(spec) {
  if (spec === AUTO) return true;
  if (typeof spec !== 'string' || !spec) return false;
  const delen = spec.split('+');
  return delen.length <= MAX_DELEN && delen.every((d) => isGeldigeCode(d) && d !== 'osd');
}

/** De code zonder variant-achtervoegsels: 'chi_tra_vert' → 'chi_tra'. */
function zonderVariant(code) {
  return code.split('_').filter((d, i) => i === 0 || !VARIANTEN[d]).join('_');
}

/** De BCP 47-code van een Tesseract-code (zonder variant-achtervoegsel), of null. */
export function bcp47Voor(code) {
  if (!isGeldigeCode(code)) return null;
  return TESSERACT_NAAR_BCP47[code] || TESSERACT_NAAR_BCP47[zonderVariant(code)] || null;
}

function intlNaam(tag, locale, DisplayNames) {
  if (!tag || typeof DisplayNames !== 'function') return null;
  for (const l of [locale, 'en']) {
    try {
      const naam = new DisplayNames([l], { type: 'language', fallback: 'none' }).of(tag);
      if (naam && naam !== tag) return naam;
    } catch {
      // onbekende locale of tag: volgende proberen
    }
  }
  return null;
}

const hoofdletter = (s, locale) => (s ? s.charAt(0).toLocaleUpperCase(locale || undefined) + s.slice(1) : s);

/**
 * Leesbare naam van een Tesseract-code in de taal van de UI.
 * @param {string} code bv. 'nld', 'chi_sim', 'chi_tra_vert'
 * @param {string} locale UI-taal ('nl', 'en', ...)
 * @param {{ varianten?: Record<string,string>, DisplayNames?: Function }} [opties]
 *   `varianten`: vertaalde teksten voor 'vertical', 'historic', 'fraktur' en
 *   'equations'. Zonder Intl of zonder naam: de code zelf.
 */
export function taalNaam(code, locale, { varianten = {}, DisplayNames = globalThis.Intl?.DisplayNames } = {}) {
  if (!isGeldigeCode(code)) return String(code ?? '');
  if (BIJZONDER[code]) return varianten[BIJZONDER[code]] || code;
  const delen = code.split('_');
  const achter = delen.slice(1).map((d) => VARIANTEN[d]).filter(Boolean);
  if (SCHRIFT_VARIANT[code]) achter.push(SCHRIFT_VARIANT[code]);
  const naam = intlNaam(bcp47Voor(code), locale, DisplayNames);
  if (!naam) return code;
  const extra = achter.map((a) => varianten[a]).filter(Boolean);
  const basis = hoofdletter(naam, locale);
  return extra.length ? `${basis} (${extra.join(', ')})` : basis;
}

/** Codes gesorteerd op hun naam (in de UI-taal). */
export function sorteerOpNaam(codes, naamVan, locale) {
  return [...codes].sort((a, b) => naamVan(a).localeCompare(naamVan(b), locale || undefined));
}

/**
 * De taalopgave voor Tesseract uit de keuze in het venster.
 * @param {string} taal 'auto' of een code
 * @param {boolean} ookEngels "Ook Engels herkennen"
 */
export function bouwTaalSpec(taal, ookEngels) {
  if (!taal || taal === AUTO) return AUTO;
  if (ookEngels && taal !== ENGELS) return `${taal}+${ENGELS}`;
  return taal;
}

/** Omgekeerd: { taal, ookEngels } uit een opgave ('nld+eng' → nld, true). */
export function ontleedTaalSpec(spec) {
  if (!isGeldigeTaalSpec(spec) || spec === AUTO) return { taal: AUTO, ookEngels: false };
  const delen = spec.split('+');
  const eersteNietEngels = delen.find((d) => d !== ENGELS);
  if (!eersteNietEngels) return { taal: ENGELS, ookEngels: false };
  return { taal: eersteNietEngels, ookEngels: delen.includes(ENGELS) };
}

/**
 * De keuze bij het openen: de opgeslagen opgave als al haar talen er zijn,
 * anders 'auto'. Zonder lijst (nog niet geladen) blijft de opgave staan.
 */
export function beginKeuze(voorkeur, beschikbaar) {
  if (!isGeldigeTaalSpec(voorkeur)) return AUTO;
  if (voorkeur === AUTO || !Array.isArray(beschikbaar)) return voorkeur;
  return voorkeur.split('+').every((d) => beschikbaar.includes(d)) ? voorkeur : AUTO;
}

/** Talen die nog te downloaden zijn: wel in de lijst van de app, niet aanwezig. */
export function teDownloaden(downloadbaar, beschikbaar) {
  const er = new Set(beschikbaar || []);
  return (downloadbaar || []).filter((c) => isGeldigeCode(c) && !er.has(c));
}

/**
 * Een fout van ocr_language_download → { code, detail }. Codes:
 * OCR_LANGUAGE_UNKNOWN, _INVALID, _WRITE, _DOWNLOAD, _FOLDER, _SPEC.
 */
export function ontleedTaalFout(fout) {
  const tekst = String(fout?.message ?? fout ?? '');
  const m = /^(OCR_LANGUAGE_[A-Z]+):(.*)$/s.exec(tekst);
  return m ? { code: m[1], detail: m[2].trim() } : { code: null, detail: tekst };
}
