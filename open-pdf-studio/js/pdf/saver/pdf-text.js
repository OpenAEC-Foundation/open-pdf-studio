// Tekst naar PDF: één plek voor de twee soorten tekst die de saver schrijft.
//
// 1. Tekst-strings in woordenboeken (/Contents, /T, /Subj, /RC, OPS_*-sleutels,
//    bladwijzertitels). pdf-lib's PDFString.of schrijft van elk teken alleen
//    de lage byte: '€' (U+20AC) werd 0xAC en kwam terug als '¬'. Pure ASCII
//    blijft een PDFString, byte-identiek aan eerdere versies; al het andere
//    gaat als UTF-16BE met BOM (PDFHexString.fromText).
// 2. Tekst in appearance-streams: '(...) Tj' met een font in /WinAnsiEncoding.
//    context.stream(string) houdt ook alleen de lage byte over. winAnsiLiteral
//    levert de inhoud van zo'n literal string in puur ASCII: WinAnsi-codes
//    vanaf 0x80 als octale escape (€ -> \200, é -> \351) en een zichtbare
//    vervanging ('?' of een naaste equivalent) voor tekens buiten WinAnsi.
//
// De WinAnsi-tabel en de vervangingsregels bestaan al (text/): hier worden ze
// alleen gecombineerd, er komt geen tweede tabel bij.

import { PDFString, PDFHexString } from 'pdf-lib';
import { sanitizeWinAnsiText } from '../../text/text-edit-appearance.js';
import { winAnsiMap, invertUnicodeMap } from '../../text/content-stream-text.js';

const ALLEEN_ASCII = /^[\x00-\x7F]*$/;

/**
 * Tekst-string voor een PDF-woordenboek.
 * ASCII -> PDFString (zoals voorheen), anders UTF-16BE-hex met BOM.
 * Niet-strings worden eerst naar tekst omgezet (PDFString.of(getal) schreef
 * een kapotte string).
 * @param {unknown} text
 * @returns {PDFString|PDFHexString}
 */
export function pdfTextString(text) {
  const s = String(text ?? '');
  return ALLEEN_ASCII.test(s) ? PDFString.of(s) : PDFHexString.fromText(s);
}

/**
 * Leest de tekst van een PDFString of PDFHexString terug; undefined voor
 * alle andere objecten.
 *
 * - PDFHexString: decodeText() (UTF-16BE met BOM, anders PDFDocEncoding).
 *   `.value` bevat hier de hex-cijfers, niet de tekst.
 * - PDFString met een UTF-16-BOM in de ruwe inhoud: decodeText().
 * - Andere PDFString: de ruwe inhoud (`.value`). pdf-lib schrijft literal
 *   strings zonder escapes, dus dit is exact wat eerdere versies schreven.
 *   decodeText() zou daar backslash-escapes verwerken en JSON-waarden
 *   (OPS_Params, OPS_ScheduleData, ...) uit oude bestanden breken.
 * @param {unknown} obj
 * @returns {string|undefined}
 */
export function decodePdfTextObject(obj) {
  if (obj instanceof PDFHexString) return obj.decodeText();
  if (obj instanceof PDFString) {
    const ruw = obj.value;
    return ruw.startsWith('þÿ') ? obj.decodeText() : ruw;
  }
  return undefined;
}

// Unicode-teken -> WinAnsi-code, eenmalig afgeleid uit de bestaande tabel.
let _winAnsiCodes = null;
function winAnsiCodes() {
  if (!_winAnsiCodes) _winAnsiCodes = invertUnicodeMap(winAnsiMap());
  return _winAnsiCodes;
}

/**
 * De tekst zoals een WinAnsi-font hem toont: elk teken is daarna ASCII of
 * heeft een WinAnsi-code. ASCII (ook tab/CR/LF) blijft ongemoeid; tekens
 * buiten WinAnsi krijgen een naaste equivalent ('≤' -> '<=', 'ā' -> 'a') of
 * '?'. Eén UTF-16-eenheid in het resultaat is één byte in de stream, dus
 * `.length` is bruikbaar voor breedteschattingen.
 * @param {unknown} text
 * @param {{ newlines?: 'keep'|'space' }} [options]  'space': elke reeks CR/LF wordt één spatie
 * @returns {string}
 */
export function toWinAnsiText(text, { newlines = 'keep' } = {}) {
  let s = String(text ?? '');
  if (newlines === 'space') s = s.replace(/[\r\n]+/g, ' ');
  const codes = winAnsiCodes();
  let uit = '';
  for (const ch of s) {
    if (ch.codePointAt(0) < 0x80 || codes.has(ch)) uit += ch;
    else uit += sanitizeWinAnsiText(ch).text;
  }
  return uit;
}

/**
 * Inhoud van een PDF literal string (zonder de omringende haakjes) voor een
 * font in /WinAnsiEncoding, in puur ASCII. `\`, `(` en `)` krijgen een
 * backslash, WinAnsi-codes vanaf 0x80 worden een octale escape van drie
 * cijfers. Voor ASCII-tekst is het resultaat gelijk aan de oude escapes.
 * @param {unknown} text
 * @param {{ newlines?: 'keep'|'space' }} [options]  zie toWinAnsiText
 * @returns {string}
 */
export function winAnsiLiteral(text, options) {
  const codes = winAnsiCodes();
  let uit = '';
  for (const ch of toWinAnsiText(text, options)) {
    if (ch === '\\' || ch === '(' || ch === ')') {
      uit += '\\' + ch;
    } else if (ch.charCodeAt(0) < 0x80) {
      uit += ch;
    } else {
      const code = codes.get(ch);
      uit += code === undefined ? '?' : '\\' + code.toString(8).padStart(3, '0');
    }
  }
  return uit;
}

/**
 * Naam voor een PDFName-waarde (bijv. stempel-/Name) uit vrije tekst.
 * pdf-lib codeert tekens boven 0xFF als een ongeldige '#20AC'-escape; de
 * echte tekst reist al mee in /Subj en OPS_StampName. Afdrukbaar ASCII blijft
 * zoals het was, de rest valt weg; blijft er niets over, dan `fallback`.
 * @param {unknown} name
 * @param {string} fallback
 * @returns {string}
 */
export function asciiPdfName(name, fallback) {
  const s = String(name ?? '').replace(/[^\x20-\x7E]/g, '');
  return s.trim() ? s : fallback;
}
