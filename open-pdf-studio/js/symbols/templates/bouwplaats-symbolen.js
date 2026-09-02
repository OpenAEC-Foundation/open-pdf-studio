// Parametrische bouwplaats-symbolen (#338): kraan met zwenkstraal,
// draaicirkel, parkeervak en bouwkeet. Met een werkelijke maat, zodat ze
// via de tekeningschaal op ware grootte landen (zelfde mechanisme als de
// overige templates met realSizeMm).

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

// ── Bouwkraan met zwenkstraal ──────────────────────────────────────────────
export const bouwkraanTemplate = {
  id: 'bouwkraan',
  name: 'Bouwkraan (zwenkstraal)',
  nameEn: 'Crane (swing radius)',
  category: 'NL Bouwplaats',
  defaultSize: { width: 220, height: 220 },
  params: [
    { key: 'straal', label: 'Zwenkstraal (m)', labelEn: 'Swing radius (m)', type: 'number', default: 30, min: 1, step: 1 },
  ],
  realSizeMm(params) {
    const d = num(params?.straal, 30) * 2000;
    return { width: d, height: d };
  },
  render(params = {}, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2 * 0.98;
    const voet = r * 0.06;
    return [
      // Zwenkcirkel (gestreept, zoals een bereik hoort te tekenen).
      { kind: 'polyline', points: cirkelPunten(cx, cy, r), close: true, dash: [6, 4] },
      // Kraanvoet
      { kind: 'polyline', close: true, points: [
        { x: cx - voet, y: cy - voet }, { x: cx + voet, y: cy - voet },
        { x: cx + voet, y: cy + voet }, { x: cx - voet, y: cy + voet },
      ] },
      { kind: 'line', x1: cx - voet, y1: cy - voet, x2: cx + voet, y2: cy + voet, lineWidth: 0.8 },
      { kind: 'line', x1: cx - voet, y1: cy + voet, x2: cx + voet, y2: cy - voet, lineWidth: 0.8 },
      // Giek tot de zwenkstraal + korte contragiek.
      { kind: 'line', x1: cx, y1: cy, x2: cx + r, y2: cy, lineWidth: 1.4 },
      { kind: 'line', x1: cx, y1: cy, x2: cx - r * 0.25, y2: cy, lineWidth: 1.4 },
      { kind: 'text', x: cx + r * 0.5, y: cy - Math.max(8, r * 0.07), text: `R = ${num(params.straal, 30)} m`, size: Math.max(9, r * 0.11) },
    ];
  },
  snapPoints(params, bbox) {
    return [{ kind: 'center', x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }];
  },
};

// ── Draaicirkel (vrachtwagen) ──────────────────────────────────────────────
export const draaicirkelTemplate = {
  id: 'draaicirkel',
  name: 'Draaicirkel vrachtwagen',
  nameEn: 'Truck turning circle',
  category: 'NL Bouwplaats',
  defaultSize: { width: 200, height: 200 },
  params: [
    { key: 'straal', label: 'Draaistraal (m)', labelEn: 'Turning radius (m)', type: 'number', default: 12.5, min: 1, step: 0.5 },
  ],
  realSizeMm(params) {
    const d = num(params?.straal, 12.5) * 2000;
    return { width: d, height: d };
  },
  render(params = {}, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2 * 0.98;
    const kop = r * 0.10;
    return [
      { kind: 'polyline', points: cirkelPunten(cx, cy, r), close: true, dash: [6, 4] },
      // Richtingspijl op de cirkel (rechtsboven, met de klok mee).
      {
        kind: 'polyline', fill: true, close: true,
        points: [
          { x: cx + r * 0.7071 + kop * 0.55, y: cy - r * 0.7071 + kop * 0.55 },
          { x: cx + r * 0.7071 - kop, y: cy - r * 0.7071 },
          { x: cx + r * 0.7071, y: cy - r * 0.7071 + kop },
        ],
      },
      { kind: 'line', x1: cx, y1: cy, x2: cx + r * 0.7071, y2: cy + r * 0.7071, dash: [3, 3], lineWidth: 0.8 },
      { kind: 'text', x: cx, y: cy - Math.max(8, r * 0.08), text: `R = ${num(params.straal, 12.5)} m`, size: Math.max(9, r * 0.11) },
    ];
  },
  snapPoints(params, bbox) {
    return [{ kind: 'center', x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }];
  },
};

// ── Parkeervak ─────────────────────────────────────────────────────────────
export const parkeervakTemplate = {
  id: 'parkeervak',
  name: 'Parkeervak',
  nameEn: 'Parking space',
  category: 'NL Bouwplaats',
  defaultSize: { width: 90, height: 180 },
  params: [
    { key: 'breedte', label: 'Breedte (mm)', labelEn: 'Width (mm)', type: 'number', default: 2500, min: 1000, step: 100 },
    { key: 'lengte', label: 'Lengte (mm)', labelEn: 'Length (mm)', type: 'number', default: 5000, min: 2000, step: 100 },
  ],
  realSizeMm(params) {
    return { width: num(params?.breedte, 2500), height: num(params?.lengte, 5000) };
  },
  render(_params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    return [
      { kind: 'polyline', close: true, points: [
        { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
      ] },
      { kind: 'text', x: x + w / 2, y: y + h / 2, text: 'P', bold: true, size: Math.max(10, Math.min(w, h) * 0.4) },
    ];
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

// ── Bouwkeet ───────────────────────────────────────────────────────────────
export const bouwkeetTemplate = {
  id: 'bouwkeet',
  name: 'Bouwkeet',
  nameEn: 'Site cabin',
  category: 'NL Bouwplaats',
  defaultSize: { width: 200, height: 80 },
  params: [
    { key: 'breedte', label: 'Breedte (mm)', labelEn: 'Width (mm)', type: 'number', default: 3000, min: 1000, step: 100 },
    { key: 'lengte', label: 'Lengte (mm)', labelEn: 'Length (mm)', type: 'number', default: 8000, min: 2000, step: 100 },
    { key: 'tekst', label: 'Tekst', labelEn: 'Text', type: 'string', default: 'KEET' },
  ],
  realSizeMm(params) {
    return { width: num(params?.lengte, 8000), height: num(params?.breedte, 3000) };
  },
  render(params = {}, bbox) {
    const { x, y, width: w, height: h } = bbox;
    return [
      { kind: 'polyline', close: true, points: [
        { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
      ] },
      { kind: 'line', x1: x, y1: y, x2: x + w, y2: y + h, lineWidth: 0.8 },
      { kind: 'text', x: x + w / 2, y: y + h / 2, text: String(params.tekst ?? 'KEET'), bold: true, size: Math.max(9, h * 0.32) },
    ];
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

// Cirkel als polyline zodat hij gestreept kan (het circle-commando kent
// geen dash).
function cirkelPunten(cx, cy, r, n = 64) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}
