// Parametrisch wapeningsdetail VLOER MET VORSTRAND — doorsnede over de rand
// van een vloer op staal of op palen, met de verdiepte vorstrand: de
// betonomtrek op ware maat (met een breeklijn waar de vloer doorloopt), de
// vloerwapening (onder- en/of bovennet: lijn met de dwarsstaven als stippen),
// de gesloten beugel en de langsstaven in de vorstrand, staafnummers met
// aanwijslijn, maatvoering en een legenda met de notatie per positie.
//
// De vorstrandwapening (langsstaven + beugels) gaat over de opgegeven
// randlengte naar de buigstaat. De netten zelf niet: die tel je met het
// gereedschap Wapeningsnet, anders zouden ze dubbel in de staat komen.

import {
  STAALKWALITEITEN, STANDAARD_STAALKWALITEIT, aantalOverBreedte, staafLengte, staafNotatie,
} from '../../quantities/wapening.js';
import {
  getal, geheelGetal, pasIn, tekstBreedte, tekstMetDiameter, staafnummerBol,
  staafnummerStraal, maatlijn, stip, bboxSnapPunten,
} from './wapening-tekst.js';

const NET_LAGEN = ['onder', 'boven', 'beide'];

export function vorstrandParams(params = {}) {
  const p = params || {};
  const kw = String(p.staalkwaliteit || STANDAARD_STAALKWALITEIT).toUpperCase();
  const vloerdikte = getal(p.vloerdikte, 200, 50);
  return {
    vloerdikte,
    vorstrandBreedte: getal(p.vorstrandBreedte, 400, 100),
    vorstrandHoogte: Math.max(vloerdikte + 50, getal(p.vorstrandHoogte, 800, 100)),
    vloerLengte: getal(p.vloerLengte, 1200, 200),
    dekking: getal(p.dekking, 40, 0),
    netDiameter: getal(p.netDiameter, 8, 1),
    netAfstand: getal(p.netAfstand, 150, 25),
    netLagen: NET_LAGEN.includes(p.netLagen) ? p.netLagen : 'beide',
    randAantal: geheelGetal(p.randAantal, 4, 0),
    randDiameter: getal(p.randDiameter, 12, 1),
    beugelDiameter: getal(p.beugelDiameter, 8, 1),
    beugelAfstand: getal(p.beugelAfstand, 200, 25),
    lengte: getal(p.lengte, 10000, 0),
    staafnummerStart: String(p.staafnummerStart ?? '1').trim(),
    staalkwaliteit: STAALKWALITEITEN.includes(kw) ? kw : STANDAARD_STAALKWALITEIT,
    naam: String(p.naam ?? 'Vloer met vorstrand'),
    toonMaten: p.toonMaten !== false,
  };
}

function nummers(start, n) {
  const s = Number(start);
  if (!start || !Number.isInteger(s)) return Array.from({ length: n }, () => '');
  return Array.from({ length: n }, (_, i) => String(s + i));
}

/** Staven van de vorstrand over de randlengte. */
export function vorstrandStaven(params) {
  const p = vorstrandParams(params);
  const [nrRand, nrBeugel] = nummers(p.staafnummerStart, 2);
  const netto = Math.max(0, p.lengte - 2 * p.dekking);
  const beugelA = Math.max(0, p.vorstrandBreedte - 2 * p.dekking);
  const beugelB = Math.max(0, p.vorstrandHoogte - 2 * p.dekking);
  return {
    rand: {
      staafnummer: nrRand, diameter: p.randDiameter, aantal: p.randAantal,
      lengteMm: Math.round(netto), vormcode: '00', staalkwaliteit: p.staalkwaliteit,
    },
    beugel: {
      staafnummer: nrBeugel, diameter: p.beugelDiameter, afstand: p.beugelAfstand,
      aantal: netto > 0 ? aantalOverBreedte(netto, p.beugelAfstand) : 0,
      lengteMm: staafLengte('51', { a: beugelA, b: beugelB }, p.beugelDiameter),
      vormcode: '51', staalkwaliteit: p.staalkwaliteit, a: beugelA, b: beugelB,
    },
  };
}

