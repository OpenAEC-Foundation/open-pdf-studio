// Printinstellingen onthouden tussen printacties.
//
// De printdialoog begon elke keer weer bij de standaardwaarden en bij de
// Windows-standaardprinter. Bij "Afdrukken" bewaren we nu alle gekozen
// instellingen in de voorkeuren (`printSettings`); bij de volgende keer
// openen zet de dialoog ze terug. Opgeslagen waarden worden gecontroleerd:
// een onbekende of kapotte waarde valt terug op de standaard, zodat een oud
// of met de hand bewerkt voorkeurenbestand de dialoog nooit kan breken.

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
});

const KEUZES = Object.freeze({
  range: ['all', 'current', 'custom'],
  subset: ['all', 'odd', 'even'],
  scaling: ['fit', 'actual', 'shrink', 'custom-scale'],
  content: ['doc-and-markups', 'doc-only'],
});

const SCHAKELAARS = ['collate', 'reverseOrder', 'autoRotate', 'autoCenter', 'asImage'];

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
  if (typeof o.customPages === 'string') s.customPages = o.customPages;
  for (const sleutel of SCHAKELAARS) {
    if (typeof o[sleutel] === 'boolean') s[sleutel] = o[sleutel];
  }
  for (const [sleutel, toegestaan] of Object.entries(KEUZES)) {
    if (toegestaan.includes(o[sleutel])) s[sleutel] = o[sleutel];
  }
  return s;
}

/**
 * Welke printer staat bij het openen geselecteerd? De laatst gebruikte als die
 * nog bestaat, anders de Windows-standaardprinter, anders de eerste.
 * @param {Array<{Name?: string}>} printers
 * @param {string} voorkeur   Laatst gebruikte printer.
 * @param {string} standaard  Standaardprinter van het systeem.
 * @returns {string}
 */
export function kiesStartPrinter(printers, voorkeur, standaard) {
  const namen = (printers || []).map((p) => p && p.Name).filter(Boolean);
  if (voorkeur && namen.includes(voorkeur)) return voorkeur;
  if (standaard && namen.includes(standaard)) return standaard;
  return namen[0] || '';
}
