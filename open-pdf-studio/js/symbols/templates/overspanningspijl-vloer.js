// Parametrische overspanningspijl voor vloeren: instelbare werkelijke lengte
// met vrije tekst boven de pijllijn. De pijlkoppen zijn dichte (gevulde)
// driehoeken en blijven leesbaar bij elke lengte.

function lengthMm(params) {
  const value = Number(params?.lengte);
  return Number.isFinite(value) && value > 0 ? value : 6000;
}

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

function layout(bbox) {
  const x0 = bbox.x + bbox.width * 0.07;
  const x1 = bbox.x + bbox.width * 0.93;
  const y = bbox.y + bbox.height * 0.70;
  const arrowLength = Math.min(
    Math.max(7, Math.min(bbox.height * 0.16, bbox.width * 0.05)),
    bbox.width * 0.2,
  );
  const arrowRise = Math.min(arrowLength * 0.38, bbox.height * 0.22);
  return { x0, x1, y, arrowLength, arrowRise };
}

// De tekst staat gecentreerd boven de pijllijn, in de strook tussen de
// bovenrand van het kader en de bovenkant van de pijlpunten. De letter krimpt
// tot de tekst binnen de breedte van het kader past.
function textCommand(params, bbox, topOfArrow) {
  const text = String(params.tekst ?? 'Overspanningsrichting vloer');
  const band = Math.max(0, topOfArrow - bbox.y);
  const widthPerSize = estimateTextWidth(text, 1);
  const fitWidth = widthPerSize > 0 ? (bbox.width * 0.96) / widthPerSize : Infinity;
  const size = Math.min(bbox.height * 0.30, bbox.width * 0.055, band * 0.85, fitWidth);
  return {
    kind: 'text',
    x: bbox.x + bbox.width / 2,
    y: bbox.y + band / 2,
    text,
    size,
  };
}

export const overspanningspijlVloerTemplate = {
  id: 'overspanningspijl-vloer',
  name: 'Overspanningspijl vloer',
  nameEn: 'Floor span arrow',
  category: 'NL Constructie',
  defaultSize: { width: 360, height: 70 },
  fixedSize: true,
  params: [
    { key: 'lengte', label: 'Lengte (mm)', labelEn: 'Length (mm)', type: 'number', default: 6000, min: 1, step: 100 },
    { key: 'tekst', label: 'Tekst', labelEn: 'Text', type: 'string', default: 'Overspanningsrichting vloer' },
    // #936: de hele pijlpunten lijken op een maatlijn; de halve pijlpunten
    // (⥋, links de weerhaak omlaag, rechts omhoog) zijn het alternatief.
    // De waarde 'open' blijft bestaan voor opgeslagen symbolen; de kop zelf is
    // een dichte driehoek.
    {
      key: 'pijlvorm', label: 'Pijlpunten', labelEn: 'Arrowheads', type: 'enum',
      options: [
        { value: 'open', label: 'Dichte pijlpunten' },
        { value: 'half', label: 'Halve pijlpunten (⥋)' },
      ],
      default: 'open',
    },
  ],
  realSizeMm(params) {
    return { width: lengthMm(params), height: Math.max(500, lengthMm(params) * 0.12) };
  },
  render(params = {}, bbox) {
    const L = layout(bbox);
    const pijllijn = { kind: 'line', x1: L.x0, y1: L.y, x2: L.x1, y2: L.y, role: 'pijllijn' };
    if (params.pijlvorm === 'half') {
      // Eén gevulde halve driehoek per uiteinde, langer en schuiner dan de
      // dichte kop zodat hij als pijl blijft lezen. De schuine zijde blijft
      // daarnaast als lijn (de weerhaak) aanwezig.
      const len = L.arrowLength * 1.5;
      const rise = Math.min(len * 0.6, bbox.height * 0.28);
      return [
        pijllijn,
        {
          kind: 'polyline',
          close: true,
          fill: true,
          role: 'pijlpuntvulling',
          points: [
            { x: L.x0, y: L.y },
            { x: L.x0 + len, y: L.y },
            { x: L.x0 + len, y: L.y + rise },
          ],
        },
        {
          kind: 'polyline',
          close: true,
          fill: true,
          role: 'pijlpuntvulling',
          points: [
            { x: L.x1, y: L.y },
            { x: L.x1 - len, y: L.y },
            { x: L.x1 - len, y: L.y - rise },
          ],
        },
        { kind: 'line', x1: L.x0, y1: L.y, x2: L.x0 + len, y2: L.y + rise, role: 'pijlpunt' },
        { kind: 'line', x1: L.x1, y1: L.y, x2: L.x1 - len, y2: L.y - rise, role: 'pijlpunt' },
        textCommand(params, bbox, L.y - rise),
      ];
    }
    return [
      pijllijn,
      {
        kind: 'polyline',
        close: true,
        fill: true,
        role: 'pijlpunt',
        points: [
          { x: L.x0 + L.arrowLength, y: L.y - L.arrowRise },
          { x: L.x0, y: L.y },
          { x: L.x0 + L.arrowLength, y: L.y + L.arrowRise },
        ],
      },
      {
        kind: 'polyline',
        close: true,
        fill: true,
        role: 'pijlpunt',
        points: [
          { x: L.x1 - L.arrowLength, y: L.y - L.arrowRise },
          { x: L.x1, y: L.y },
          { x: L.x1 - L.arrowLength, y: L.y + L.arrowRise },
        ],
      },
      textCommand(params, bbox, L.y - L.arrowRise),
    ];
  },
  snapPoints(_params, bbox) {
    const L = layout(bbox);
    return [
      { x: L.x0, y: L.y, kind: 'endpoint' },
      { x: (L.x0 + L.x1) / 2, y: L.y, kind: 'midpoint' },
      { x: L.x1, y: L.y, kind: 'endpoint' },
    ];
  },
};
