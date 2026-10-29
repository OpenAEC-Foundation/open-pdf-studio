// Parametrisch WAPENINGSDETAIL (buigvorm) — de staafschets zoals op een
// buigstaat of wapeningstekening: de vorm met de buitenmaten langs de benen,
// het staafnummer in een cirkel en de notatie "12Ø10-150 lg=2450 B500B".
//
// De schets is SCHEMATISCH (niet op schaal, zoals gebruikelijk): de lange
// zijde krijgt een vaste breedte, korte benen blijven altijd zichtbaar. De
// maatgetallen zijn de echte buitenmaten; de staaflengte (lg) komt uit
// quantities/wapening.js (staafLengte), dezelfde functie die de buigstaat
// vult — tekening en staat kunnen dus niet uit elkaar lopen.
//
// Vormcodes volgen het nummerprincipe van NEN-EN ISO 3766 (eerste cijfer =
// aantal bochten): 00 recht, 11 haakstaaf (L), 21 U-staaf, 51 gesloten
// beugel met 135°-haken.

import {
  BUIGVORMEN, VORMCODES, STAALKWALITEITEN, STANDAARD_STAALKWALITEIT,
  normaliseerVormcode, staafLengte, staafNotatie,
} from '../../quantities/wapening.js';
import {
  getal, geheelGetal, pasIn, tekstBreedte, tekstMetDiameter, staafnummerBol,
  staafnummerStraal, maatlijn, bboxSnapPunten,
} from './wapening-tekst.js';

const F = 10;        // tekengrootte in lokale eenheden
const SW = 200;      // breedte van de langste horizontale zijde
const SH = 70;       // maximale hoogte van een been
const SH_MIN = 22;   // minimale hoogte van een been (blijft zichtbaar)

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Genormaliseerde parameters. */
export function wapeningsdetailParams(params = {}) {
  const p = params || {};
  const vormcode = normaliseerVormcode(p.vormcode ?? '21');
  const kw = String(p.staalkwaliteit || STANDAARD_STAALKWALITEIT).toUpperCase();
  return {
    staafnummer: String(p.staafnummer ?? '1').trim(),
    aantal: geheelGetal(p.aantal, 12, 0),
    diameter: getal(p.diameter, 10, 1),
    afstand: getal(p.afstand, 150, 0),
    vormcode,
    a: getal(p.a, 300, 0),
    b: getal(p.b, 2000, 0),
    c: getal(p.c, 300, 0),
    staalkwaliteit: STAALKWALITEITEN.includes(kw) ? kw : STANDAARD_STAALKWALITEIT,
    haaklengte: getal(p.haaklengte, 0, 0),
    toonMaten: p.toonMaten !== false,
    toonLengte: p.toonLengte !== false,
  };
}

/** Staaflengte (mm) van het detail. */
export function wapeningsdetailLengte(params) {
  const p = wapeningsdetailParams(params);
  return staafLengte(p.vormcode, p, p.diameter, { haaklengte: p.haaklengte });
}

/** Labeltekst zonder staafnummer: "12Ø10-150 lg=2450 B500B". */
export function wapeningsdetailLabel(params) {
  const p = wapeningsdetailParams(params);
  const delen = [staafNotatie(p)];
  if (p.toonLengte) delen.push(`lg=${wapeningsdetailLengte(p)}`);
  delen.push(p.staalkwaliteit);
  return delen.join(' ');
}

/**
 * Schets van de buigvorm in lokale eenheden (origin linksboven van de vorm,
 * y omlaag): lijnen (polylines), maatlijnen en de omvang.
 */
