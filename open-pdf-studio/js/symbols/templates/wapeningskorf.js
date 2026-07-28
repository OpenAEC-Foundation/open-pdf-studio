// Parametrische WAPENINGSKORF — rechthoekige balk-/kolomdoorsnede met
// wapening: betonomtrek, beugel (dubbele lijn met haak rechtsboven), staven
// boven/onder/zijkant, schuine aanhaallijnen met labels "N ⌀ D", een los
// label "bgls ⌀ D - afstand", maatlijnen voor breedte en hoogte met ronde
// eindmarkering, en het onderschrift (naam) gecentreerd eronder.
//
// HERGEBRUIK — het diameterteken komt UITSLUITEND uit
// js/annotations/stavenreeks.js (`labelLayout` → `diameterSignSegments`).
// Dat is de enige bron voor het wapeningssymbool in de hele app: wordt het
// teken daar bijgesteld, dan beweegt de korf automatisch mee. Hier wordt het
// teken NIET opnieuw uitgetekend — alleen de segmenten worden geschaald en
// naar canvas-coördinaten gemapt (de segmenten staan in een y-OMHOOG-frame,
// het canvas is y-omlaag, vandaar de y-spiegeling).
//
// OPBOUW — er is één LOKALE mm-ruimte (y omlaag) waarin de hele tekening
// wordt opgebouwd: marges links (hoogte-maatlijn), boven (breedte-maatlijn),
// rechts (labels) en onder (onderschrift), met de betondoorsnede
// `breedte × hoogte` in het midden. `render()` past die footprint passend in
// de annotatie-bbox. Alles blijft daardoor BINNEN de bbox — noodzakelijk,
// want de PDF-appearance (/AP) van een parametrisch symbool is exact de
// annotatie-rect: wat buiten de bbox valt, valt in andere PDF-lezers weg.
//
// `realSizeMm` levert `{ width: breedte, height: hoogte }`, zodat het blok bij
// plaatsing schaalgebied-bewust wordt gemaat (net als de staalprofielen).

import {
  labelLayout,
  diameterSignSegments,
  approxTextWidth,
} from '../../annotations/stavenreeks.js';

// ─── Layout-constanten (fracties van breedte/hoogte) ─────────────────────
const F_FONT = 0.09;      // tekengrootte t.o.v. min(breedte, hoogte)
const F_MARGIN_L = 0.40;  // links: hoogte-maatlijn + maatgetal
const F_MARGIN_T = 0.26;  // boven: breedte-maatlijn + maatgetal
const F_MARGIN_B = 0.32;  // onder: onderschrift + beugellabel
const F_LEADER_GAP = 0.25; // horizontale ruimte tussen doorsnede en labels
const F_DIM_OFF = 0.13;   // afstand maatlijn ↔ doorsnede
const F_DIM_TXT = 0.21;   // afstand maatgetal ↔ doorsnede
const F_DIM_DOT = 0.010;  // straal van de ronde eindmarkering

function _num(v, def, min = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
}

function _count(v, def) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : def;
}