/** Volledige geometrie in lokale mm (y omlaag). Pure functie. */
export function vorstrandLayout(params) {
  const p = vorstrandParams(params);
  const t = p.vloerdikte, bw = p.vorstrandBreedte, Ht = p.vorstrandHoogte;
  const Lt = bw + p.vloerLengte;
  const c = p.dekking;
  const F = Math.max(20, Lt * 0.04);
  const staven = vorstrandStaven(p);

  const legenda = [];
  if (p.randAantal > 0) {
    legenda.push({ nr: staven.rand.staafnummer, tekst: `${staafNotatie({ aantal: p.randAantal, diameter: p.randDiameter })} lg=${staven.rand.lengteMm}` });
  }
  legenda.push({ nr: staven.beugel.staafnummer, tekst: `bgls ${staafNotatie({ diameter: p.beugelDiameter, afstand: p.beugelAfstand })} lg=${staven.beugel.lengteMm}` });
  const net = staafNotatie({ diameter: p.netDiameter, afstand: p.netAfstand });
  const lagen = p.netLagen === 'beide' ? 'onder + boven' : p.netLagen;
  legenda.push({ nr: '', tekst: `net ${net}/${net} ${lagen}` });
  legenda.push({ nr: '', tekst: `${p.naam}  ${p.staalkwaliteit}`.trim() });

  const legendaW = Math.max(...legenda.map((r) => tekstBreedte(r.tekst, F) + (r.nr ? 2 * staafnummerStraal(r.nr, F) + F * 0.5 : 0)));
  const mL = p.toonMaten ? F * 3.6 : F;
  const mR = p.toonMaten ? F * 3.6 : F;
  const mT = F;
  const mB = (p.toonMaten ? F * 2.6 : F) + legenda.length * F * 1.6 + F * 0.4;
  const W = Math.max(mL + Lt + mR, legendaW + 2 * F);
  const ox = mL, oy = mT;
  const H = oy + Ht + mB;

  // Betonomtrek met breeklijn aan de vloerzijde.
  const xe = ox + Lt;
  const z = t * 0.14;
  const omtrek = [
    { x: ox, y: oy }, { x: xe, y: oy },
    { x: xe, y: oy + t * 0.35 }, { x: xe + z, y: oy + t * 0.45 },
    { x: xe - z, y: oy + t * 0.55 }, { x: xe, y: oy + t * 0.65 },
    { x: xe, y: oy + t }, { x: ox + bw, y: oy + t },
    { x: ox + bw, y: oy + Ht }, { x: ox, y: oy + Ht },
  ];

  // Netten: lijn + dwarsstaven als stippen aan de binnenzijde.
  const dn = p.netDiameter;
  const stipR = Math.max(dn / 2, F * 0.09);
  const netten = [];
  const laagY = { onder: oy + t - c - dn / 2, boven: oy + c + dn / 2 };
  for (const laag of ['onder', 'boven']) {
    if (p.netLagen !== 'beide' && p.netLagen !== laag) continue;
    const y = laagY[laag];
    const stipY = laag === 'onder' ? y - stipR - dn / 2 : y + stipR + dn / 2;
    const stippen = [];
    for (let x = ox + c + p.netAfstand / 2; x < xe - stipR; x += p.netAfstand) stippen.push({ x, y: stipY });
    netten.push({ laag, x1: ox + c, x2: xe, y, stippen });
  }

  // Beugel en langsstaven in de vorstrand.
  const db = p.beugelDiameter, dr = p.randDiameter;
  const beugel = { x: ox + c, y: oy + c, w: Math.max(0, bw - 2 * c), h: Math.max(0, Ht - 2 * c) };
  const nBoven = Math.ceil(p.randAantal / 2), nOnder = Math.floor(p.randAantal / 2);
  const spreid = (n) => {
    if (n <= 0) return [];
    const a = ox + c + db + dr / 2, b = ox + bw - c - db - dr / 2;
    if (n === 1) return [(a + b) / 2];
    return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
  };
  const randR = Math.max(dr / 2, F * 0.12);
  const rand = [
    ...spreid(nBoven).map((x) => ({ x, y: oy + c + db + dr / 2 })),
    ...spreid(nOnder).map((x) => ({ x, y: oy + Ht - c - db - dr / 2 })),
  ];

  // Staafnummers met aanwijslijn, rechts van de vorstrand (onder de vloer).
  const bolX = ox + bw + F * 2.2;
  const aanwijzers = [];
  if (p.randAantal > 0 && rand.length) {
    const doel = rand[rand.length - 1];
    aanwijzers.push({ nr: staven.rand.staafnummer, x: bolX, y: oy + Ht - F * 1.2, doel });
  }
  aanwijzers.push({
    nr: staven.beugel.staafnummer, x: bolX, y: oy + t + (Ht - t) * 0.45,
    doel: { x: beugel.x + beugel.w, y: oy + t + (Ht - t) * 0.45 },
  });

  return {
    p, F, W, H, ox, oy, Lt, omtrek, netten, stipR, beugel, rand, randR, aanwijzers,
    legenda, legendaY: oy + Ht + (p.toonMaten ? F * 2.6 : F) + F * 0.8,
    staven,
    footprint: { width: W, height: H },
  };
}

