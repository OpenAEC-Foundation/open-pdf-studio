// Printinstellingen onthouden tussen printacties.
//
// De printdialoog begon elke keer weer bij de standaardwaarden en bij de
// Windows-standaardprinter. Bij "Afdrukken" bewaren we nu alle gekozen
// instellingen in de voorkeuren (`printSettings`); bij de volgende keer
// openen zet de dialoog ze terug. Opgeslagen waarden worden gecontroleerd:
// een onbekende of kapotte waarde valt terug op de standaard, zodat een oud
// of met de hand bewerkt voorkeurenbestand de dialoog nooit kan breken.

import { isPdfDoel } from '../../pdf/print-doel.js';
import {
  KATERN_KEUZES, BOEKJE_BINDINGEN, BOEKJE_KANTEN, geldigeKruip,
} from '../../pdf/print-boekje.js';
import { KLEUR_MODI, KLEUR_STANDAARD } from '../../pdf/print-kleur.js';

/** Standaardwaarden van de printdialoog. */
export const PRINT_STANDAARD = Object.freeze({
  printer: '',
  copies: 1,
  collate: false,
  range: 'all',
  customPages: '',
  subset: 'all',
  reverseOrder: false,
  scaling: 'fit',
  zoom: 100,
  autoRotate: true,
  autoCenter: true,
  content: 'doc-and-markups',
  asImage: false,
  // Kleurmodus (#754, print-kleur.js): kleur, grijswaarden of zwart-wit.
  colorMode: KLEUR_STANDAARD,
  perSheet: '1',
  sheetCols: 2,
  sheetRows: 2,
  sheetOrder: 'horizontal',
  sheetBorder: false,
  // Posterafdruk (Type "Poster", print-poster.js).
  posterScale: 100,
  posterOverlap: 10,
  posterCutMarks: true,
  posterLabels: true,
  posterOnlyLarge: true,
  // Folder (#607): kopieën van dezelfde pagina per vel, met snijtekens.
  flyerCount: '4',
  flyerCutMarks: true,
  // Boekje in katernen (#607): vellen per katern, 0 = één boekje.
  bookletSheets: 0,
  // Boekje-opties (#607, print-boekje.js): rug links of rechts, welke kanten,
  // achterkanten gedraaid (printer kantelt over de lange zijde), kruip in mm.
  bookletBinding: 'left',
  bookletSides: 'both',
  bookletRotateBack: false,
  bookletCreep: 0,
});

/** De toegestane waarden per keuzelijst van de printdialoog. */
export const PRINT_KEUZES = Object.freeze({
  range: ['all', 'current', 'custom'],
  subset: ['all', 'odd', 'even'],
  scaling: ['fit', 'actual', 'shrink', 'custom-scale', 'poster'],
  content: ['doc-and-markups', 'doc-only'],
  colorMode: [...KLEUR_MODI],
  perSheet: ['1', '2', '4', '6', '9', '16', 'custom', 'flyer', 'booklet'],
  flyerCount: ['2', '4', '6', '8', '9', '16'],
  sheetOrder: ['horizontal', 'horizontal-reversed', 'vertical', 'vertical-reversed'],
  bookletBinding: [...BOEKJE_BINDINGEN],
  bookletSides: [...BOEKJE_KANTEN],
});

const KEUZES = PRINT_KEUZES;

/**
 * Tekent de afdruk de markeringen (annotatielaag)? "Afdrukken: Document"
 * (`doc-only`) laat ze weg; watermerken en tekstbewerkingen blijven, dat is
 * inhoud van het document. Een onbekende waarde telt als de standaard van de
 * dialoog: document én markeringen.
 */
export function markeringenVoorInhoud(inhoud) {
  return inhoud !== 'doc-only';
}

const SCHAKELAARS = [
  'collate', 'reverseOrder', 'autoRotate', 'autoCenter', 'asImage', 'sheetBorder',
  'posterCutMarks', 'posterLabels', 'posterOnlyLarge', 'flyerCutMarks', 'bookletRotateBack',
];

