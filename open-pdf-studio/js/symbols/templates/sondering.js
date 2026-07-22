// Parametrisch sonderingssymbool. Met kleefmeting is de conus gevuld en
// verschijnt de horizontale kleeflijn; zonder kleefmeting blijft hij open.

export const sonderingTemplate = {
  id: 'sondering',
  name: 'Sondering',
  nameEn: 'Cone penetration test',
  category: 'NL Constructie',
  defaultSize: { width: 90, height: 120 },
  params: [
    { key: 'nummer', label: 'Nummer', labelEn: 'Number', type: 'string', default: '1' },
    { key: 'kleefmeting', label: 'Met kleefmeting', labelEn: 'With sleeve friction', type: 'boolean', default: true },
  ],
  render(params = {}, bbox) {
    const { x, y, width, height } = bbox;
    const cx = x + width * 0.38;
    const shoulderY = y + height * 0.47;
    const tipY = y + height * 0.84;
    const halfWidth = Math.min(width * 0.22, height * 0.18);
    const withFriction = params.kleefmeting !== false;
    const commands = [
      {
        kind: 'polyline',
        close: true,
        fill: withFriction,
        role: 'conus',
        points: [
          { x: cx - halfWidth, y: shoulderY },
          { x: cx + halfWidth, y: shoulderY },
          { x: cx, y: tipY },
        ],
      },
      {
        kind: 'text',
        x: x + width * 0.70,
        y: y + height * 0.28,
        text: String(params.nummer ?? '1'),
        size: Math.max(13, Math.min(width * 0.24, height * 0.22)),
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
