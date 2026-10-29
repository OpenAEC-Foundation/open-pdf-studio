// Stijlvoorkeuren per annotatiesoort: welk voorvoegsel en welke sleutels in
// state.preferences bij een soort horen. Gebruikt door "Als standaardstijl
// instellen" / "Standaardstijl toepassen" (core/preferences.js), het
// eigenschappenpaneel bij een actief gereedschap en de opmaak van het actieve
// tekengereedschap (tools/gereedschap-opmaak.js, #668).
//
// Pure module zonder app-imports, zodat ook een module zonder de rest van de
// app (en zonder de import-kringloop via bridge.ts) de tabel kan lezen.

export function getStyleMapping(type) {
  const hasHatch = ['box', 'circle', 'polygon', 'cloud'].includes(type);
  switch (type) {
    case 'draw':
      return { prefix: 'draw', stroke: 'StrokeColor', width: 'LineWidth', opacity: 'Opacity' };
    case 'highlight':
      return { prefix: 'highlight', color: 'Color', opacity: 'Opacity' };
    case 'line':
      return { prefix: 'line', stroke: 'StrokeColor', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity' };
    case 'arrow':
      return { prefix: 'arrow', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', startHead: 'StartHead', endHead: 'EndHead', headSize: 'HeadSize' };
    // fillOpacity: de eigen dekking van de vulling (#685); zonder voorkeur
    // volgt de vulling de dekking.
    case 'box':
      return { prefix: 'rect', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'BorderWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', fillOpacity: 'FillOpacity', hatch: hasHatch };
    case 'circle':
      return { prefix: 'circle', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'BorderWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', fillOpacity: 'FillOpacity', hatch: hasHatch };
    // fontFamily: het gekozen lettertype gaat mee in de standaardstijl (#765).
    case 'textbox':
      return { prefix: 'textbox', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'BorderWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', fontSize: 'FontSize', fontFamily: 'FontFamily' };
    case 'callout':
      return { prefix: 'callout', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'BorderWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', fontSize: 'FontSize', fontFamily: 'FontFamily' };
    case 'polygon':
      return { prefix: 'polygon', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', fillOpacity: 'FillOpacity', hatch: hasHatch };
    case 'cloud':
      return { prefix: 'cloud', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', fillOpacity: 'FillOpacity', hatch: hasHatch };
    case 'comment':
      return { prefix: 'comment', color: 'Color', icon: 'Icon' };
    case 'polyline':
      return { prefix: 'polyline', stroke: 'StrokeColor', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity' };
    case 'filledArea':
      // Keys match what filled-area-tool.js reads at draw time
      // (filledAreaStrokeColor, filledAreaHatchPattern, …).
      return { prefix: 'filledArea', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', hatch: true };
    case 'redaction':
      return { prefix: 'redaction', overlayColor: 'OverlayColor' };
    case 'measureDistance':
      return { prefix: 'measureDist', stroke: 'StrokeColor', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', startHead: 'StartHead', endHead: 'EndHead', headSize: 'HeadSize', fontSize: 'FontSize', dimension: true };
    // noDimScale: schaal en eenheid van een meetvlak zijn geen stijl. Een
    // nieuw vlak rekent met de schaal van het document; een eigen schaal
    // hoort bij dat ene vlak en mag niet via de standaardstijl naar een
    // ander vlak (#536).
    case 'measureArea':
      return { prefix: 'measureArea', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', dimension: true, noDimScale: true, edgeLengths: 'ShowEdgeLengths' };
    case 'measurePerimeter':
      return { prefix: 'measurePerim', stroke: 'StrokeColor', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', startHead: 'StartHead', endHead: 'EndHead', headSize: 'HeadSize', dimension: true };
    default:
      return null;
  }
}
