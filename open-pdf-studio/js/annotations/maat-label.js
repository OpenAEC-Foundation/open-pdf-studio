// De tekst bij een maatlijn: wat er staat en hoe ver hij van de lijn af staat.
//
// Puur, zonder canvas of app-state: het scherm (rendering/measurements.js),
// de opgeslagen appearance (saver/appearance-vectors.js) en de plattegrond
// (plattegrond/maatvoering.js, voor de afstand tussen maatketting en
// totaalmaat) rekenen met dezelfde regels.

// Een eenheid achter het laatste getal: letters (mm, m, ft, …), eventueel met
// ² of ³, of een graden-/voet-/inchteken.
const EENHEID_ACHTERAAN = /(\d)\s*(?:[A-Za-zµ]+[²³]?|[°'"])$/;

/**
 * De tekst die op het blad komt. `toonEenheid === false` laat de eenheid
 * achter het getal weg ("1550 mm" → "1550"): op een bouwtekening is de
 * tekeneenheid bekend en staat er alleen het getal. De opgeslagen
 * `measureText` houdt zijn eenheid; alleen de weergave verandert.
 */
export function maatlijnTekst(measureText, toonEenheid = true) {
  const tekst = typeof measureText === 'string' ? measureText : '';
  if (toonEenheid !== false) return tekst;
  return tekst.replace(EENHEID_ACHTERAAN, '$1');
}

/**
 * Hoe ver een eindmarkering dwars op de maatlijn uitsteekt, in punten. Volgt
 * de tekenregels in rendering/decorations.js (drawArrowheadOnCanvas).
 */
export function kopUitsteek(stijl, grootte = 12) {
  const s = Number(grootte) > 0 ? Number(grootte) : 12;
  switch (stijl ?? 'openCircle') {
    case 'none': return 0;
    case 'openCircle': return 4;                       // vaste straal
    case 'circle':
    case 'square': return s / 3;
    case 'diamond': return (s / 2) * 0.6;
    case 'slash': return (s / 2) * Math.cos(Math.PI / 6); // 30° gekanteld
    case 'butt': return s / 2;
    default: return s * Math.tan(Math.PI / 6);        // open/dichte pijl
  }
}

/**
 * Afstand van de maatlijn tot de onderkant van het tekstvak, in punten. De
 * oude regel (max(3, 0,35 x teksthoogte)) lag lager dan het open rondje van
 * 4 pt, zodat een tekst die breder is dan zijn maat over de markeringen viel.
 * Nu ligt de tekst altijd vrij boven de grootste markering.
 */
export function maatTekstMarge({ fontSize, startHead, endHead, headSize } = {}) {
  const fs = Number(fontSize) > 0 ? Number(fontSize) : 11;
  const kop = Math.max(kopUitsteek(startHead, headSize), kopUitsteek(endHead, headSize));
  const basis = Math.max(3, fs * 0.35);
  return kop > 0 ? Math.max(basis, kop + 1.5) : basis;
}

/**
 * De strook die één tekstregel boven een maatlijn inneemt, tot en met de
 * markering van de volgende lijn erboven: zo ver moeten twee evenwijdige
 * maatlijnen (ketting en totaal) minstens uit elkaar liggen. In punten.
 */
export function maatTekstStrook(opties = {}) {
  const fs = Number(opties.fontSize) > 0 ? Number(opties.fontSize) : 11;
  const kop = Math.max(kopUitsteek(opties.startHead, opties.headSize), kopUitsteek(opties.endHead, opties.headSize));
  return maatTekstMarge(opties) + fs + kop + 1.5;
}

/**
 * Hoek (radialen, y omlaag) waaronder de maattekst staat: langs de lijn, maar
 * nooit op zijn kop. Een staande maat leest van rechts — van onder naar
 * boven — ongeacht de richting waarin de lijn getekend is.
 */
export function leesbareHoek(hoek) {
  let a = Number(hoek) || 0;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  const eps = 1e-9;
  if (a > Math.PI / 2 - eps) a -= Math.PI;
  else if (a < -Math.PI / 2 - eps) a += Math.PI;
  return a;
}

/**
 * Hoe ver de maattekst (met zijn marge) rond de maatlijn kan reiken, in
 * punten: de opgeslagen appearance moet zo ruim zijn, anders knipt een andere
 * lezer de tekst boven de lijn weg. `tekst` is de getoonde tekst.
 */
export function maatLabelRuimte(opties = {}) {
  const fs = Number(opties.fontSize) > 0 ? Number(opties.fontSize) : 11;
  const tekst = typeof opties.tekst === 'string' ? opties.tekst : '';
  if (!tekst) return 5;
  const hoogte = maatTekstMarge(opties) + fs * 1.3;
  const halveBreedte = (tekst.length * fs * 0.55) / 2;
  return Math.max(5, hoogte, halveBreedte);
}