export function buigvormSchets(vormcode, seg) {
  const code = normaliseerVormcode(vormcode);
  const a = Math.max(0, getal(seg?.a, 0)), b = Math.max(0, getal(seg?.b, 0)), c = Math.max(0, getal(seg?.c, 0));
  const lijnen = [];
  const maten = [];
  let w = SW, h = 0;
  switch (code) {
    case '11': {
      const k = a > 0 ? SW / a : 1;
      h = clamp(b * k, SH_MIN, SH);
      lijnen.push([{ x: 0, y: h }, { x: SW, y: h }, { x: SW, y: 0 }]);
      maten.push({ seg: 'a', waarde: a, x1: 0, y1: h, x2: SW, y2: h, kant: 1 });
      maten.push({ seg: 'b', waarde: b, x1: SW, y1: h, x2: SW, y2: 0, kant: 1 });
      break;
    }
    case '21': {
      const k = b > 0 ? SW / b : 1;
      const been = Math.max(a, c);
      h = clamp(been * k, SH_MIN, SH);
      const ky = been > 0 ? h / been : 1;
      const hA = Math.max(SH_MIN * 0.6, a * ky);
      const hC = Math.max(SH_MIN * 0.6, c * ky);
      h = Math.max(h, hA, hC);
      lijnen.push([{ x: 0, y: h - hA }, { x: 0, y: h }, { x: SW, y: h }, { x: SW, y: h - hC }]);
      maten.push({ seg: 'a', waarde: a, x1: 0, y1: h, x2: 0, y2: h - hA, kant: -1 });
      maten.push({ seg: 'b', waarde: b, x1: 0, y1: h, x2: SW, y2: h, kant: 1 });
      maten.push({ seg: 'c', waarde: c, x1: SW, y1: h, x2: SW, y2: h - hC, kant: 1 });
      break;
    }
    case '51': {
      w = SW * 0.55;
      const k = a > 0 ? w / a : 1;
      h = clamp(b * k, SH_MIN, SH * 1.6);
      lijnen.push([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }, { x: 0, y: 0 }]);
      // Twee 135°-haken in de hoek linksboven, schuin de kern in.
      const hk = Math.min(w, h) * 0.22;
      lijnen.push([{ x: hk * 0.35, y: 0 }, { x: hk * 1.35, y: hk }]);
      lijnen.push([{ x: 0, y: hk * 0.35 }, { x: hk, y: hk * 1.35 }]);
      maten.push({ seg: 'a', waarde: a, x1: 0, y1: 0, x2: w, y2: 0, kant: -1 });
      maten.push({ seg: 'b', waarde: b, x1: w, y1: 0, x2: w, y2: h, kant: -1 });
      break;
    }
    default: {
      lijnen.push([{ x: 0, y: 0 }, { x: SW, y: 0 }]);
      maten.push({ seg: 'a', waarde: a, x1: 0, y1: 0, x2: SW, y2: 0, kant: 1 });
    }
  }
  return { code, lijnen, maten, w, h };
}

/** Volledige opmaak in lokale eenheden (pure functie, ook voor de tests). */
export function wapeningsdetailLayout(params) {
  const p = wapeningsdetailParams(params);
  const schets = buigvormSchets(p.vormcode, p);
  const label = wapeningsdetailLabel(p);
  const bolR = p.staafnummer ? staafnummerStraal(p.staafnummer, F) : 0;
  const labelW = (bolR ? 2 * bolR + F * 0.6 : 0) + tekstBreedte(label, F);
  // Zijmarge: ruimte voor het breedste staande maatgetal (+ maatlijnafstand).
  const staand = schets.maten.filter((m) => m.x1 === m.x2)
    .map((m) => tekstBreedte(String(Math.round(m.waarde)), F * 0.85));
  const zijMarge = p.toonMaten && staand.length ? F * 1.9 + Math.max(...staand) : F;
  const labelH = F * 1.9;
  const boven = labelH + (p.toonMaten && (schets.code === '51') ? F * 2.6 : F * 1.0);
  const onder = p.toonMaten && schets.code !== '51' ? F * 2 : F * 0.8;
  const W = Math.max(schets.w + 2 * zijMarge, labelW + F);
  const H = boven + schets.h + onder;
  return {
    p, schets, label, bolR, labelW, labelH,
    vormX: (W - schets.w) / 2, vormY: boven,
    footprint: { width: W, height: H },
  };
}

function rebarItems(params) {
  const p = wapeningsdetailParams(params);
  return [{
    staafnummer: p.staafnummer,
    diameter: p.diameter,
    aantal: p.aantal,
    lengteMm: wapeningsdetailLengte(p),
    vormcode: p.vormcode,
    staalkwaliteit: p.staalkwaliteit,
    afstand: p.afstand,
  }];
}

