// Welk papier de printdialoog toont, en hoe een keuze uit de
// printereigenschappen de Pagina-instelling wordt (issue #406).
//
// De kop van het afdrukvoorbeeld toonde alleen de paginamaat, nooit het
// papier, en wat in de eigenschappen van de printer werd gekozen ging
// verloren. Hier staan de pure regels, zodat Pagina-instelling, printdialoog
// en de argumenten van print_pdf altijd hetzelfde papier bedoelen en de
// laatste expliciete keuze wint. Geen DOM, geen state, geen invoke.
//
// PapierInfo (van printer_papier en open_printer_properties, Rust):
//   { papier: 'a2'|'a3'|'a4'|'a5'|'letter'|'legal'|'tabloid'|'overig',
//     naam: string, breedteMm: number, hoogteMm: number,
//     orientatie: 'portrait'|'landscape' }
// breedteMm/hoogteMm = het vel staand (korte zijde, lange zijde); naam = de
// formuliernaam van de driver, of ''. open_printer_properties geeft bij OK
// daarnaast papierGewijzigd en orientatieGewijzigd: wat de gebruiker in het
// venster anders zette dan waarmee het werd vooringevuld.

import { PAPIERFORMATEN, paginaOrientatie, printArgumenten } from './print-pagina-instelling.js';

const PT_NAAR_MM = 25.4 / 72;

