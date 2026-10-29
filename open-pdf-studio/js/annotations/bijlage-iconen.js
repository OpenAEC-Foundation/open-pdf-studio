// Pictogrammen van een bijlage-annotatie (/FileAttachment, #376).
//
// De PDF-specificatie kent vier namen (/Name): PushPin, Paperclip, Graph en
// Tag. Elk pictogram is hier één keer beschreven, in een eenheidsvak (0..1,
// y omlaag), en wordt zowel op het canvas getekend als in de appearance-
// stroom van het bestand geschreven, zodat andere lezers hetzelfde zien.
//
// Puur: geen app-imports, ook in node te testen.

/** App-naam -> /Name in het bestand. */
export const BIJLAGE_ICOON_PDF = {
  paperclip: 'Paperclip',
  pushpin: 'PushPin',
  graph: 'Graph',
  tag: 'Tag',
};

export const BIJLAGE_ICONEN = Object.keys(BIJLAGE_ICOON_PDF);
export const STANDAARD_BIJLAGE_ICOON = 'paperclip';
export const STANDAARD_BIJLAGE_KLEUR = '#2B579A';
export const BIJLAGE_ICOON_MAAT = 24;

/** /Name uit het bestand -> app-naam; onbekend wordt de paperclip. */
export function bijlageIcoonUitPdf(naam) {
  const n = String(naam || '').replace(/^\//, '').toLowerCase();
  return BIJLAGE_ICOON_PDF[n] ? n : (n === 'push pin' ? 'pushpin' : STANDAARD_BIJLAGE_ICOON);
}

export function bijlageIcoonNaarPdf(icoon) {
  return BIJLAGE_ICOON_PDF[icoon] || BIJLAGE_ICOON_PDF[STANDAARD_BIJLAGE_ICOON];
}

// Cirkel als vier bezierbogen (k = 0,5523 van de straal).
function cirkel(cx, cy, r) {
  const k = 0.5523 * r;
  return [
    ['M', cx + r, cy],
    ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r],
    ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
    ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r],
    ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy],
    ['Z'],
  ];
}

/**
 * Per pictogram de deelpaden. `modus`: 'stroke', 'fill' of 'fillStroke';
 * `wit`: in wit in plaats van de annotatiekleur.
 */
const PADEN = {
  paperclip: [{
    modus: 'stroke',
    d: [
      ['M', 0.62, 0.30],
      ['L', 0.62, 0.72],
      ['C', 0.62, 0.86, 0.42, 0.86, 0.42, 0.72],
      ['L', 0.42, 0.22],
      ['C', 0.42, 0.04, 0.76, 0.04, 0.76, 0.22],
      ['L', 0.76, 0.76],
      ['C', 0.76, 1.00, 0.28, 1.00, 0.28, 0.76],
      ['L', 0.28, 0.34],
    ],
  }],
  pushpin: [
    {
      modus: 'fillStroke',
      d: [
        ['M', 0.34, 0.08], ['L', 0.66, 0.08], ['L', 0.60, 0.20], ['L', 0.60, 0.40],
        ['L', 0.76, 0.56], ['L', 0.24, 0.56], ['L', 0.40, 0.40], ['L', 0.40, 0.20], ['Z'],
      ],
    },
    { modus: 'stroke', d: [['M', 0.50, 0.56], ['L', 0.50, 0.94]] },
  ],
  graph: [
    { modus: 'stroke', d: [['M', 0.14, 0.10], ['L', 0.14, 0.86], ['L', 0.90, 0.86]] },
    { modus: 'fill', d: [['M', 0.26, 0.56], ['L', 0.38, 0.56], ['L', 0.38, 0.80], ['L', 0.26, 0.80], ['Z']] },
    { modus: 'fill', d: [['M', 0.46, 0.36], ['L', 0.58, 0.36], ['L', 0.58, 0.80], ['L', 0.46, 0.80], ['Z']] },
    { modus: 'fill', d: [['M', 0.66, 0.18], ['L', 0.78, 0.18], ['L', 0.78, 0.80], ['L', 0.66, 0.80], ['Z']] },
  ],
  tag: [
    {
      modus: 'fillStroke',
      d: [['M', 0.10, 0.10], ['L', 0.52, 0.10], ['L', 0.92, 0.50], ['L', 0.52, 0.90], ['L', 0.10, 0.50], ['Z']],
    },
    { modus: 'fill', wit: true, d: cirkel(0.30, 0.30, 0.07) },
  ],
};

