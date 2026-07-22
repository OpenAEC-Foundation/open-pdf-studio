// Parametrisch kader voor het paalpuntniveau. Het teken achter de maat wordt
// automatisch als m+ of m- opgebouwd, terwijl de referentie vrij te wijzigen is.

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

export const paalpuntniveauTemplate = {
  id: 'paalpuntniveau',
  name: 'Paalpuntniveau',
  nameEn: 'Pile toe level',
  category: 'NL Constructie',
  defaultSize: { width: 360, height: 62 },
  params: [
    { key: 'niveau', label: 'Niveau (m)', labelEn: 'Level (m)', type: 'number', default: 14, step: 0.1 },
    { key: 'decimalen', label: 'Decimalen', labelEn: 'Decimals', type: 'number', default: 1, min: 0, max: 3, step: 1 },
    { key: 'referentie', label: 'Referentie', labelEn: 'Reference', type: 'string', default: 'N.A.P.' },
  ],
  render(params = {}, bbox) {
    const inset = Math.max(1, Math.min(bbox.width, bbox.height) * 0.025);
    const x0 = bbox.x + inset;
    const y0 = bbox.y + inset;
    const x1 = bbox.x + bbox.width - inset;
    const y1 = bbox.y + bbox.height - inset;
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
        text: formatPaalpuntniveau(params.niveau, params.decimalen, params.referentie),
        size: Math.max(10, Math.min(bbox.height * 0.40, bbox.width * 0.055)),
        bold: true,
      },
    ];
  },
};