function geldig(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function isOrientatie(o) {
  return o === 'portrait' || o === 'landscape';
}

/** Sleutel uit PAPIERFORMATEN (dus niet 'printer', 'overig' of iets onbekends). */
export function isPapierFormaat(sleutel) {
  return typeof sleutel === 'string' && Object.hasOwn(PAPIERFORMATEN, sleutel);
}

/**
 * Antwoord van Rust controleren. null, undefined, `true` (het antwoord van
 * vóór deze wijziging) of iets zonder papiersleutel → null. Een onbekende
 * sleutel wordt 'overig'; de maten staan altijd staand (kort, lang).
 */
export function normaliseerPapierInfo(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
  if (typeof info.papier !== 'string' || !info.papier) return null;
  const b = geldig(info.breedteMm) ? info.breedteMm : null;
  const h = geldig(info.hoogteMm) ? info.hoogteMm : null;
  const beide = b !== null && h !== null;
  return {
    papier: isPapierFormaat(info.papier) ? info.papier : 'overig',
    naam: typeof info.naam === 'string' ? info.naam.trim() : '',
    breedteMm: beide ? Math.min(b, h) : null,
    hoogteMm: beide ? Math.max(b, h) : null,
    orientatie: info.orientatie === 'landscape' ? 'landscape' : 'portrait',
  };
}

/**
 * Oriëntatie van het vel zoals het uit de printer komt: de gevraagde
 * oriëntatie, of bij 'auto' die van de getoonde pagina (zo draait print_pdf
 * per pagina). Pagina onbekend → `terugval` (mag null zijn).
 */
function velOrientatie(gevraagd, pagina, terugval) {
  if (isOrientatie(gevraagd)) return gevraagd;
  if (pagina && geldig(pagina.breedtePt) && geldig(pagina.hoogtePt)) {
    return paginaOrientatie(pagina.breedtePt, pagina.hoogtePt);
  }
  return terugval;
}

/**
 * Het papier van de volgende afdruk, zoals de printdialoog het toont.
 *
 * 1. Een Pagina-instelling die voor dít document is bevestigd met een formaat
 *    wint: precies het papier dat printArgumenten naar print_pdf stuurt.
 * 2. Anders het papier dat de printer zelf neemt (printer_papier, of wat uit
 *    Eigenschappen terugkwam).
 * 3. Anders onbekend (Linux/macOS, of de driver gaf niets). printerPapier
 *    undefined = nog aan het ophalen ('laden').
 *
 * breedteMm/hoogteMm beschrijven het vel staand (korte zijde, lange zijde),
 * net als PapierInfo en de keuzelijst van de Pagina-instelling: A3 is altijd
 * "297 x 420 mm", ook als de pagina liggend op het vel komt. Hoe het vel uit
 * de printer komt staat apart in `orientatie`: die van de Pagina-instelling,
 * of bij Automatisch draaien die van de getoonde pagina.
 *
 * @param {{ paginaInstelling: object|null, docId: any, autoRotate: boolean,
 *           printerPapier: object|null|undefined,
 *           pagina?: { breedtePt: number, hoogtePt: number }|null }} p
 * @returns {{ bron: 'paginaInstelling'|'printer'|'onbekend'|'laden',
 *             papier: string, naam: string,
 *             breedteMm: number|null, hoogteMm: number|null,
 *             orientatie: 'portrait'|'landscape' }}
 */
export function effectiefPapier({ paginaInstelling, docId, autoRotate, printerPapier, pagina = null }) {
  const args = printArgumenten({ autoRotate, paginaInstelling, docId });

  let bron;
  let papier = 'printer';
  let naam = '';
  let kort = null;
  let lang = null;
  let terugval = 'portrait';

  if (isPapierFormaat(args.papier)) {
    const f = PAPIERFORMATEN[args.papier];
    bron = 'paginaInstelling';
    papier = args.papier;
    naam = f.label;
    kort = f.breedte;
    lang = f.hoogte;
    terugval = paginaInstelling.orientation;
  } else if (printerPapier === undefined) {
    bron = 'laden';
  } else {
    const info = normaliseerPapierInfo(printerPapier);
    if (!info) {
      bron = 'onbekend';
    } else {
      bron = 'printer';
      papier = info.papier;
      terugval = info.orientatie;
      const f = PAPIERFORMATEN[info.papier];
      if (f) {
        // Bekend formaat: dezelfde naam en maten als in de Pagina-instelling.
        naam = f.label;
        kort = f.breedte;
        lang = f.hoogte;
      } else {
        naam = info.naam;
        kort = info.breedteMm;
        lang = info.hoogteMm;
      }
    }
  }

  return {
    bron,
    papier,
    naam,
    breedteMm: kort,
    hoogteMm: lang,
    orientatie: velOrientatie(args.orientatie, pagina, isOrientatie(terugval) ? terugval : 'portrait'),
  };
}

// Formuliernamen als "Custom 500 x 700 mm" dragen hun maten al.
const NAAM_MET_MATEN = /\d\s*[x×]\s*\d/i;

/**
 * Tekst voor het papier in de kop: "A3 (297 x 420 mm)" (maten staand, zoals
 * in de Pagina-instelling), "594 x 841 mm", een formuliernaam, of
 * `standaardTekst` als het papier onbekend is.
 * null = nog niets tonen (printer_papier loopt nog).
 */
export function papierTekst(effectief, standaardTekst) {
  if (!effectief || effectief.bron === 'laden') return null;
  if (effectief.bron === 'onbekend') return standaardTekst;
  const { naam, breedteMm, hoogteMm } = effectief;
  const maten = geldig(breedteMm) && geldig(hoogteMm)
    ? `${Math.round(Math.min(breedteMm, hoogteMm))} x ${Math.round(Math.max(breedteMm, hoogteMm))} mm`
    : null;
  if (naam && maten && !NAAM_MET_MATEN.test(naam)) return `${naam} (${maten})`;
  if (naam) return naam;
  if (maten) return maten;
  return standaardTekst;
}

/** Maat van de getoonde pagina: "297 x 210 mm"; null als die onbekend is. */
export function paginaTekst(breedtePt, hoogtePt) {
  if (!geldig(breedtePt) || !geldig(hoogtePt)) return null;
  return `${Math.round(breedtePt * PT_NAAR_MM)} x ${Math.round(hoogtePt * PT_NAAR_MM)} mm`;
}

/**
 * Waarmee het eigenschappenvenster van de driver wordt vooringevuld: het
 * papier en de oriëntatie die de volgende afdruk krijgt. Zo toont de driver
 * wat de Pagina-instelling en de kop zeggen, en verandert OK zonder
 * wijziging niets aan die keuze.
 *
 * - papier: wat printArgumenten naar print_pdf stuurt (een formaat, of
 *   'printer' = het papier van de printer laten staan).
 * - orientatie: de gevraagde oriëntatie, of bij 'auto' die van de getoonde
 *   pagina; is die onbekend, dan 'auto' (de driver houdt zijn oriëntatie).
 *
 * @returns {{ papier: string, orientatie: 'portrait'|'landscape'|'auto' }}
 */
export function eigenschappenVooraf({ paginaInstelling, docId, autoRotate, pagina = null }) {
  const args = printArgumenten({ autoRotate, paginaInstelling, docId });
  return {
    papier: isPapierFormaat(args.papier) ? args.papier : 'printer',
    orientatie: velOrientatie(args.orientatie, pagina, 'auto'),
  };
}

/** Wat de gebruiker in Eigenschappen veranderde. Zonder vlag: vergelijken met wat erin ging. */
function gewijzigd(vlag, gekozen, vooraf) {
  if (typeof vlag === 'boolean') return vlag;
  return gekozen !== vooraf;
}

/**
 * Pagina-instelling na OK in Eigenschappen, voor het huidige document.
 *
 * Alleen wat de gebruiker in het venster veranderde telt (papierGewijzigd,
 * orientatieGewijzigd van Rust). OK zonder wijziging, of met alleen andere
 * instellingen (dubbelzijdig, lade, …), laat de Pagina-instelling staan:
 * het venster was vooringevuld met die keuze (eigenschappenVooraf).
 *
 * Wat wel veranderde werkt als dezelfde keuze in de Pagina-instelling:
 * - papier: de sleutel als die in PAPIERFORMATEN staat, anders 'printer'
 *   (dan beslist de bewaarde DEVMODE van de printer);
 * - oriëntatie: uit het antwoord.
 * Het andere veld blijft wat de volgende afdruk al zou krijgen: de
 * Pagina-instelling van dit document, anders het papier van de printer en
 * de oriëntatie waarmee het venster werd vooringevuld. Handmatig, zodat de
 * keuze blijft staan tot de gebruiker in de Pagina-instelling iets anders
 * kiest.
 *
 * Geen PapierInfo (Annuleren, Linux/macOS) of niets veranderd → null: er
 * verandert niets.
 *
 * @param {{ papierInfo: object|null, docId: any, huidig: object|null,
 *           vooraf: { papier: string, orientatie: string }|null }} p
 */
export function instellingNaEigenschappen({ papierInfo, docId, huidig = null, vooraf = null }) {
  const info = normaliseerPapierInfo(papierInfo);
  if (!info) return null;
  const voor = vooraf || { papier: 'printer', orientatie: 'auto' };
  const papierAnders = gewijzigd(papierInfo.papierGewijzigd, info.papier, voor.papier);
  const orientatieAnders = gewijzigd(papierInfo.orientatieGewijzigd, info.orientatie, voor.orientatie);
  if (!papierAnders && !orientatieAnders) return null;

  const voorDitDocument = Boolean(huidig) && huidig.docId === docId;
  let size;
  if (papierAnders) size = isPapierFormaat(info.papier) ? info.papier : 'printer';
  else if (voorDitDocument && typeof huidig.size === 'string') size = huidig.size;
  else size = isPapierFormaat(voor.papier) ? voor.papier : 'printer';

  let orientation;
  if (orientatieAnders) orientation = info.orientatie;
  else if (voorDitDocument && isOrientatie(huidig.orientation)) orientation = huidig.orientation;
  else if (isOrientatie(voor.orientatie)) orientation = voor.orientatie;
  else orientation = info.orientatie;

  return { docId, size, orientation, handmatig: true };
}

/**
 * Volgnummers voor printer_papier: alleen het antwoord op het laatste
 * verzoek telt, en alleen zolang dezelfde printer gekozen is. Een antwoord
 * uit Eigenschappen laat lopende verzoeken vervallen; die zijn gestart vóór
 * de keuze en zouden hem overschrijven.
 */
export function maakPapierVerzoeken() {
  let laatste = 0;
  return {
    begin() {
      laatste += 1;
      return laatste;
    },
    actueel(nr, printer, gekozenPrinter) {
      return nr === laatste && printer === gekozenPrinter;
    },
    vervallen() {
      laatste += 1;
    },
  };
}
