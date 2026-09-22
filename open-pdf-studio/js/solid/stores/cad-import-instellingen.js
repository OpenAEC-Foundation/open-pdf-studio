// Instellingen van het importvenster voor DWG en DXF onthouden (#400), op
// dezelfde manier als de print- en exportinstellingen: bij "Importeren" gaan
// de keuzes naar de voorkeuren (`cadImportSettings`), bij de volgende keer
// openen komen ze terug. Opgeslagen waarden worden gecontroleerd: een
// onbekende of kapotte waarde valt terug op de standaard, zodat een oud of met
// de hand bewerkt voorkeurenbestand het venster nooit kan breken.
//
// Wat uit het bestand komt (ruimte, lagen, venster) wordt niet onthouden: een
// laag of layout van een andere tekening zegt niets over deze.

import { kleurTekst, schoonLetters, schoonPennen, schoonZoekpaden } from '../../pdf/cad-import-logica.js';
import { ONDERLEGGER_DPI } from '../../pdf/cad-import-plaatsing.js';

/** Standaardwaarden van het importvenster. */
export const CAD_IMPORT_STANDAARD = Object.freeze({
  target: 'new',
  layersAsOcg: true,
  includeOffLayers: false,
  skipNonPlottable: true,
  units: 'file',
  area: 'extents',
  scale: 0,
  paper: 'auto',
  paperWidthMm: 297,
  paperHeightMm: 420,
  orientation: 'auto',
  marginMm: 10,
  placement: 'center',
  ownBasePoint: false,
  basePointX: 0,
  basePointY: 0,
  rotation: 0,
  measure: true,
  modelMatrix: true,
  colors: 'file',
  lineweight: 'file',
  lineweightMm: 0.25,
  lineweightFactor: 1,
  lineweightMinMm: 0,
  linetypes: true,
  text: true,
  hatch: 'all',
  dimensions: true,
  attributes: true,
  points: false,
  // Tabblad Weergave, fase 6.
  monoThreshold: 50,
  singleColor: '#000000',
  pens: Object.freeze([]),
  fonts: Object.freeze([]),
  xrefs: true,
  images: true,
  searchPaths: Object.freeze([]),
  reuseBlocks: true,
  maxImageMegapixels: 200,
  // Voorbeeldweergave naast de tabbladen.
  preview: true,
  // Doel "op de huidige pagina": dekking in procenten, onder de bestaande
  // inhoud bij het vastzetten, op schaal van de pagina, en de stand "als
  // afbeelding" met haar resolutie.
  underlayOpacity: 50,
  underlayBelow: true,
  underlayToScale: true,
  underlayAsImage: false,
  underlayDpi: 300,
});

const KEUZES = Object.freeze({
  target: ['new', 'append', 'underlay'],
  units: ['file', 'mm', 'cm', 'm', 'in', 'ft'],
  area: ['extents', 'limits', 'window'],
  paper: ['auto', 'A4', 'A3', 'A3L', 'A2', 'A2L', 'A1', 'A1L', 'A0', 'Letter', 'Tabloid', 'custom'],
  orientation: ['auto', 'portrait', 'landscape'],
  placement: ['center', 'lower_left', 'origin'],
  colors: ['file', 'black', 'gray', 'mono', 'single'],
  lineweight: ['file', 'fixed', 'pens'],
  hatch: ['all', 'solid_only', 'outline', 'none'],
});

const SCHAKELAARS = [
  'layersAsOcg', 'includeOffLayers', 'skipNonPlottable', 'measure', 'modelMatrix', 'linetypes', 'text',
  'dimensions', 'attributes', 'points', 'ownBasePoint', 'xrefs', 'images', 'reuseBlocks', 'preview',
  'underlayBelow', 'underlayToScale', 'underlayAsImage',
];

const GETALLEN = Object.freeze({
  scale: [0, 1e6],
  basePointX: [-1e12, 1e12],
  basePointY: [-1e12, 1e12],
  paperWidthMm: [1, 5080],
  paperHeightMm: [1, 5080],
  marginMm: [0, 200],
  rotation: [-360, 360],
  lineweightMm: [0, 5],
  lineweightFactor: [0.1, 10],
  lineweightMinMm: [0, 5],
  monoThreshold: [0, 100],
  maxImageMegapixels: [1, 200],
  underlayOpacity: [5, 100],
});

