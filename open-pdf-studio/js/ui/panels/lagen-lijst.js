// De lagen (optionele inhoud) van een PDF als lijst voor het paneel Lagen.
//
// pdf.js 5 heeft geen getGroups() meer; het paneel riep die aan en toonde
// daardoor bij elk document "geen lagen" (#482). De groepen komen nu uit de
// iterator van de OptionalContentConfig ([id, groep]-paren), de boom uit
// getOrder(): de volgorde uit /OCProperties /D /Order, waarin een geneste
// groep {name, order} is. Een groep met een naam wordt een kop; groepen die
// niet in /Order staan, zet pdf.js achteraan in een groep zonder naam.
// `visible` is de stand volgens de standaardconfiguratie van het document;
// PDFium tekent een laag die daar uit staat ook niet.

/**
 * @param {object|null} config  de OptionalContentConfig van pdf.js
 * @param {{overslaan?: Set<string>}} [opties]  id's die hier niet horen
 *   (de markeringslagen van de app, die hun eigen paneel hebben)
 * @returns {({id: string, name: string, visible: boolean, depth: number}
 *   | {kop: true, name: string, depth: number})[]}
 */
export function lagenLijst(config, { overslaan = new Set() } = {}) {
  if (!config) return [];
  const groepen = new Map(config);
  if (!groepen.size) return [];

  const gehad = new Set();
  let volgnummer = 0;
  const laag = (id, depth) => {
    gehad.add(id);
    volgnummer += 1;
    const groep = groepen.get(id);
    return { id, name: groep.name || `Layer ${volgnummer}`, visible: groep.visible !== false, depth };
  };

  const regelsVan = (order, depth) => {
    const regels = [];
    for (const item of order || []) {
      if (typeof item === 'string') {
        if (groepen.has(item) && !gehad.has(item) && !overslaan.has(item)) regels.push(laag(item, depth));
      } else if (item && Array.isArray(item.order)) {
        const kop = typeof item.name === 'string' && item.name !== '';
        const onder = regelsVan(item.order, kop ? depth + 1 : depth);
        if (!onder.length) continue;
        if (kop) regels.push({ kop: true, name: item.name, depth });
        regels.push(...onder);
      }
    }
    return regels;
  };

  const regels = regelsVan(config.getOrder?.() ?? [...groepen.keys()], 0);
  for (const id of groepen.keys()) {
    if (!gehad.has(id) && !overslaan.has(id)) regels.push(laag(id, 0));
  }
  return regels;
}