export const wapeningsdetailTemplate = {
  id: 'wapeningsdetail',
  name: 'Wapeningsdetail (buigvorm)',
  nameEn: 'Rebar detail (bending shape)',
  category: 'NL Constructie',
  defaultSize: { width: 280, height: 140 },
  zoektermen: ['buigvorm', 'buigstaat', 'staafvorm', 'haakstaaf', 'U-staaf', 'beugel', 'bending shape'],
  params: [
    { key: 'staafnummer', label: 'Staafnummer', labelEn: 'Bar mark', type: 'string', default: '1' },
    { key: 'aantal', label: 'Aantal', labelEn: 'Number of bars', type: 'number', default: 12, min: 0, step: 1 },
    { key: 'diameter', label: 'Diameter Ø (mm)', labelEn: 'Diameter Ø (mm)', type: 'number', default: 10, min: 4, step: 2 },
    { key: 'afstand', label: 'H.o.h.-afstand (mm, 0 = geen)', labelEn: 'Spacing (mm, 0 = none)', type: 'number', default: 150, min: 0, step: 25 },
    {
      key: 'vormcode', label: 'Buigvorm', labelEn: 'Shape code', type: 'enum', default: '21',
      options: VORMCODES.map((c) => ({ value: c, label: `${c} – ${BUIGVORMEN[c].naam}` })),
    },
    { key: 'a', label: 'Maat a (mm)', labelEn: 'Dimension a (mm)', type: 'number', default: 300, min: 0, step: 10 },
    { key: 'b', label: 'Maat b (mm)', labelEn: 'Dimension b (mm)', type: 'number', default: 2000, min: 0, step: 10 },
    { key: 'c', label: 'Maat c (mm)', labelEn: 'Dimension c (mm)', type: 'number', default: 300, min: 0, step: 10 },
    {
      key: 'staalkwaliteit', label: 'Staalkwaliteit', labelEn: 'Steel grade', type: 'enum',
      default: STANDAARD_STAALKWALITEIT, options: STAALKWALITEITEN,
    },
    { key: 'haaklengte', label: 'Haakverlengte beugel (mm, 0 = 10Ø)', labelEn: 'Stirrup hook extension (mm, 0 = 10Ø)', type: 'number', default: 0, min: 0, step: 5 },
    { key: 'toonMaten', label: 'Maten tonen', labelEn: 'Show dimensions', type: 'boolean', default: true },
    { key: 'toonLengte', label: 'Staaflengte tonen', labelEn: 'Show bar length', type: 'boolean', default: true },
  ],
  layout: wapeningsdetailLayout,
  rebarItems,
  snapPoints: bboxSnapPunten,
  render(params, bbox) {
    const L = wapeningsdetailLayout(params);
    const { S, X, Y } = pasIn(L.footprint.width, L.footprint.height, bbox);
    const cmds = [];
    const f = F * S;
    // Label: staafnummer-bol + notatie, samen gecentreerd boven de vorm.
    const cy = Y(L.labelH / 2);
    const start = X((L.footprint.width - L.labelW) / 2);
    let tx = start;
    if (L.bolR) {
      cmds.push(...staafnummerBol(L.p.staafnummer, tx + L.bolR * S, cy, f));
      tx += (2 * L.bolR + F * 0.6) * S;
    }
    const tw = tekstBreedte(L.label, f);
    cmds.push(...tekstMetDiameter(L.label, tx + tw / 2, cy, f, { role: 'label' }));

    // De staaf zelf (dikkere lijn: staaf = getekende wapening).
    const staafLw = Math.max(0.8, Math.min(2.5, F * 0.16 * S));
    const vx = (v) => X(L.vormX + v);
    const vy = (v) => Y(L.vormY + v);
    for (const lijn of L.schets.lijnen) {
      cmds.push({
        kind: 'polyline', role: 'staaf', lineWidth: staafLw,
        points: lijn.map((pt) => ({ x: vx(pt.x), y: vy(pt.y) })),
      });
    }
    if (L.p.toonMaten) {
      for (const m of L.schets.maten) {
        const tekst = String(Math.round(m.waarde));
        const dx = m.x2 - m.x1, dy = m.y2 - m.y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const afst = F * 1.1 * m.kant;
        cmds.push(...maatlijn(
          vx(m.x1 + nx * afst), vy(m.y1 + ny * afst),
          vx(m.x2 + nx * afst), vy(m.y2 + ny * afst),
          tekst, f * 0.85, m.kant,
        ));
      }
    }
    return cmds;
  },
};
