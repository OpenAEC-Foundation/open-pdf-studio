// Parametrische constructie-symbolen (#338): opleggingen, lasten,
// beddingsveren, windverband en scharnierverbinding. Schematische
// tekenkamer-symbolen — geen rekenfunctionaliteit.

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

// Oplegging en puntlast zijn opgegaan in de schematiseringssymbolen
// (schematisering.js); de ids en hun oude opzet blijven werken.
export { opleggingTemplate, puntlastTemplate } from './schematisering.js';

// ── Gelijkmatig verdeelde belasting (q-last), oude vak-variant ─────────────
// Het palet plaatst de lijnvariant 'verdeelde-last' (schematisering.js); dit
// template blijft geregistreerd voor geplaatste symbolen en de MCP-id.
export const qlastTemplate = {
  id: 'q-last',
  name: 'q-last (verdeelde belasting)',
  nameEn: 'UDL (distributed load)',
  category: 'NL Constructie',
  defaultSize: { width: 220, height: 90 },
  params: [
    { key: 'q', label: 'q (kN/m)', labelEn: 'q (kN/m)', type: 'number', default: 5, min: 0, step: 0.5 },
    { key: 'lengte', label: 'Lengte (mm)', labelEn: 'Length (mm)', type: 'number', default: 3000, min: 100, step: 100 },
  ],
  realSizeMm(params) {
    const L = num(params?.lengte, 3000);
    return { width: L, height: Math.max(600, L * 0.3) };
  },
  render(params = {}, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const bovenY = y + h * 0.38;
    const onderY = y + h * 0.92;
    const kop = h * 0.12;
    const cmds = [
      { kind: 'text', x: x + w / 2, y: y + h * 0.16, text: `q = ${num(params.q, 5)} kN/m`, size: Math.max(9, h * 0.18) },
      { kind: 'line', x1: x, y1: bovenY, x2: x + w, y2: bovenY },
      { kind: 'line', x1: x, y1: onderY, x2: x + w, y2: onderY },
    ];
    const aantal = Math.max(3, Math.round(w / (h * 0.55)));
    for (let i = 0; i < aantal; i++) {
      const px = x + (aantal === 1 ? w / 2 : (w * i) / (aantal - 1));
      cmds.push({ kind: 'line', x1: px, y1: bovenY, x2: px, y2: onderY });
      cmds.push({
        kind: 'polyline', fill: true, close: true,
        points: [
          { x: px, y: onderY },
          { x: px - kop * 0.32, y: onderY - kop },
          { x: px + kop * 0.32, y: onderY - kop },
        ],
      });
    }
    return cmds;
  },
  snapPoints(params, bbox) {
    const onderY = bbox.y + bbox.height * 0.92;
    return [
      { kind: 'endpoint', x: bbox.x, y: onderY },
      { kind: 'endpoint', x: bbox.x + bbox.width, y: onderY },
      { kind: 'midpoint', x: bbox.x + bbox.width / 2, y: onderY },
    ];
  },
};

// ── Beddingsveren (grondveren) ─────────────────────────────────────────────
export const beddingsverenTemplate = {
  id: 'beddingsveren',
  name: 'Beddingsveren',
  nameEn: 'Soil springs',
  category: 'NL Constructie',
  defaultSize: { width: 220, height: 80 },
  params: [
    { key: 'aantal', label: 'Aantal veren', labelEn: 'Spring count', type: 'number', default: 5, min: 2, max: 40, step: 1 },
  ],
  render(params = {}, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const balkY = y + h * 0.12;
    const grondY = y + h * 0.95;
    const aantal = Math.max(2, Math.min(40, Math.round(num(params.aantal, 5))));
    const cmds = [
      { kind: 'line', x1: x, y1: balkY, x2: x + w, y2: balkY, lineWidth: 1.6 },
    ];
    const veerTop = balkY + h * 0.08;
    const veerOnder = grondY - h * 0.10;
    const slagen = 4;
    const amp = Math.min(w / aantal, h * 0.28) * 0.35;
    for (let i = 0; i < aantal; i++) {
      const px = x + (aantal === 1 ? w / 2 : (w * i) / (aantal - 1));
      const punten = [{ x: px, y: balkY }, { x: px, y: veerTop }];
      const stap = (veerOnder - veerTop) / (slagen * 2);
      let kant = 1;
      for (let s = 1; s <= slagen * 2 - 1; s++) {
        punten.push({ x: px + kant * amp, y: veerTop + stap * s });
        kant = -kant;
      }
      punten.push({ x: px, y: veerOnder });
      punten.push({ x: px, y: grondY });
      cmds.push({ kind: 'polyline', points: punten });
      cmds.push({ kind: 'line', x1: px - amp, y1: grondY, x2: px + amp, y2: grondY });
      cmds.push({ kind: 'line', x1: px - amp * 0.5, y1: grondY, x2: px - amp, y2: grondY + amp * 0.9 });
      cmds.push({ kind: 'line', x1: px + amp * 0.5, y1: grondY, x2: px, y2: grondY + amp * 0.9 });
    }
    return cmds;
  },
};

// ── Windverband / kruisverband ─────────────────────────────────────────────
export const windverbandTemplate = {
  id: 'windverband',
  name: 'Windverband',
  nameEn: 'Bracing',
  category: 'NL Constructie',
  defaultSize: { width: 120, height: 120 },
  params: [
    { key: 'type', label: 'Type', labelEn: 'Type', type: 'enum', options: [
        { value: 'kruis', label: 'Kruis' },
        { value: 'enkel', label: 'Enkele diagonaal' },
      ], default: 'kruis' },
  ],
  render(params = {}, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const cmds = [
      { kind: 'polyline', close: true, points: [
        { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
      ] },
      { kind: 'line', x1: x, y1: y + h, x2: x + w, y2: y },
    ];
    if (params.type !== 'enkel') {
      cmds.push({ kind: 'line', x1: x, y1: y, x2: x + w, y2: y + h });
    }
    return cmds;
  },
  snapPoints(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    return [
      { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
      { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
      { kind: 'center', x: x + w / 2, y: y + h / 2 },
    ];
  },
};

// ── Scharnierverbinding (momentloos) ───────────────────────────────────────
export const scharnierVerbindingTemplate = {
  id: 'scharnier-verbinding',
  name: 'Scharnierverbinding',
  nameEn: 'Hinged connection',
  category: 'NL Constructie',
  defaultSize: { width: 90, height: 40 },
  params: [],
  render(_params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const cy = y + h / 2;
    const r = Math.min(h * 0.32, w * 0.14);
    const cx = x + w / 2;
    return [
      { kind: 'line', x1: x, y1: cy, x2: cx - r, y2: cy, lineWidth: 1.6 },
      { kind: 'circle', cx, cy, r },
      { kind: 'line', x1: cx + r, y1: cy, x2: x + w, y2: cy, lineWidth: 1.6 },
    ];
  },
  snapPoints(params, bbox) {
    const cy = bbox.y + bbox.height / 2;
    return [
      { kind: 'center', x: bbox.x + bbox.width / 2, y: cy },
      { kind: 'endpoint', x: bbox.x, y: cy },
      { kind: 'endpoint', x: bbox.x + bbox.width, y: cy },
    ];
  },
};
