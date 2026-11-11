// Parametrisch kader voor het paalpuntniveau. Het teken achter de maat wordt
// automatisch als m+ of m- opgebouwd, terwijl de referentie vrij te wijzigen is.
// De kaderbreedte volgt de tekst (breedteBijHoogte, zie symbols/real-size.js);
// in een smaller kader krimpt de letter tot het opschrift past.

// Ruime schatting van de tekstbreedte in Arial: elke tekenklasse telt met de
// breedste letter uit die klasse, zodat de schatting nooit te smal uitvalt.
export function estimateTextWidth(text, size, bold = false) {
  let em = 0;
  for (const ch of String(text ?? '')) {
    if ("iIjl.,:;!|' ".includes(ch)) em += bold ? 0.34 : 0.28;
    else if ('frt-()/'.includes(ch)) em += bold ? 0.39 : 0.34;
    else if ('mwMW%@'.includes(ch)) em += 0.95;
    else if (ch >= '0' && ch <= '9') em += 0.556;
    else if ('+=<>'.includes(ch)) em += 0.584;
    else if (ch >= 'a' && ch <= 'z') em += bold ? 0.611 : 0.556;
    else em += 0.78;
  }
  return em * size;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function formatPaalpuntniveau(niveau, decimalen = 1, referentie = 'N.A.P.') {
  const value = finiteNumber(niveau, 14);
  const digits = Math.min(3, Math.max(0, Math.round(finiteNumber(decimalen, 1))));
  const sign = value < 0 ? '-' : '+';
  return `PUNTNIVEAU: ${Math.abs(value).toFixed(digits)} m${sign} ${String(referentie || 'N.A.P.')}`;
}

// Letterhoogte en zijmarge als deel van de kaderhoogte.
const TEXT_HEIGHT = 0.40;
const SIDE_MARGIN = 0.30;

export const paalpuntniveauTemplate = {
  id: 'paalpuntniveau',
  name: 'Paalpuntniveau',
  nameEn: 'Pile toe level',
  category: 'NL Constructie',
  defaultSize: { width: 425, height: 62 },
  params: [
    { key: 'niveau', label: 'Niveau (m)', labelEn: 'Level (m)', type: 'number', default: 14, step: 0.1 },
    { key: 'decimalen', label: 'Decimalen', labelEn: 'Decimals', type: 'number', default: 1, min: 0, max: 3, step: 1 },
    { key: 'referentie', label: 'Referentie', labelEn: 'Reference', type: 'string', default: 'N.A.P.' },
  ],
  breedteBijHoogte(params = {}, hoogte) {
    if (!(hoogte > 0)) return 0;
    const text = formatPaalpuntniveau(params.niveau, params.decimalen, params.referentie);
    return estimateTextWidth(text, hoogte * TEXT_HEIGHT, true) + 2 * hoogte * SIDE_MARGIN;
  },
  render(params = {}, bbox) {
    const inset = Math.max(1, Math.min(bbox.width, bbox.height) * 0.025);
    const x0 = bbox.x + inset;
    const y0 = bbox.y + inset;
    const x1 = bbox.x + bbox.width - inset;
    const y1 = bbox.y + bbox.height - inset;
    const text = formatPaalpuntniveau(params.niveau, params.decimalen, params.referentie);
    const margin = inset + Math.min(bbox.height * 0.2, bbox.width * 0.03);
    const widthPerSize = estimateTextWidth(text, 1, true);
    const size = Math.min(
      bbox.height * TEXT_HEIGHT,
      Math.max(0, bbox.width - 2 * margin) / widthPerSize,
    );
    return [
      {
        kind: 'polyline',
        close: true,
        role: 'kader',
        points: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
      },
      {
        kind: 'text',
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
        text,
        size,
        bold: true,
      },
    ];
  },
};