/** Gelijkmatige verdeling van n punten tussen a en b (n=1 → midden). */
function _spread(a, b, n) {
  if (n <= 0) return [];
  if (n === 1) return [(a + b) / 2];
  const out = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

/** Breedte van een "N ⌀ D"-label in lokale mm. */
function _barLabelWidth(n, d, font) {
  return labelLayout(n, d, font, approxTextWidth).width;
}

/** Breedte van het losse beugellabel "bgls ⌀ D - afstand" in lokale mm. */
function _stirrupLabelWidth(prefix, d, afstand, font) {
  const gap = font * 0.22;
  const signW = font * 0.68;
  return approxTextWidth(prefix, font) + gap + signW + gap
    + approxTextWidth(`${d} - ${afstand}`, font);
}

/**
 * Volledige geometrie in LOKALE mm-ruimte (y omlaag, oorsprong linksboven van
 * de footprint). Pure functie — de unittest rekent hier direct op.
 */
function layoutMm(params) {
  const p = params || {};
  const breedte = _num(p.breedte, 400, 1);
  const hoogte = _num(p.hoogte, 400, 1);
  const dekking = _num(p.dekking, 30, 0);
  const beugelDiameter = _num(p.beugelDiameter, 8, 1);
  const beugelAfstand = _num(p.beugelAfstand, 150, 1);
  const bovenAantal = _count(p.bovenAantal, 4);
  const bovenDiameter = _num(p.bovenDiameter, 12, 1);
  const onderAantal = _count(p.onderAantal, 6);
  const onderDiameter = _num(p.onderDiameter, 16, 1);
  const zijAantal = _count(p.zijAantal, 2);
  const zijDiameter = _num(p.zijDiameter, 10, 1);
  const naam = String(p.naam ?? 'Korf A');
  const prefix = 'bgls';

  const ref = Math.min(breedte, hoogte);
  const font = F_FONT * ref;

  // Labelbreedtes bepalen de rechtermarge, zodat lange labels nooit buiten de
  // bbox vallen (en dus nooit uit de PDF-appearance wegvallen).
  const labelW = Math.max(
    bovenAantal > 0 ? _barLabelWidth(bovenAantal, bovenDiameter, font) : 0,
    onderAantal > 0 ? _barLabelWidth(onderAantal, onderDiameter, font) : 0,
    zijAantal > 0 ? _barLabelWidth(zijAantal, zijDiameter, font) : 0,
    _stirrupLabelWidth(prefix, beugelDiameter, beugelAfstand, font),
  );
  const leaderGap = F_LEADER_GAP * breedte;
  const mL = F_MARGIN_L * breedte;
  const mT = F_MARGIN_T * hoogte;
  const mB = F_MARGIN_B * hoogte;
  const mR = leaderGap + labelW + 0.06 * breedte;

  const sec = { x: mL, y: mT, w: breedte, h: hoogte };

  // Beugel: buitenlijn op `dekking` uit de betonrand, binnenlijn nog eens
  // `beugelDiameter` naar binnen (de dubbele lijn = de staafdikte).
  const bo = {
    x: sec.x + dekking, y: sec.y + dekking,
    w: Math.max(0, breedte - 2 * dekking), h: Math.max(0, hoogte - 2 * dekking),
  };
  const bi = {
    x: bo.x + beugelDiameter, y: bo.y + beugelDiameter,
    w: Math.max(0, bo.w - 2 * beugelDiameter), h: Math.max(0, bo.h - 2 * beugelDiameter),
  };

  // Staven raken de BINNENkant van de beugel: hart op dekking + beugel-Ø + r.
  const inset = dekking + beugelDiameter;
  const barX = (d) => ({
    left: sec.x + inset + d / 2,
    right: sec.x + breedte - inset - d / 2,
  });
  const topY = sec.y + inset + bovenDiameter / 2;
  const botY = sec.y + hoogte - inset - onderDiameter / 2;

  const bx = barX(bovenDiameter);
  const boven = _spread(bx.left, bx.right, bovenAantal)
    .map((x) => ({ x, y: topY, r: bovenDiameter / 2 }));
  const nx = barX(onderDiameter);
  const onder = _spread(nx.left, nx.right, onderAantal)
    .map((x) => ({ x, y: botY, r: onderDiameter / 2 }));

  // Zijstaven: verdeeld over links/rechts (bij 2 → één links, één rechts),
  // op halve hoogte tussen de boven- en onderstaven.
  const nLeft = Math.ceil(zijAantal / 2);
  const nRight = zijAantal - nLeft;
  const zx = barX(zijDiameter);
  const sideYs = (k) => {
    const out = [];
    for (let j = 0; j < k; j++) out.push(topY + ((botY - topY) * (j + 1)) / (k + 1));
    return out;
  };
  const zij = [
    ...sideYs(nLeft).map((y) => ({ x: zx.left, y, r: zijDiameter / 2, side: 'left' })),
    ...sideYs(nRight).map((y) => ({ x: zx.right, y, r: zijDiameter / 2, side: 'right' })),
  ];

  const labelX = sec.x + breedte + leaderGap;
  const labels = {
    boven: { x: labelX, y: sec.y - 0.06 * hoogte, n: bovenAantal, d: bovenDiameter },
    zij: { x: labelX, y: sec.y + 0.45 * hoogte, n: zijAantal, d: zijDiameter },
    onder: { x: labelX, y: sec.y + hoogte + 0.10 * hoogte, n: onderAantal, d: onderDiameter },
    beugel: {
      x: labelX, y: sec.y + hoogte + 0.24 * hoogte,
      prefix, d: beugelDiameter, afstand: beugelAfstand,
    },
  };

  return {
    breedte, hoogte, dekking, beugelDiameter, beugelAfstand,
    bovenAantal, bovenDiameter, onderAantal, onderDiameter,
    zijAantal, zijDiameter, naam, prefix,
    font, sec, stirrupOuter: bo, stirrupInner: bi,
    boven, onder, zij, labels,
    caption: { x: sec.x + breedte / 2, y: sec.y + hoogte + 0.16 * hoogte, text: naam },
    footprint: { width: mL + breedte + mR, height: mT + hoogte + mB },
  };
}

/** Labeltekst van een staafgroep, zoals hij op scherm/PDF verschijnt. */
export function korfLabelText(n, d) {
  return `${Math.max(1, Math.round(n))} ⌀ ${d}`;
}

// ─── Tekenhulpjes (lokale mm → canvas) ───────────────────────────────────

function _rect(cmds, X, Y, r, lineWidth) {
  cmds.push({
    kind: 'polyline', close: true,
    ...(lineWidth ? { lineWidth } : {}),
    points: [
      { x: X(r.x), y: Y(r.y) },
      { x: X(r.x + r.w), y: Y(r.y) },
      { x: X(r.x + r.w), y: Y(r.y + r.h) },
      { x: X(r.x), y: Y(r.y + r.h) },
    ],
  });
}

// ─── Fijnwerk-lijndiktes (px, ONAFHANKELIJK van annotation.lineWidth) ─────
// De fijne onderdelen van de korf (diameterteken, staafpunt-omtrek, beugel-
// dubbellijn) hebben details van maar enkele px zodra de mm-footprint in de
// bbox wordt gepast. Met de generieke annotatie-lijndikte (lint-keuze,
// historisch 2–3 px) liepen ze dicht tot klodders. Daarom krijgen ze een
// EIGEN dikte, proportioneel aan hun eigen maat — zoals een tekenpen die met
// de tekengrootte meeschaalt (~0,16 × de tekenstraal ≈ pen 0,18 bij 2,5 mm
// teksthoogte) — met een ondergrens zodat ze zichtbaar blijven.

/** Lijndikte van het diameterteken, uit zijn cirkelstraal in px. */
export function diaSignLineWidth(radiusPx) {
  return Math.max(0.3, Math.min(1.2, 0.16 * radiusPx));
}

/** Omtrek-dikte van een gevulde staafpunt, uit zijn straal in px. */
export function dotLineWidth(radiusPx) {
  return Math.max(0.3, Math.min(0.9, 0.2 * radiusPx));
}

/** Dikte van de beugel-dubbellijn, uit de beugelstaafdikte in px. */
export function stirrupLineWidth(barPx) {
  return Math.max(0.3, Math.min(1.2, 0.3 * barPx));
}

/** Gevulde staafpunt (de kwast tekent 'circle' alleen als omtrek). */
function _dot(cmds, X, Y, S, cx, cy, rMm) {
  const r = Math.max(0.7, rMm * S);
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    pts.push({ x: X(cx) + r * Math.cos(a), y: Y(cy) + r * Math.sin(a) });
  }
  cmds.push({
    kind: 'polyline', close: true, fill: true, points: pts,
    lineWidth: dotLineWidth(r),
  });
}

