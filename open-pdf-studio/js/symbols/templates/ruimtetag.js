// Ruimtetag: naam, netto oppervlakte en (optioneel) nummer van een ruimte in
// één onderdeel, zoals op een bouwkundige plattegrond.
//
// De tag is een gewoon parametrisch symbool: verplaatsbaar, in het
// eigenschappenpaneel te bewerken en met al zijn parameters bewaard bij
// opslaan (OPS_Params). De koppeling met de ruimte zit in parameters die niet
// in het paneel staan: `zaadX`/`zaadY` (het zaadpunt waaruit
// `app_floorplan {action:"rooms", refresh:true}` de ruimte terugvindt) en
// `ankerX`/`ankerY` (het labelpunt van de ruimte bij de laatste plaatsing,
// zodat een verschoven tag zijn plek ten opzichte van de ruimte houdt).
//
// Naam, nummer en netto oppervlakte horen bij de RUIMTE: de tekenlaag geeft
// de tag de waarden van zijn ruimte (plattegrond/ruimte-koppeling.js). De
// eigen `naam`/`nummer`/`oppervlakteM2` zijn een reservekopie voor een tag
// zonder ruimte; de oppervlakte staat daarom niet als invulveld in het paneel.

export const RUIMTETAG_ID = 'room-tag';

/** Tekstgrootte (pt) van een nieuwe tag: ruim 3 mm op papier. */
export const RUIMTETAG_TEKST_PT = 9;

/** Stijl van een tag die de plattegrond plaatst: zwarte tekst. */
export const RUIMTETAG_STIJL = Object.freeze({
  color: '#000000', strokeColor: '#000000', lineWidth: 0.5, opacity: 1, rotation: 0,
});

const REGELAFSTAND = 1.3;        // regelhoogte als factor van de tekstgrootte
const TEKENBREEDTE = 0.6;        // gemiddelde tekenbreedte (Arial) als factor

/**
 * Waar de tag heen gaat als zijn ruimte verandert: hij houdt zijn plek ten
 * opzichte van het labelpunt (`params.ankerX/ankerY` = het labelpunt bij de
 * vorige plaatsing), zodat een tag die de gebruiker opzij schoof niet
 * terugspringt maar wel met de ruimte meeschuift. Zonder oud anker: midden
 * op het nieuwe labelpunt.
 * @returns {{ x, y }} de nieuwe linkerbovenhoek
 */
export function tagVolgtRuimte(tag, nieuwAnker) {
  const w = Number(tag?.width) || 0, h = Number(tag?.height) || 0;
  const ax = Number(tag?.params?.ankerX), ay = Number(tag?.params?.ankerY);
  let cx = nieuwAnker.x, cy = nieuwAnker.y;
  if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(tag?.x) && Number.isFinite(tag?.y)) {
    cx = tag.x + w / 2 + (nieuwAnker.x - ax);
    cy = tag.y + h / 2 + (nieuwAnker.y - ay);
  }
  return { x: cx - w / 2, y: cy - h / 2 };
}

function oppervlakteTekst(params) {
  const opp = Number(params?.oppervlakteM2);
  const dec = Math.max(0, Math.min(3, Math.round(Number(params?.decimalen ?? 1))));
  return `${(Number.isFinite(opp) ? opp : 0).toFixed(Number.isFinite(dec) ? dec : 1)} m²`;
}

/** De tekstregels van de tag, van boven naar onder. */
export function ruimteTagRegels(params = {}) {
  const regels = [];
  const nummer = String(params.nummer ?? '').trim();
  const naam = String(params.naam ?? '').trim();
  if (nummer) regels.push({ tekst: nummer, vet: false });
  if (naam) regels.push({ tekst: naam, vet: true });
  // De oppervlakte komt van de ruimte (ruimte-koppeling.js); zonder ruimte
  // en zonder eigen waarde staat er geen oppervlakte.
  if (params.toonOppervlakte !== false && Number.isFinite(Number(params.oppervlakteM2))
      && params.oppervlakteM2 !== null && params.oppervlakteM2 !== '') {
    regels.push({ tekst: oppervlakteTekst(params), vet: false });
  }
  return regels.length ? regels : [{ tekst: '?', vet: false }];
}

/**
 * Het vak van een nieuwe tag: om de tekst heen (tekstgrootte `tekstPt`), met
 * het midden op `midden` (het labelpunt van de ruimte).
 */
export function ruimteTagVak(midden, params = {}, tekstPt = 9) {
  const regels = ruimteTagRegels(params);
  const langste = Math.max(...regels.map((r) => r.tekst.length));
  const width = langste * tekstPt * TEKENBREEDTE + tekstPt;
  const height = regels.length * tekstPt * REGELAFSTAND;
  return { x: midden.x - width / 2, y: midden.y - height / 2, width, height };
}

export const ruimteTagTemplate = {
  id: RUIMTETAG_ID,
  name: 'Ruimtetag',
  nameEn: 'Room tag',
  category: 'NL',
  defaultSize: { width: 90, height: 24 },
  params: [
    { key: 'naam', label: 'Naam', labelEn: 'Name', type: 'string', default: 'Ruimte' },
    { key: 'nummer', label: 'Nummer', labelEn: 'Number', type: 'string', default: '' },
    { key: 'decimalen', label: 'Decimalen', labelEn: 'Decimals', type: 'number', default: 1, min: 0, max: 3, step: 1 },
    { key: 'toonOppervlakte', label: 'Oppervlakte tonen', labelEn: 'Show area', type: 'boolean', default: true },
  ],
  snapPoints(params, bbox) {
    return [{ kind: 'center', x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }];
  },
  render(params, bbox) {
    const regels = ruimteTagRegels(params);
    const { x, y, width: w, height: h } = bbox;
    const size = Math.max(1, h / (regels.length * REGELAFSTAND));
    const cx = x + w / 2, cy = y + h / 2;
    return regels.map((r, i) => ({
      kind: 'text',
      x: cx,
      y: cy + (i - (regels.length - 1) / 2) * size * REGELAFSTAND,
      text: r.tekst,
      size,
      bold: r.vet,
    }));
  },
};
