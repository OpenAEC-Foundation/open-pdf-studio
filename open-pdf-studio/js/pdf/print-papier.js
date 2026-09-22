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
//   { papier: een sleutel uit PAPIERFORMATEN ('a4', 'a3l', ...) of 'overig',
//     naam: string, breedteMm: number, hoogteMm: number,
//     orientatie: 'portrait'|'landscape' }
// breedteMm/hoogteMm = het vel staand (korte zijde, lange zijde); naam = de
// formuliernaam van de driver, of ''. open_printer_properties geeft bij OK
// daarnaast papierGewijzigd en orientatieGewijzigd: wat de gebruiker in het
// venster anders zette dan waarmee het werd vooringevuld.

import { PAPIERFORMATEN, paginaOrientatie, paginaFormaat, printArgumenten } from './print-pagina-instelling.js';

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

const ZELFDE_VEL_MM = 3;

/**
 * Meldt de printer een ander vel dan het gevraagde formaat? Dan neemt de
 * driver het formaat niet over (A0L is langer dan de pdf-printer van Windows
 * aankan) en print Rust op het papier van de printer. Dezelfde sleutel, of
 * dezelfde maat op 3 mm, is hetzelfde vel; zonder antwoord valt er niets te
 * zeggen. Zonder maten is alleen een ander bekend formaat zeker een ander vel.
 */
function anderVel(info, sleutel) {
  if (!info || info.papier === sleutel) return false;
  const f = PAPIERFORMATEN[sleutel];
  if (geldig(info.breedteMm) && geldig(info.hoogteMm)) {
    return Math.abs(info.breedteMm - f.breedte) > ZELFDE_VEL_MM
      || Math.abs(info.hoogteMm - f.hoogte) > ZELFDE_VEL_MM;
  }
  return isPapierFormaat(info.papier);
}

/**
 * Het papier van de volgende afdruk, zoals de printdialoog het toont.
 *
 * 1. Een Pagina-instelling die voor dít document is bevestigd met een formaat
 *    wint: precies het papier dat printArgumenten naar print_pdf stuurt.
 *    Behalve als de printer voor dát formaat een ander vel meldt
 *    (opdrachtPapier): dan kan de driver het formaat niet aan en wordt er
 *    geprint op het papier van de printer. De kop toont dat vel, en
 *    `geweigerd` noemt het gevraagde formaat ("A0L").
 * 2. Anders het papier dat de printer zelf neemt (printer_papier, of wat uit
 *    Eigenschappen terugkwam).
 * 3. Anders onbekend (Linux/macOS, of de driver gaf niets). printerPapier
 *    undefined = nog aan het ophalen ('laden').
 *
 * printerPapier is het antwoord van printer_papier zonder formaat (papier
 * 'printer'): het vel dat de printer zelf neemt. opdrachtPapier is het
 * antwoord voor het formaat uit de Pagina-instelling: het vel dat een opdracht
 * met dat formaat echt krijgt; undefined of null = (nog) onbekend, dan geldt
 * het formaat zelf.
 *
 * breedteMm/hoogteMm beschrijven het vel staand (korte zijde, lange zijde),
 * net als PapierInfo en de keuzelijst van de Pagina-instelling: A3 is altijd
 * "297 x 420 mm", ook als de pagina liggend op het vel komt. Hoe het vel uit
 * de printer komt staat apart in `orientatie`: die van de Pagina-instelling,
 * of bij Automatisch draaien die van de getoonde pagina.
 *
 * @param {{ paginaInstelling: object|null, docId: any, autoRotate: boolean,
 *           printerPapier: object|null|undefined,
 *           opdrachtPapier?: object|null|undefined,
 *           pagina?: { breedtePt: number, hoogtePt: number }|null }} p
 * @returns {{ bron: 'paginaInstelling'|'printer'|'onbekend'|'laden',
 *             papier: string, naam: string,
 *             breedteMm: number|null, hoogteMm: number|null,
 *             orientatie: 'portrait'|'landscape',
 *             geweigerd: string|null }}
 */