/**
 * Het WAPENINGS-DIAMETERTEKEN — cirkel + schuine streep met twee vlaggetjes,
 * exact de segmenten uit stavenreeks.js. Middelpunt op (cx, cy) in lokale mm.
 */
function _diaSign(cmds, X, Y, S, cx, cy, rMm) {
  const lw = diaSignLineWidth(rMm * S);
  cmds.push({ kind: 'circle', cx: X(cx), cy: Y(cy), r: rMm * S, lineWidth: lw });
  for (const s of diameterSignSegments(rMm).segments) {
    // y-spiegeling: de segmenten staan in een y-OMHOOG-frame (PDF-conventie).
    cmds.push({
      kind: 'line',
      x1: X(cx + s.x1), y1: Y(cy - s.y1),
      x2: X(cx + s.x2), y2: Y(cy - s.y2),
      lineWidth: lw,
    });
  }
}

/** Label "N ⌀ D" via labelLayout() uit stavenreeks.js; x = linkerkant. */
function _barLabel(cmds, X, Y, S, x, yMid, n, d, font) {
  const L = labelLayout(n, d, font, approxTextWidth);
  for (const part of L.parts) {
    const cx = x + part.dx + part.w / 2;
    if (part.kind === 'text') {
      cmds.push({ kind: 'text', x: X(cx), y: Y(yMid), text: part.text, size: font * S });
    } else {
      _diaSign(cmds, X, Y, S, cx, yMid, L.signRadius);
    }
  }
  return L.width;
}

