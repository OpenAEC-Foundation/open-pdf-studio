// Parametrische constructie-symbolen (#338): opleggingen, lasten,
// beddingsveren, windverband en scharnierverbinding. Schematische
// tekenkamer-symbolen — geen rekenfunctionaliteit.

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

// Arceerstreepjes onder een lijn (maaiveld-/inklemmingsarcering).
function arcering(x0, x1, y, slag) {
  const cmds = [];
  const stap = Math.max(4, (x1 - x0) / 6);
  for (let x = x0 + stap * 0.5; x <= x1 + 0.01; x += stap) {
    cmds.push({ kind: 'line', x1: x, y1: y, x2: x - slag, y2: y + slag });
  }
  return cmds;
}

// ── Oplegging (steunpunt) ──────────────────────────────────────────────────
export const opleggingTemplate = {
  id: 'oplegging',
  name: 'Oplegging',
  nameEn: 'Support',
  category: 'NL Constructie',
  defaultSize: { width: 64, height: 64 },
  params: [
    { key: 'type', label: 'Type', labelEn: 'Type', type: 'enum', options: [
        { value: 'scharnier', label: 'Scharnier' },
        { value: 'rol', label: 'Rol' },
        { value: 'inklemming', label: 'Inklemming' },
      ], default: 'scharnier' },
  ],
  render(params = {}, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const cx = x + w / 2;
    const cmds = [];
    const slag = Math.min(w, h) * 0.14;
    if (params.type === 'inklemming') {
      // Inklemming: zware rand met arcering erachter.
      const lijnY = y + h * 0.5;
      cmds.push({ kind: 'line', x1: x + w * 0.1, y1: lijnY, x2: x + w * 0.9, y2: lijnY, lineWidth: 2.2 });
      cmds.push(...arcering(x + w * 0.1, x + w * 0.9, lijnY, slag));
      // Aansluitstaaf naar het aangrijpingspunt.
      cmds.push({ kind: 'line', x1: cx, y1: y + h * 0.1, x2: cx, y2: lijnY });
      return cmds;
    }
    // Scharnier/rol: driehoek met de top in het aangrijpingspunt.
    const topY = y + h * 0.12;
    const basisY = y + h * 0.62;
    const halfBasis = w * 0.26;
    cmds.push({
      kind: 'polyline', close: true,
      points: [
        { x: cx, y: topY },
        { x: cx - halfBasis, y: basisY },
        { x: cx + halfBasis, y: basisY },
      ],
    });
    let grondY = basisY;
    if (params.type === 'rol') {
      // Rollen tussen driehoeksbasis en de grondlijn.
      const r = h * 0.07;
      grondY = basisY + 2 * r;
      for (const rx of [cx - halfBasis * 0.6, cx, cx + halfBasis * 0.6]) {
        cmds.push({ kind: 'circle', cx: rx, cy: basisY + r, r });
      }
    }
    cmds.push({ kind: 'line', x1: cx - halfBasis * 1.35, y1: grondY, x2: cx + halfBasis * 1.35, y2: grondY });
    cmds.push(...arcering(cx - halfBasis * 1.35, cx + halfBasis * 1.35, grondY, slag));
    return cmds;
  },
  snapPoints(params, bbox) {
    return [{ kind: 'endpoint', x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height * 0.12 }];
  },
};

// ── Puntlast ───────────────────────────────────────────────────────────────
export const puntlastTemplate = {
  id: 'puntlast',
  name: 'Puntlast',
  nameEn: 'Point load',
  category: 'NL Constructie',
  defaultSize: { width: 90, height: 90 },
  params: [
    { key: 'kracht', label: 'Kracht (kN)', labelEn: 'Force (kN)', type: 'number', default: 10, min: 0, step: 1 },
  ],
  render(params = {}, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const cx = x + w / 2;
    const topY = y + h * 0.28;
    const puntY = y + h * 0.95;
    const kop = Math.min(w, h) * 0.16;
    return [
      { kind: 'text', x: cx, y: y + h * 0.12, text: `F = ${num(params.kracht, 10)} kN`, size: Math.max(9, h * 0.16) },
      { kind: 'line', x1: cx, y1: topY, x2: cx, y2: puntY },
      {
        kind: 'polyline', fill: true, close: true,
        points: [
          { x: cx, y: puntY },
          { x: cx - kop * 0.38, y: puntY - kop },
          { x: cx + kop * 0.38, y: puntY - kop },
        ],
      },
    ];
  },
  snapPoints(params, bbox) {
    return [{ kind: 'endpoint', x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height * 0.95 }];
  },
};

// ── Gelijkmatig verdeelde belasting (q-last) ───────────────────────────────
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