export function effectiefPapier({
  paginaInstelling, docId, autoRotate, printerPapier, opdrachtPapier = undefined, pagina = null,
}) {
  const args = printArgumenten({ autoRotate, paginaInstelling, docId });

  let bron;
  let papier = 'printer';
  let naam = '';
  let kort = null;
  let lang = null;
  let terugval = 'portrait';
  let geweigerd = null;

  const gevraagd = isPapierFormaat(args.papier) ? args.papier : null;
  const gemeld = opdrachtPapier ? normaliseerPapierInfo(opdrachtPapier) : null;
  if (gevraagd && anderVel(gemeld, gevraagd)) {
    // De driver neemt het formaat niet over: het papier van de printer.
    const f = PAPIERFORMATEN[gemeld.papier];
    bron = 'printer';
    papier = gemeld.papier;
    naam = f ? f.label : gemeld.naam;
    kort = f ? f.breedte : gemeld.breedteMm;
    lang = f ? f.hoogte : gemeld.hoogteMm;
    terugval = paginaInstelling.orientation;
    geweigerd = PAPIERFORMATEN[gevraagd].label;
  } else if (gevraagd) {
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
    geweigerd,
  };
}

/**
 * Sleutel waaronder de printdialoog het antwoord van printer_papier bewaart:
 * het antwoord hangt af van de printer én van het papier dat erom vroeg.
 */
export function papierVerzoekSleutel(printer, papier) {
  return `${printer}\n${isPapierFormaat(papier) ? papier : 'printer'}`;
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

/**
 * De kop van het voorbeeld: het vel met zijn stand en de maten zoals het
 * ligt, "A2 liggend (594 × 420 mm)". `plaatsing` komt uit berekenPlaatsing
 * (print-plaatsing.js): het vel zoals het uit de printer komt of in het
 * bestand komt te liggen. `naam` is de naam van het vel ("A2", een
 * formuliernaam, de tekst voor de printerstandaard) of null: dan alleen de
 * maten. Een onbekend vel (plaatsing.bekend false: de printer past de pagina
 * zelf in) toont geen maten, want die zijn niet die van het vel.
 * `t` vertaalt 'print.sheetPortrait' / 'print.sheetLandscape' met {{paper}}.
 * null = niets te tonen.
 */
export function velTekst(plaatsing, naam, t) {
  if (!plaatsing || !plaatsing.vel) return null;
  const { breedteMm, hoogteMm, orientatie } = plaatsing.vel;
  const maten = plaatsing.bekend && geldig(breedteMm) && geldig(hoogteMm)
    ? `${Math.round(breedteMm)} × ${Math.round(hoogteMm)} mm`
    : null;
  const papier = naam || maten;
  if (!papier) return null;
  const tekst = t(orientatie === 'landscape' ? 'print.sheetLandscape' : 'print.sheetPortrait', { paper: papier });
  return naam && maten && !NAAM_MET_MATEN.test(naam) ? `${tekst} (${maten})` : tekst;
}

/**
 * De schaal waarop de pagina op het vel komt, in hele procenten (A2 passend
 * op A3 → 71). `plaatsing` komt uit berekenPlaatsing; daarin zitten het
 * schaaltype, de zoom, de draaiing en de marges van de printer al. Minstens
 * 1, zodat een heel kleine schaal niet als 0 % leest. null bij een onbekend
 * vel (dan past de printer de pagina zelf in) of een onbruikbare schaal.
 */
export function schaalProcent(plaatsing) {
  if (!plaatsing || !plaatsing.bekend || !geldig(plaatsing.schaal)) return null;
  return Math.max(1, Math.round(plaatsing.schaal * 100));
}

/**
 * De naam van een vel op paginamaat (papier 'pagina' in print-plaatsing.js):
 * het formaat uit de lijst dat bij de pagina past ("A2"), anders null.
 */
export function velNaam(pagina) {
  if (!pagina) return null;
  const f = PAPIERFORMATEN[paginaFormaat(pagina.breedtePt, pagina.hoogtePt)];
  return f ? f.label : null;
}

/**
 * Het vel waarop het voorbeeld en de printopdracht de schaal en de plek van de
 * pagina uitrekenen (print-plaatsing.js): het papier uit de kop als het
 * bekend is en maten heeft. Anders null: Linux/macOS zonder
 * Pagina-instelling, een driver die niets meldt, een formulier zonder maten,
 * of het antwoord loopt nog. Dan blijft het gedrag van vóór de schaalkeuze
 * (de printer past de pagina in).
 *
 * @param {ReturnType<typeof effectiefPapier>|null} effectief
 * @returns {{ breedteMm: number, hoogteMm: number } | null}  staand (kort, lang)
 */
export function bekendVel(effectief) {
  if (!effectief || (effectief.bron !== 'paginaInstelling' && effectief.bron !== 'printer')) return null;
  const { breedteMm, hoogteMm } = effectief;
  if (!geldig(breedteMm) || !geldig(hoogteMm)) return null;
  return { breedteMm: Math.min(breedteMm, hoogteMm), hoogteMm: Math.max(breedteMm, hoogteMm) };
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