function geheelGetal(waarde, min, max, terugval) {
  const n = Number(waarde);
  if (!Number.isFinite(n)) return terugval;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Opgeslagen printinstellingen terug naar een volledige, geldige set.
 * @param {unknown} opgeslagen  Inhoud van `state.preferences.printSettings`.
 * @returns {typeof PRINT_STANDAARD}
 */
export function herstelPrintInstellingen(opgeslagen) {
  const o = opgeslagen && typeof opgeslagen === 'object' ? opgeslagen : {};
  const s = { ...PRINT_STANDAARD };
  if (typeof o.printer === 'string') s.printer = o.printer;
  if (o.copies !== undefined) s.copies = geheelGetal(o.copies, 1, 999, PRINT_STANDAARD.copies);
  if (o.zoom !== undefined) s.zoom = geheelGetal(o.zoom, 10, 400, PRINT_STANDAARD.zoom);
  if (o.sheetCols !== undefined) s.sheetCols = geheelGetal(o.sheetCols, 1, 10, PRINT_STANDAARD.sheetCols);
  if (o.sheetRows !== undefined) s.sheetRows = geheelGetal(o.sheetRows, 1, 10, PRINT_STANDAARD.sheetRows);
  if (o.posterScale !== undefined) s.posterScale = geheelGetal(o.posterScale, 10, 400, PRINT_STANDAARD.posterScale);
  if (o.posterOverlap !== undefined) {
    const n = Number(o.posterOverlap);
    if (Number.isFinite(n)) s.posterOverlap = Math.min(50, Math.max(0, Math.round(n * 10) / 10));
  }
  if (typeof o.customPages === 'string') s.customPages = o.customPages;
  if (KATERN_KEUZES.includes(o.bookletSheets)) s.bookletSheets = o.bookletSheets;
  if (o.bookletCreep !== undefined) s.bookletCreep = geldigeKruip(o.bookletCreep);
  for (const sleutel of SCHAKELAARS) {
    if (typeof o[sleutel] === 'boolean') s[sleutel] = o[sleutel];
  }
  for (const [sleutel, toegestaan] of Object.entries(KEUZES)) {
    const waarde = typeof o[sleutel] === 'number' ? String(o[sleutel]) : o[sleutel];
    if (toegestaan.includes(waarde)) s[sleutel] = waarde;
  }
  return s;
}

/**
 * De afdrukwijze (#607) bovenaan de printdialoog: gewoon (één pagina per
 * vel), meerdere pagina's per vel, folder, boekje of poster. Geen eigen
 * instelling: de wijze volgt uit de bewaarde schaalkeuze en het aantal per
 * vel, zodat oude voorkeuren gewoon blijven werken.
 */
export const PRINT_MODI = Object.freeze(['normal', 'multiple', 'flyer', 'booklet', 'poster']);

/** De keuzes voor pagina's per vel bij de wijze "Meerdere". */
export const MEER_PER_BLAD_KEUZES = Object.freeze(['2', '4', '6', '9', '16', 'custom']);

const GEWONE_SCHALEN = PRINT_KEUZES.scaling.filter((s) => s !== 'poster');

/** De wijze bij een schaalkeuze en een aantal per vel; de poster gaat voor. */
export function printModus({ scaling, perSheet } = {}) {
  if (scaling === 'poster') return 'poster';
  if (perSheet === 'booklet') return 'booklet';
  if (perSheet === 'flyer') return 'flyer';
  if (MEER_PER_BLAD_KEUZES.includes(String(perSheet))) return 'multiple';
  return 'normal';
}

/**
 * De schaalkeuze en het aantal per vel na een klik op wijze `modus`.
 * `onthouden.schaling`: de laatste gewone schaal (terug van de poster);
 * `onthouden.meer`: het laatste raster bij Meerdere. De poster laat het
 * aantal per vel staan. Een onbekende wijze verandert niets.
 * @returns {{scaling:string, perSheet:string}}
 */
export function naarModus(modus, { scaling, perSheet }, { meer = '2', schaling = 'fit' } = {}) {
  if (!PRINT_MODI.includes(modus)) return { scaling, perSheet };
  if (modus === 'poster') return { scaling: 'poster', perSheet };
  const gewoon = scaling === 'poster' ? (GEWONE_SCHALEN.includes(schaling) ? schaling : 'fit') : scaling;
  if (modus === 'normal') return { scaling: gewoon, perSheet: '1' };
  if (modus === 'flyer') return { scaling: gewoon, perSheet: 'flyer' };
  if (modus === 'booklet') return { scaling: gewoon, perSheet: 'booklet' };
  const raster = MEER_PER_BLAD_KEUZES.includes(String(perSheet)) ? String(perSheet)
    : MEER_PER_BLAD_KEUZES.includes(String(meer)) ? String(meer) : '2';
  return { scaling: gewoon, perSheet: raster };
}

/**
 * Welke printer staat bij het openen geselecteerd? De laatst gebruikte als die
 * nog bestaat, anders de Windows-standaardprinter, anders de eerste. Het doel
 * "Opslaan als PDF" (print-doel.js) is geen printer en bestaat altijd: was dat
 * het laatst gebruikte doel, dan komt het terug.
 * @param {Array<{Name?: string}>} printers
 * @param {string} voorkeur   Laatst gebruikte printer.
 * @param {string} standaard  Standaardprinter van het systeem.
 * @returns {string}
 */
export function kiesStartPrinter(printers, voorkeur, standaard) {
  const namen = (printers || []).map((p) => p && p.Name).filter(Boolean);
  if (isPdfDoel(voorkeur)) return voorkeur;
  if (voorkeur && namen.includes(voorkeur)) return voorkeur;
  if (standaard && namen.includes(standaard)) return standaard;
  return namen[0] || '';
}
