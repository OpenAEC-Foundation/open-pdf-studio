// Parametrisch sonderingssymbool. Een uitgevoerde sondering heeft een gevulde
// conus, een nog niet uitgevoerde een open conus. Met kleefmeting verschijnt
// de horizontale kleeflijn onder de conuspunt.

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

export const sonderingTemplate = {
  id: 'sondering',
  name: 'Sondering',
  nameEn: 'Cone penetration test',
  category: 'NL Constructie',
  defaultSize: { width: 90, height: 120 },
  params: [
    { key: 'nummer', label: 'Nummer', labelEn: 'Number', type: 'string', default: '1' },
    { key: 'kleefmeting', label: 'Met kleefmeting', labelEn: 'With sleeve friction', type: 'boolean', default: false },
    { key: 'uitgevoerd', label: 'Uitgevoerd', labelEn: 'Carried out', type: 'boolean', default: true },
  ],
  render(params = {}, bbox) {
    const { x, y, width, height } = bbox;
    const cx = x + width * 0.38;
    const shoulderY = y + height * 0.47;
    const tipY = y + height * 0.84;
    const halfWidth = Math.min(width * 0.22, height * 0.18);
    const withFriction = params.kleefmeting === true;
    const carriedOut = params.uitgevoerd !== false;
    // Het nummer staat boven de conus. Een lang nummer schuift naar links en
    // krimpt zo nodig, zodat het binnen het kader blijft.
    const text = String(params.nummer ?? '1');
    const widthPerSize = estimateTextWidth(text, 1, true);
    const size = Math.min(
      Math.min(width * 0.24, height * 0.22) * 1.5,
      widthPerSize > 0 ? (width * 0.96) / widthPerSize : Infinity,
    );
    const halfText = (widthPerSize * size) / 2;
    const textX = Math.max(x + halfText, Math.min(x + width * 0.70, x + width - halfText));
    const commands = [
      {
        kind: 'polyline',
        close: true,
        fill: carriedOut,
        role: 'conus',
        points: [
          { x: cx - halfWidth, y: shoulderY },
          { x: cx + halfWidth, y: shoulderY },
          { x: cx, y: tipY },
        ],
      },
      {
        kind: 'text',
        x: textX,
        y: y + height * 0.28,
        text,
        size,
        bold: true,
      },
    ];
    if (withFriction) {
      commands.push({
        kind: 'line',
        role: 'kleeflijn',
        x1: cx - halfWidth * 1.4,
        y1: tipY,
        x2: cx + halfWidth * 1.4,
        y2: tipY,
      });
    }
    return commands;
  },
  snapPoints(_params, bbox) {
    const cx = bbox.x + bbox.width * 0.38;
    const tipY = bbox.y + bbox.height * 0.84;
    return [{ x: cx, y: tipY, kind: 'endpoint' }];
  },
};
