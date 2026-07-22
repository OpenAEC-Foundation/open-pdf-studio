// Parametrische overspanningspijl voor vloeren: instelbare werkelijke lengte
// met vrije tekst. De open pijlkoppen blijven leesbaar bij elke lengte.

function lengthMm(params) {
  const value = Number(params?.lengte);
  return Number.isFinite(value) && value > 0 ? value : 6000;
}

function layout(bbox) {
  const x0 = bbox.x + bbox.width * 0.07;
  const x1 = bbox.x + bbox.width * 0.93;
  const y = bbox.y + bbox.height * 0.70;
  const arrowLength = Math.max(7, Math.min(bbox.height * 0.16, bbox.width * 0.05));
  const arrowRise = arrowLength * 0.38;
  return { x0, x1, y, arrowLength, arrowRise };
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
  ],
  realSizeMm(params) {
    return { width: lengthMm(params), height: Math.max(500, lengthMm(params) * 0.12) };
  },
  render(params = {}, bbox) {
    const L = layout(bbox);
    return [
      { kind: 'line', x1: L.x0, y1: L.y, x2: L.x1, y2: L.y, role: 'pijllijn' },
      {
        kind: 'polyline',
        role: 'pijlpunt',
        points: [
          { x: L.x0 + L.arrowLength, y: L.y - L.arrowRise },
          { x: L.x0, y: L.y },
          { x: L.x0 + L.arrowLength, y: L.y + L.arrowRise },
        ],
      },
      {
        kind: 'polyline',
        role: 'pijlpunt',
        points: [
          { x: L.x1 - L.arrowLength, y: L.y - L.arrowRise },
          { x: L.x1, y: L.y },
          { x: L.x1 - L.arrowLength, y: L.y + L.arrowRise },
        ],
      },
      {
        kind: 'text',
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height * 0.32,
        text: String(params.tekst ?? 'Overspanningsrichting vloer'),
        size: Math.max(10, Math.min(bbox.height * 0.30, bbox.width * 0.055)),
      },
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
