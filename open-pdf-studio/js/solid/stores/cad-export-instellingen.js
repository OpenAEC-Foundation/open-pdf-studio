// Instellingen van het exportvenster voor DXF/DWG onthouden (#400), op dezelfde
// manier als de printinstellingen: bij "Exporteren" gaan alle keuzes naar de
// voorkeuren (`cadExportSettings`), bij de volgende keer openen komen ze terug.
// Opgeslagen waarden worden gecontroleerd: een onbekende of kapotte waarde valt
// terug op de standaard, zodat een oud of met de hand bewerkt voorkeurenbestand
// het venster nooit kan breken. Het gebied en de uitgesloten lagen horen bij
// één document en worden niet onthouden.

/** Standaardwaarden van het exportvenster. */
export const CAD_EXPORT_STANDAARD = Object.freeze({
  format: 'dxf',
  version: 'r2013',
  range: 'current',
  customPages: '',
  units: 'mm',
  scaleMode: 'measure',
  customScale: 100,
  layers: 'ocg_then_style',
  annotations: false,
  origin: 'page',
  offsetX: 0,
  offsetY: 0,
  curves: 'flatten',
  curveToleranceMm: 0.01,
  mergeCollinear: true,
  joinConnected: true,
  fills: 'hatch',
  skipPageFills: true,
  text: true,
  textHeightFactor: 0.72,
});

const KEUZES = Object.freeze({
  format: ['dxf', 'dxf_binary', 'dwg'],
  version: ['r2004', 'r2010', 'r2013', 'r2018'],
  range: ['current', 'all', 'custom'],
  units: ['mm', 'cm', 'm', 'in'],
  scaleMode: ['paper', 'measure', 'custom'],
  layers: ['ocg_then_style', 'style', 'single'],
  origin: ['page', 'area', 'model'],
  curves: ['flatten', 'spline'],
  fills: ['hatch', 'outline', 'skip'],
});

const SCHAKELAARS = ['annotations', 'mergeCollinear', 'joinConnected', 'skipPageFills', 'text'];

function getal(waarde, min, max, terugval) {
  const n = Number(waarde);
  if (!Number.isFinite(n)) return terugval;
  return Math.min(max, Math.max(min, n));
}

/**
 * Opgeslagen exportinstellingen terug naar een volledige, geldige set.
 * @param {unknown} opgeslagen  Inhoud van `state.preferences.cadExportSettings`.
 * @returns {typeof CAD_EXPORT_STANDAARD}
 */
export function herstelCadExportInstellingen(opgeslagen) {
  const o = opgeslagen && typeof opgeslagen === 'object' ? opgeslagen : {};
  const s = { ...CAD_EXPORT_STANDAARD };
  for (const [sleutel, toegestaan] of Object.entries(KEUZES)) {
    if (toegestaan.includes(o[sleutel])) s[sleutel] = o[sleutel];
  }
  for (const sleutel of SCHAKELAARS) {
    if (typeof o[sleutel] === 'boolean') s[sleutel] = o[sleutel];
  }
  if (typeof o.customPages === 'string') s.customPages = o.customPages.slice(0, 200);
  if (o.customScale !== undefined) s.customScale = getal(o.customScale, 0.01, 1000000, CAD_EXPORT_STANDAARD.customScale);
  if (o.offsetX !== undefined) s.offsetX = getal(o.offsetX, -1e12, 1e12, 0);
  if (o.offsetY !== undefined) s.offsetY = getal(o.offsetY, -1e12, 1e12, 0);
  if (o.curveToleranceMm !== undefined) s.curveToleranceMm = getal(o.curveToleranceMm, 0.001, 1, CAD_EXPORT_STANDAARD.curveToleranceMm);
  if (o.textHeightFactor !== undefined) s.textHeightFactor = getal(o.textHeightFactor, 0.3, 2, CAD_EXPORT_STANDAARD.textHeightFactor);
  return s;
}
