// Het annotatiemodel van de web-unit is dat van de bureaubladversie.
//
// Pure module: geen DOM, geen state. De unit maakt annotaties met dezelfde
// soorten en velden als de app (`js/tools/annotation-creators.js`):
//
//   measureDistance  startX, startY, endX, endY, strokeColor, lineWidth,
//                    measureText, measureValue, measureUnit, measurePixels
//   comment          x, y, text, color, icon          (notitie, /Text)
//   box              x, y, width, height, strokeColor, fillColor, lineWidth
//
// Coordinaten in paginapunten, oorsprong linksboven, y naar beneden — net als
// de app. Een gastheer die `getAnnotations()` leest krijgt dus dezelfde vorm als
// de MCP-brug van de bureaubladversie teruggeeft.
//
// De eerste snede van de unit gebruikte eigen namen (`note` met `contents`,
// `square` met `breedte`/`hoogte`). Die blijven bij het inlezen geaccepteerd,
// zodat een gastheer die ze al bewaarde niets verliest.

export const SOORTEN = Object.freeze(['measureDistance', 'comment', 'box']);

const OUDE_SOORT = Object.freeze({ note: 'comment', square: 'box' });

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));

/**
 * Eén annotatie naar het app-model brengen. Geeft `null` voor iets dat geen
 * annotatie van een ondersteunde soort is. Muteert de invoer niet.
 */
export function naarAppModel(ann) {
  if (!ann || typeof ann !== 'object') return null;
  const type = OUDE_SOORT[ann.type] || ann.type;
  if (!SOORTEN.includes(type)) return null;
  const uit = { ...ann, type };
  if (type === 'comment') {
    if (uit.text == null && uit.contents != null) uit.text = String(uit.contents);
    delete uit.contents;
    if (!uit.icon) uit.icon = 'comment';
  } else if (type === 'box') {
    if (uit.width == null && uit.breedte != null) uit.width = getal(uit.breedte);
    if (uit.height == null && uit.hoogte != null) uit.height = getal(uit.hoogte);
    delete uit.breedte;
    delete uit.hoogte;
    // Een gesleepte rechthoek kan negatief uitvallen; het model kent alleen
    // een positieve maat met de linkerbovenhoek als oorsprong.
    if (uit.width < 0) { uit.x = getal(uit.x) + uit.width; uit.width = -uit.width; }
    if (uit.height < 0) { uit.y = getal(uit.y) + uit.height; uit.height = -uit.height; }
  }
  if (uit.page == null) uit.page = 1;
  return uit;
}

/** Een hele lijst naar het app-model; onbekende soorten vallen weg. */
export function lijstNaarAppModel(lijst) {
  if (!Array.isArray(lijst)) return [];
  const uit = [];
  for (const a of lijst) {
    const m = naarAppModel(a);
    if (m) uit.push(m);
  }
  return uit;
}

/**
 * Een losse kopie voor de gastheer: gewone JSON-waarden, zodat hij de lijst
 * kan bewaren of versturen zonder de laag van de unit te raken.
 */
export function kopieVoorGastheer(lijst) {
  return JSON.parse(JSON.stringify(lijst || []));
}