function rebarItems(params) {
  const s = vorstrandStaven(params);
  return [s.rand, s.beugel];
}

export const vloerVorstrandTemplate = {
  id: 'vloer-vorstrand',
  name: 'Vloer met vorstrand (wapening)',
  nameEn: 'Slab with frost edge (reinforcement)',
  category: 'NL Constructie',
  defaultSize: { width: 300, height: 220 },
  fixedSize: true,
  zoektermen: ['vorstrand', 'randbalk', 'vloerrand', 'begane grondvloer', 'frost edge', 'wapeningsdetail'],
  params: [
    { key: 'vloerdikte', label: 'Vloerdikte (mm)', labelEn: 'Slab thickness (mm)', type: 'number', default: 200, min: 50, step: 10 },
    { key: 'vorstrandBreedte', label: 'Breedte vorstrand (mm)', labelEn: 'Frost edge width (mm)', type: 'number', default: 400, min: 100, step: 10 },
    { key: 'vorstrandHoogte', label: 'Hoogte vorstrand incl. vloer (mm)', labelEn: 'Frost edge depth incl. slab (mm)', type: 'number', default: 800, min: 100, step: 10 },
    { key: 'vloerLengte', label: 'Getekende vloerstrook (mm)', labelEn: 'Drawn slab strip (mm)', type: 'number', default: 1200, min: 200, step: 50 },
    { key: 'dekking', label: 'Dekking (mm)', labelEn: 'Cover (mm)', type: 'number', default: 40, min: 0, step: 5 },
    { key: 'netDiameter', label: 'Net Ø (mm)', labelEn: 'Mesh Ø (mm)', type: 'number', default: 8, min: 4, step: 1 },
    { key: 'netAfstand', label: 'Net h.o.h. (mm)', labelEn: 'Mesh spacing (mm)', type: 'number', default: 150, min: 25, step: 25 },
    {
      key: 'netLagen', label: 'Netten', labelEn: 'Mesh layers', type: 'enum', default: 'beide',
      options: [
        { value: 'beide', label: 'Onder + boven' },
        { value: 'onder', label: 'Alleen onder' },
        { value: 'boven', label: 'Alleen boven' },
      ],
    },
    { key: 'randAantal', label: 'Langsstaven vorstrand', labelEn: 'Frost edge longitudinal bars', type: 'number', default: 4, min: 0, step: 1 },
    { key: 'randDiameter', label: 'Langsstaaf Ø (mm)', labelEn: 'Longitudinal bar Ø (mm)', type: 'number', default: 12, min: 4, step: 2 },
    { key: 'beugelDiameter', label: 'Beugel Ø (mm)', labelEn: 'Stirrup Ø (mm)', type: 'number', default: 8, min: 4, step: 2 },
    { key: 'beugelAfstand', label: 'Beugel h.o.h. (mm)', labelEn: 'Stirrup spacing (mm)', type: 'number', default: 200, min: 25, step: 25 },
    { key: 'lengte', label: 'Randlengte voor staat (mm)', labelEn: 'Edge length for schedule (mm)', type: 'number', default: 10000, min: 0, step: 100 },
    { key: 'staafnummerStart', label: 'Eerste staafnummer', labelEn: 'First bar mark', type: 'string', default: '1' },
    {
      key: 'staalkwaliteit', label: 'Staalkwaliteit', labelEn: 'Steel grade', type: 'enum',
      default: STANDAARD_STAALKWALITEIT, options: STAALKWALITEITEN,
    },
    { key: 'naam', label: 'Onderschrift', labelEn: 'Caption', type: 'string', default: 'Vloer met vorstrand' },
    { key: 'toonMaten', label: 'Maatlijnen tonen', labelEn: 'Show dimensions', type: 'boolean', default: true },
  ],
  layout: vorstrandLayout,
  rebarItems,
  realSizeMm(params) {
    const L = vorstrandLayout(params);
    return { width: L.W, height: L.H };
  },
  snapPoints: bboxSnapPunten,
  render(params, bbox) {
    const L = vorstrandLayout(params);
    const { p } = L;
    const { S, X, Y } = pasIn(L.W, L.H, bbox);
    const f = L.F * S;
    const fijn = Math.max(0.3, Math.min(0.9, f * 0.05));
    const staafLw = Math.max(0.6, Math.min(2, p.netDiameter * S * 0.9));
    const cmds = [];
    cmds.push({ kind: 'polyline', close: true, role: 'beton', points: L.omtrek.map((q) => ({ x: X(q.x), y: Y(q.y) })) });

    for (const n of L.netten) {
      cmds.push({ kind: 'line', x1: X(n.x1), y1: Y(n.y), x2: X(n.x2), y2: Y(n.y), lineWidth: staafLw, role: 'net' });
      for (const s of n.stippen) cmds.push(stip(X(s.x), Y(s.y), L.stipR * S, fijn));
    }
    const b = L.beugel;
    cmds.push({
      kind: 'polyline', close: true, role: 'beugel', lineWidth: staafLw,
      points: [
        { x: X(b.x), y: Y(b.y) }, { x: X(b.x + b.w), y: Y(b.y) },
        { x: X(b.x + b.w), y: Y(b.y + b.h) }, { x: X(b.x), y: Y(b.y + b.h) },
      ],
    });
    const hk = Math.min(b.w, b.h) * 0.18;
    cmds.push({ kind: 'line', x1: X(b.x + hk * 0.3), y1: Y(b.y), x2: X(b.x + hk * 1.3), y2: Y(b.y + hk), lineWidth: staafLw, role: 'beugel' });
    cmds.push({ kind: 'line', x1: X(b.x), y1: Y(b.y + hk * 0.3), x2: X(b.x + hk), y2: Y(b.y + hk * 1.3), lineWidth: staafLw, role: 'beugel' });
    for (const r of L.rand) cmds.push(stip(X(r.x), Y(r.y), L.randR * S, fijn));

    for (const a of L.aanwijzers) {
      if (!a.nr) continue;
      const r = staafnummerStraal(a.nr, L.F);
      cmds.push({ kind: 'line', x1: X(a.x - r), y1: Y(a.y), x2: X(a.doel.x), y2: Y(a.doel.y), lineWidth: fijn, role: 'aanwijslijn' });
      cmds.push(...staafnummerBol(a.nr, X(a.x), Y(a.y), f));
    }

    if (p.toonMaten) {
      const { ox, oy, F } = L;
      const ms = f * 0.85;
      // Hoogte vorstrand (links), breedte vorstrand (onder), vloerdikte (rechts).
      cmds.push(...maatlijn(X(ox - F * 1.4), Y(oy + p.vorstrandHoogte), X(ox - F * 1.4), Y(oy), String(Math.round(p.vorstrandHoogte)), ms, -1));
      cmds.push(...maatlijn(X(ox), Y(oy + p.vorstrandHoogte + F * 1.2), X(ox + p.vorstrandBreedte), Y(oy + p.vorstrandHoogte + F * 1.2), String(Math.round(p.vorstrandBreedte)), ms, 1));
      const xr = ox + L.Lt + F * 1.4;
      cmds.push(...maatlijn(X(xr), Y(oy), X(xr), Y(oy + p.vloerdikte), String(Math.round(p.vloerdikte)), ms, -1));
    }

    let y = L.legendaY;
    for (const r of L.legenda) {
      let x = L.F;
      if (r.nr) {
        const rr = staafnummerStraal(r.nr, L.F);
        cmds.push(...staafnummerBol(r.nr, X(x + rr), Y(y), f));
        x += 2 * rr + L.F * 0.5;
      }
      const w = tekstBreedte(r.tekst, L.F);
      cmds.push(...tekstMetDiameter(r.tekst, X(x + w / 2), Y(y), f, { role: 'legenda' }));
      y += L.F * 1.6;
    }
    return cmds;
  },
};