/** De deelpaden van een pictogram (een onbekende naam geeft de paperclip). */
export function bijlageIcoonPaden(icoon) {
  return PADEN[icoon] || PADEN[STANDAARD_BIJLAGE_ICOON];
}

function hexNaarRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [0.17, 0.34, 0.6];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => c / 255);
}

const getal = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * De inhoud van de appearance-stroom: het pictogram in een vak van w x h
 * (PDF-ruimte, y omhoog, oorsprong linksonder van de /BBox).
 */
export function bijlageIcoonContent(icoon, w, h, kleur = STANDAARD_BIJLAGE_KLEUR) {
  const [r, g, b] = hexNaarRgb(kleur);
  const s = Math.min(w, h);
  const ox = (w - s) / 2;
  const oy = (h - s) / 2;
  const px = (ux) => getal(ox + ux * s);
  const py = (uy) => getal(oy + (1 - uy) * s);
  const kleurOp = `${getal(r)} ${getal(g)} ${getal(b)}`;
  const regels = ['q', `${getal(Math.max(0.8, s * 0.08))} w`, '1 J', '1 j'];
  for (const pad of bijlageIcoonPaden(icoon)) {
    regels.push(pad.wit ? '1 1 1 rg 1 1 1 RG' : `${kleurOp} rg ${kleurOp} RG`);
    for (const [op, ...v] of pad.d) {
      if (op === 'M') regels.push(`${px(v[0])} ${py(v[1])} m`);
      else if (op === 'L') regels.push(`${px(v[0])} ${py(v[1])} l`);
      else if (op === 'C') regels.push(`${px(v[0])} ${py(v[1])} ${px(v[2])} ${py(v[3])} ${px(v[4])} ${py(v[5])} c`);
      else if (op === 'Z') regels.push('h');
    }
    regels.push(pad.modus === 'stroke' ? 'S' : pad.modus === 'fill' ? 'f' : 'B');
  }
  regels.push('Q');
  return regels.join('\n');
}

/** Tekent het pictogram van een bijlage-annotatie op een 2D-canvas. */
export function tekenBijlageIcoon(ctx, ann) {
  const w = ann.width || BIJLAGE_ICOON_MAAT;
  const h = ann.height || BIJLAGE_ICOON_MAAT;
  const s = Math.min(w, h);
  const ox = ann.x + (w - s) / 2;
  const oy = ann.y + (h - s) / 2;
  const kleur = ann.color || STANDAARD_BIJLAGE_KLEUR;
  ctx.save();
  ctx.lineWidth = Math.max(0.8, s * 0.08);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pad of bijlageIcoonPaden(ann.icon)) {
    ctx.beginPath();
    for (const [op, ...v] of pad.d) {
      if (op === 'M') ctx.moveTo(ox + v[0] * s, oy + v[1] * s);
      else if (op === 'L') ctx.lineTo(ox + v[0] * s, oy + v[1] * s);
      else if (op === 'C') ctx.bezierCurveTo(ox + v[0] * s, oy + v[1] * s, ox + v[2] * s, oy + v[3] * s, ox + v[4] * s, oy + v[5] * s);
      else if (op === 'Z') ctx.closePath();
    }
    const k = pad.wit ? '#ffffff' : kleur;
    ctx.fillStyle = k;
    ctx.strokeStyle = k;
    if (pad.modus !== 'stroke') ctx.fill();
    if (pad.modus !== 'fill') ctx.stroke();
  }
  ctx.restore();
}
