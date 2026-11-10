// De teksten van de web-unit.
//
// Pure module. De bureaubladversie haalt haar teksten via i18next uit
// `js/i18n/locales/` (39 talen, acht naamruimten); dat brengt i18next en de
// hele naamruimte mee, honderden keren meer dan de handvol knoppen van de unit.
// De unit heeft daarom een eigen, kleine tabel. Ontbreekt een taal, dan valt
// hij terug op Engels; een gastheer kan elke tekst overschrijven via
// `OpenPdfStudio.mount(el, { labels: {...} })` of de property `labels`.

export const TEKSTEN = Object.freeze({
  en: Object.freeze({
    measure: 'Measure', comment: 'Comment', shape: 'Rectangle',
    previous: 'Previous page', next: 'Next page',
    zoomOut: 'Zoom out', zoomIn: 'Zoom in', fit: 'Fit',
    defaultComment: 'Comment', toolbar: 'Web unit toolbar',
  }),
  nl: Object.freeze({
    measure: 'Meten', comment: 'Opmerking', shape: 'Rechthoek',
    previous: 'Vorige pagina', next: 'Volgende pagina',
    zoomOut: 'Uitzoomen', zoomIn: 'Inzoomen', fit: 'Passend',
    defaultComment: 'Opmerking', toolbar: 'Werkbalk web-unit',
  }),
  de: Object.freeze({
    measure: 'Messen', comment: 'Kommentar', shape: 'Rechteck',
    previous: 'Vorherige Seite', next: 'Nächste Seite',
    zoomOut: 'Verkleinern', zoomIn: 'Vergrößern', fit: 'Einpassen',
    defaultComment: 'Kommentar', toolbar: 'Werkzeugleiste Web-Einheit',
  }),
  fr: Object.freeze({
    measure: 'Mesurer', comment: 'Commentaire', shape: 'Rectangle',
    previous: 'Page précédente', next: 'Page suivante',
    zoomOut: 'Zoom arrière', zoomIn: 'Zoom avant', fit: 'Ajuster',
    defaultComment: 'Commentaire', toolbar: 'Barre d’outils de l’unité web',
  }),
});

/**
 * De teksttabel voor een taalcode. `nl-BE` valt terug op `nl`, een onbekende
 * taal op Engels; `eigen` (van de gastheer) wint per sleutel.
 */
export function tekstenVoor(taal, eigen = null) {
  const code = String(taal || 'en').trim().toLowerCase();
  const basis = TEKSTEN[code] || TEKSTEN[code.split(/[-_]/)[0]] || TEKSTEN.en;
  const uit = { ...TEKSTEN.en, ...basis };
  if (eigen && typeof eigen === 'object') {
    for (const [k, v] of Object.entries(eigen)) {
      if (k in uit && typeof v === 'string' && v !== '') uit[k] = v;
    }
  }
  return uit;
}