/** Los label "bgls ⌀ D - afstand" met hetzelfde diameterteken. */
function _stirrupLabel(cmds, X, Y, S, x, yMid, prefix, d, afstand, font) {
  const gap = font * 0.22;
  const signW = font * 0.68;
  const r = font * 0.22;
  const left = String(prefix);
  const right = `${d} - ${afstand}`;
  const wl = approxTextWidth(left, font);
  const wr = approxTextWidth(right, font);
  cmds.push({ kind: 'text', x: X(x + wl / 2), y: Y(yMid), text: left, size: font * S });
  _diaSign(cmds, X, Y, S, x + wl + gap + signW / 2, yMid, r);
  cmds.push({
    kind: 'text', x: X(x + wl + gap + signW + gap + wr / 2), y: Y(yMid),
    text: right, size: font * S,
  });
  return wl + gap + signW + gap + wr;
}

export const wapeningskorfTemplate = {
  id: 'wapeningskorf',
  name: 'Wapeningskorf',
  nameEn: 'Reinforcement cage',
  category: 'NL Constructie',
  defaultSize: { width: 400, height: 400 },
  fixedSize: true,
  params: [
    { key: 'breedte', label: 'Breedte (mm)', labelEn: 'Width (mm)', type: 'number', default: 400, min: 50, step: 10 },
    { key: 'hoogte', label: 'Hoogte (mm)', labelEn: 'Height (mm)', type: 'number', default: 400, min: 50, step: 10 },
    { key: 'dekking', label: 'Dekking (mm)', labelEn: 'Cover (mm)', type: 'number', default: 30, min: 0, step: 5 },
    { key: 'bovenAantal', label: 'Boven aantal', labelEn: 'Top count', type: 'number', default: 4, min: 0, step: 1 },
    { key: 'bovenDiameter', label: 'Boven ⌀ (mm)', labelEn: 'Top ⌀ (mm)', type: 'number', default: 12, min: 4, step: 2 },
    { key: 'onderAantal', label: 'Onder aantal', labelEn: 'Bottom count', type: 'number', default: 6, min: 0, step: 1 },
    { key: 'onderDiameter', label: 'Onder ⌀ (mm)', labelEn: 'Bottom ⌀ (mm)', type: 'number', default: 16, min: 4, step: 2 },
    { key: 'zijAantal', label: 'Zij aantal', labelEn: 'Side count', type: 'number', default: 2, min: 0, step: 1 },
    { key: 'zijDiameter', label: 'Zij ⌀ (mm)', labelEn: 'Side ⌀ (mm)', type: 'number', default: 10, min: 4, step: 2 },
    { key: 'beugelDiameter', label: 'Beugel ⌀ (mm)', labelEn: 'Stirrup ⌀ (mm)', type: 'number', default: 8, min: 4, step: 2 },
    { key: 'beugelAfstand', label: 'Beugel h.o.h. (mm)', labelEn: 'Stirrup spacing (mm)', type: 'number', default: 150, min: 25, step: 25 },
    { key: 'naam', label: 'Onderschrift', labelEn: 'Caption', type: 'string', default: 'Korf A' },
    { key: 'toonMaatlijnen', label: 'Maatlijnen tonen', labelEn: 'Show dimensions', type: 'boolean', default: true },
    { key: 'toonLabels', label: 'Labels tonen', labelEn: 'Show labels', type: 'boolean', default: true },
  ],

  // Lokale mm-geometrie — ook het aangrijpingspunt voor de unittest.
  layoutMm,

  realSizeMm(params) {
    const L = layoutMm(params);
    return { width: L.breedte, height: L.hoogte };
  },

  snapPoints(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    return [
      { kind: 'center', x: x + w / 2, y: y + h / 2 },
      { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
      { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
      { kind: 'midpoint', x: x + w / 2, y }, { kind: 'midpoint', x: x + w / 2, y: y + h },
      { kind: 'midpoint', x, y: y + h / 2 }, { kind: 'midpoint', x: x + w, y: y + h / 2 },
    ];
  },

  editableLabels(params, bbox) {
    const L = layoutMm(params);
    const W = L.footprint.width;
    const H = L.footprint.height;
    const S = Math.min((bbox.width || 1) / W, (bbox.height || 1) / H);
    const ox = bbox.x + ((bbox.width || 0) - W * S) / 2;
    const oy = bbox.y + ((bbox.height || 0) - H * S) / 2;
    const textRect = (x, y, width, font = L.font) => ({
      x: ox + x * S,
      y: oy + (y - font * 0.6) * S,
      width: Math.max(font * 0.5, width) * S,
      height: font * 1.2 * S,
    });
    const labels = [
      {
        id: 'boven',
        fields: ['bovenAantal', 'bovenDiameter'],
        rect: textRect(
          L.labels.boven.x, L.labels.boven.y,
          _barLabelWidth(L.bovenAantal, L.bovenDiameter, L.font),
        ),
      },
      {
        id: 'zij',
        fields: ['zijAantal', 'zijDiameter'],
        rect: textRect(
          L.labels.zij.x, L.labels.zij.y,
          _barLabelWidth(L.zijAantal, L.zijDiameter, L.font),
        ),
      },
      {
        id: 'onder',
        fields: ['onderAantal', 'onderDiameter'],
        rect: textRect(
          L.labels.onder.x, L.labels.onder.y,
          _barLabelWidth(L.onderAantal, L.onderDiameter, L.font),
        ),
      },
      {
        id: 'beugel',
        fields: ['beugelDiameter', 'beugelAfstand'],
        rect: textRect(
          L.labels.beugel.x, L.labels.beugel.y,
          _stirrupLabelWidth(
            L.prefix, L.beugelDiameter, L.beugelAfstand, L.font,
          ),
        ),
      },
      {
        id: 'naam',
        fields: ['naam'],
        rect: {
          ...textRect(
            L.caption.x, L.caption.y,
            approxTextWidth(L.naam, L.font * 1.1), L.font * 1.1,
          ),
          x: ox + (L.caption.x
            - approxTextWidth(L.naam, L.font * 1.1) / 2) * S,
        },
      },
    ];
    const toonLabels = params?.toonLabels !== false;
    return labels.filter(({ id }) => {
      if (id === 'naam') return !!L.naam;
      if (!toonLabels) return false;
      if (id === 'boven') return L.bovenAantal > 0;
      if (id === 'zij') return L.zijAantal > 0;
      if (id === 'onder') return L.onderAantal > 0;
      return true;
    });
  },

  render(params, bbox) {
    const L = layoutMm(params);
    const W = L.footprint.width;
    const H = L.footprint.height;
    const S = Math.min((bbox.width || 1) / W, (bbox.height || 1) / H);
    const ox = bbox.x + ((bbox.width || 0) - W * S) / 2;
    const oy = bbox.y + ((bbox.height || 0) - H * S) / 2;
    const X = (v) => ox + v * S;
    const Y = (v) => oy + v * S;
    const cmds = [];
    const sec = L.sec;
    const toonLabels = params?.toonLabels !== false;
    const toonMaat = params?.toonMaatlijnen !== false;

    // 1. Betonomtrek.
    _rect(cmds, X, Y, sec);

    // 2. Beugel — dubbele lijn (buiten- en binnenkant van de beugelstaaf) met
    //    de haak rechtsboven, 135° naar binnen.
    // De dubbellijn ligt maar `beugelDiameter × S` px uit elkaar — de eigen
    // dunne beugel-pen voorkomt dat de twee lijnen tot één balk samenvloeien.
    const stirLw = stirrupLineWidth(L.beugelDiameter * S);
    _rect(cmds, X, Y, L.stirrupOuter, stirLw);
    if (L.stirrupInner.w > 0 && L.stirrupInner.h > 0) {
      _rect(cmds, X, Y, L.stirrupInner, stirLw);
    }
    const hook = Math.max(4 * L.beugelDiameter, 0.10 * Math.min(L.breedte, L.hoogte));
    const k = hook / Math.SQRT2;
    for (const c of [
      { x: L.stirrupOuter.x + L.stirrupOuter.w, y: L.stirrupOuter.y },
      { x: L.stirrupInner.x + L.stirrupInner.w, y: L.stirrupInner.y },
    ]) {
      cmds.push({
        kind: 'line', x1: X(c.x), y1: Y(c.y), x2: X(c.x - k), y2: Y(c.y + k),
        lineWidth: stirLw,
      });
    }

    // 3. Staven als gevulde punten.
    for (const b of [...L.boven, ...L.onder, ...L.zij]) _dot(cmds, X, Y, S, b.x, b.y, b.r);

    // 4. Aanhaallijnen + labels rechts.
    if (toonLabels) {
      const pad = 0.05 * L.breedte;
      const leader = (from, to) => {
        if (!from) return;
        cmds.push({ kind: 'line', x1: X(from.x), y1: Y(from.y), x2: X(to.x - pad), y2: Y(to.y) });
      };
      if (L.bovenAantal > 0) {
        leader(L.boven[L.boven.length - 1], L.labels.boven);
        _barLabel(cmds, X, Y, S, L.labels.boven.x, L.labels.boven.y,
          L.bovenAantal, L.bovenDiameter, L.font);
      }
      if (L.zijAantal > 0) {
        const right = L.zij.filter((b) => b.side === 'right');
        leader(right[0] || L.zij[0], L.labels.zij);
        _barLabel(cmds, X, Y, S, L.labels.zij.x, L.labels.zij.y,
          L.zijAantal, L.zijDiameter, L.font);
      }
      if (L.onderAantal > 0) {
        leader(L.onder[L.onder.length - 1], L.labels.onder);
        _barLabel(cmds, X, Y, S, L.labels.onder.x, L.labels.onder.y,
          L.onderAantal, L.onderDiameter, L.font);
      }
      _stirrupLabel(cmds, X, Y, S, L.labels.beugel.x, L.labels.beugel.y,
        L.prefix, L.beugelDiameter, L.beugelAfstand, L.font);
    }

    // 5. Maatlijnen breedte (boven) en hoogte (links), met ronde eindmarkering.
    if (toonMaat) {
      const dot = F_DIM_DOT * Math.min(L.breedte, L.hoogte);
      // Eindmarkeringen zijn ~1–2 px groot — ook fijnwerk, eigen dunne pen.
      const dotLw = dotLineWidth(dot * S);
      const dimFont = L.font * 0.9;
      const dy = sec.y - F_DIM_OFF * L.hoogte;
      cmds.push({ kind: 'line', x1: X(sec.x), y1: Y(dy), x2: X(sec.x + L.breedte), y2: Y(dy) });
      cmds.push({ kind: 'circle', cx: X(sec.x), cy: Y(dy), r: dot * S, lineWidth: dotLw });
      cmds.push({ kind: 'circle', cx: X(sec.x + L.breedte), cy: Y(dy), r: dot * S, lineWidth: dotLw });
      cmds.push({ kind: 'line', x1: X(sec.x), y1: Y(sec.y), x2: X(sec.x), y2: Y(dy - 0.02 * L.hoogte) });
      cmds.push({
        kind: 'line', x1: X(sec.x + L.breedte), y1: Y(sec.y),
        x2: X(sec.x + L.breedte), y2: Y(dy - 0.02 * L.hoogte),
      });
      cmds.push({
        kind: 'text', x: X(sec.x + L.breedte / 2), y: Y(sec.y - F_DIM_TXT * L.hoogte),
        text: String(Math.round(L.breedte)), size: dimFont * S,
      });

      const dx = sec.x - F_DIM_OFF * L.breedte;
      cmds.push({ kind: 'line', x1: X(dx), y1: Y(sec.y), x2: X(dx), y2: Y(sec.y + L.hoogte) });
      cmds.push({ kind: 'circle', cx: X(dx), cy: Y(sec.y), r: dot * S, lineWidth: dotLw });
      cmds.push({ kind: 'circle', cx: X(dx), cy: Y(sec.y + L.hoogte), r: dot * S, lineWidth: dotLw });
      cmds.push({ kind: 'line', x1: X(sec.x), y1: Y(sec.y), x2: X(dx - 0.02 * L.breedte), y2: Y(sec.y) });
      cmds.push({
        kind: 'line', x1: X(sec.x), y1: Y(sec.y + L.hoogte),
        x2: X(dx - 0.02 * L.breedte), y2: Y(sec.y + L.hoogte),
      });
      cmds.push({
        kind: 'text', x: X(sec.x - F_DIM_TXT * L.breedte - 0.04 * L.breedte),
        y: Y(sec.y + L.hoogte / 2),
        text: String(Math.round(L.hoogte)), size: dimFont * S,
      });
    }

    // 6. Onderschrift.
    if (L.naam) {
      cmds.push({
        kind: 'text', x: X(L.caption.x), y: Y(L.caption.y),
        text: L.naam, size: L.font * 1.1 * S, bold: true,
      });
    }
    return cmds;
  },
};
