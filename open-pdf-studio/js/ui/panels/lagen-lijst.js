// De lagen (optionele inhoud) van een PDF als lijst voor het paneel Lagen.
//
// pdf.js 5 heeft geen getGroups() meer; het paneel riep die aan en toonde
// daardoor bij elk document "geen lagen" (#482). De groepen komen nu uit de
// iterator van de OptionalContentConfig ([id, groep]-paren), de boom uit
// getOrder(): de volgorde uit /OCProperties /D /Order, waarin een geneste
// groep {name, order} is. Een groep met een naam wordt een kop; groepen die
// niet in /Order staan, zet pdf.js achteraan in een groep zonder naam.
// `visible` is de stand in de meegegeven config: de beginstand van het
// document (PDFium tekent een laag die daar uit staat ook niet), of de stand
// na schakelen in het paneel (#684).
//
// Met `boom` (pdf/lagen-boom.js, uit het bestand gelezen) volgt de lijst de
// boom van /Order zoals de PDF-standaard hem bedoelt: ook lagen onder een
// andere laag (een array zonder label na een laag), wat pdf.js weglaat. De
// boom zegt ook welke lagen vergrendeld zijn (/Locked: geen vinkje om te
// schakelen) en welke in een keuzegroep staan (/RBGroups: één aan zet de
// andere uit). Namen en stand komen altijd uit de config van pdf.js.

/**
 * @param {object|null} config  de OptionalContentConfig van pdf.js
 * @param {{overslaan?: Set<string>, boom?: object|null}} [opties]  overslaan:
 *   id's die hier niet horen (de markeringslagen van de app, die hun eigen
 *   paneel hebben); boom: uit leesLagenBoom, of null
 * @returns {({id: string, name: string, visible: boolean, depth: number,
 *   locked?: true, radio?: true}
 *   | {kop: true, name: string, depth: number})[]}
 */
export function lagenLijst(config, { overslaan = new Set(), boom = null } = {}) {
  if (boom && config) return lijstUitBoom(config, boom, overslaan);
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

function lijstUitBoom(config, boom, overslaan) {
  const groepen = new Map(config);
  if (!groepen.size) return [];
  const radio = new Set(boom.rbGroups.flat());
  const gehad = new Set();
  let volgnummer = 0;
  const laag = (id, depth) => {
    gehad.add(id);
    volgnummer += 1;
    const groep = groepen.get(id);
    const regel = { id, name: groep.name || boom.ocgs.get(id)?.name || `Layer ${volgnummer}`, visible: groep.visible !== false, depth };
    if (boom.locked.has(id)) regel.locked = true;
    if (radio.has(id)) regel.radio = true;
    return regel;
  };
  const regelsVan = (knopen, depth) => {
    const regels = [];
    for (const knoop of knopen || []) {
      if ('id' in knoop) {
        if (!groepen.has(knoop.id) || gehad.has(knoop.id)) continue;
        const toon = !overslaan.has(knoop.id);
        // Een overgeslagen laag laat zijn kinderen op zijn eigen niveau staan.
        if (toon) regels.push(laag(knoop.id, depth));
        else gehad.add(knoop.id);
        regels.push(...regelsVan(knoop.children, toon ? depth + 1 : depth));
      } else if (!knoop.label) {
        regels.push(...regelsVan(knoop.children, depth));
      } else {
        const onder = regelsVan(knoop.children, depth + 1);
        if (!onder.length) continue;
        regels.push({ kop: true, name: knoop.label, depth }, ...onder);
      }
    }
    return regels;
  };
  const regels = regelsVan(boom.order, 0);
  for (const id of groepen.keys()) {
    if (!gehad.has(id) && !overslaan.has(id)) regels.push(laag(id, 0));
  }
  return regels;
}