function getal(waarde, min, max, terugval) {
  const n = Number(waarde);
  if (!Number.isFinite(n)) return terugval;
  return Math.min(max, Math.max(min, n));
}

/**
 * Opgeslagen importinstellingen terug naar een volledige, geldige set.
 * @param {unknown} opgeslagen  Inhoud van `state.preferences.cadImportSettings`.
 * @returns {typeof CAD_IMPORT_STANDAARD}
 */
export function herstelCadImportInstellingen(opgeslagen) {
  const o = opgeslagen && typeof opgeslagen === 'object' ? opgeslagen : {};
  const s = { ...CAD_IMPORT_STANDAARD };
  for (const [sleutel, toegestaan] of Object.entries(KEUZES)) {
    if (toegestaan.includes(o[sleutel])) s[sleutel] = o[sleutel];
  }
  for (const sleutel of SCHAKELAARS) {
    if (typeof o[sleutel] === 'boolean') s[sleutel] = o[sleutel];
  }
  for (const [sleutel, [min, max]] of Object.entries(GETALLEN)) {
    if (o[sleutel] !== undefined) s[sleutel] = getal(o[sleutel], min, max, CAD_IMPORT_STANDAARD[sleutel]);
  }
  // Hele getallen waar het venster hele getallen toont.
  s.monoThreshold = Math.round(s.monoThreshold);
  s.maxImageMegapixels = Math.round(s.maxImageMegapixels);
  s.underlayOpacity = Math.round(s.underlayOpacity);
  // Uit een keuzelijst komt tekst; alleen de aangeboden resoluties tellen.
  if (ONDERLEGGER_DPI.includes(Number(o.underlayDpi))) s.underlayDpi = Number(o.underlayDpi);
  s.singleColor = kleurTekst(o.singleColor) || CAD_IMPORT_STANDAARD.singleColor;
  // Lijsten: schoongemaakt door de pure regels, zodat een kapot
  // voorkeurenbestand het venster nooit kan breken. Altijd verse lijsten, nooit
  // die van de (bevroren) standaard of van de opgeslagen voorkeuren zelf.
  s.pens = schoonPennen(o.pens);
  s.fonts = schoonLetters(o.fonts);
  s.searchPaths = schoonZoekpaden(o.searchPaths);
  return s;
}

/** Hoogste aantal voorinstellingen dat bewaard wordt. */
export const MAX_VOORINSTELLINGEN = 20;

/**
 * Opgeslagen voorinstellingen controleren: elke voorinstelling heeft een naam
 * en een volledige, geldige set instellingen.
 * @param {unknown} opgeslagen  Inhoud van `state.preferences.cadImportPresets`.
 * @returns {{name:string, settings:typeof CAD_IMPORT_STANDAARD}[]}
 */
export function herstelCadImportVoorinstellingen(opgeslagen) {
  if (!Array.isArray(opgeslagen)) return [];
  const uit = [];
  for (const item of opgeslagen) {
    const naam = typeof item?.name === 'string' ? item.name.trim().slice(0, 60) : '';
    if (!naam || uit.some((v) => v.name.toLowerCase() === naam.toLowerCase())) continue;
    uit.push({ name: naam, settings: herstelCadImportInstellingen(item.settings) });
    if (uit.length >= MAX_VOORINSTELLINGEN) break;
  }
  return uit;
}

/** Voegt een voorinstelling toe of vervangt er een met dezelfde naam. */
export function metVoorinstelling(lijst, naam, instellingen) {
  const schoon = herstelCadImportVoorinstellingen(lijst);
  const nette = String(naam || '').trim().slice(0, 60);
  if (!nette) return schoon;
  const zonder = schoon.filter((v) => v.name.toLowerCase() !== nette.toLowerCase());
  return [...zonder, { name: nette, settings: herstelCadImportInstellingen(instellingen) }].slice(-MAX_VOORINSTELLINGEN);
}

/** Verwijdert een voorinstelling op naam. */
export function zonderVoorinstelling(lijst, naam) {
  return herstelCadImportVoorinstellingen(lijst).filter((v) => v.name.toLowerCase() !== String(naam || '').toLowerCase());
}
