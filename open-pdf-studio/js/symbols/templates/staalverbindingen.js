// Parametrische STAALVERBINDINGEN op ware maat:
//   * KOPPLAAT BIJ LIGGER — zijaanzicht van het liggereinde met de kopplaat,
//     bouten en hoeklassen, of het kopaanzicht van de plaat met het profiel en
//     het boutpatroon;
//   * VOETPLAAT BIJ STAALPROFIEL — bovenaanzicht van de voetplaat met de
//     kolomdoorsnede en de ankers, of het zijaanzicht met ondersabeling,
//     funderingsbovenkant en ankerlengte.
//
// Profielmaten komen uit templates/staalprofiel.js (HEA/HEB/IPE), boutmaten
// uit templates/bout.js. Boutgaten zijn normale ronde gaten volgens
// NEN-EN 1090-2 tabel 11: d0 = d + 1 mm (M12, M14), d + 2 mm (M16 t/m M24) of
// d + 3 mm (M27 en groter). Ankergaten in de voetplaat zijn ruim vanwege de
// stelruimte: standaard d + 6 mm (ANKERGAT_SPELING), per symbool in te
// stellen met de parameter ankerGat. De automatische rand- en tussenafstanden
// en de controle volgen de minima uit NEN-EN 1993-1-8 tabel 3.3
// (e1, e2 ≥ 1,2·d0; p1 ≥ 2,2·d0; p2 ≥ 2,4·d0), met d0 de werkelijke gatmaat.

import { I_PROFIEL_TABEL, iSectionPts } from './staalprofiel.js';
import {
  BOUT_MATEN, zeskantZijaanzicht, ringZijaanzicht, schachtZijaanzicht,
} from './bout.js';
import { getal, geheelGetal, pasIn, bboxSnapPunten, rechthoek } from './wapening-tekst.js';

export const STAALSOORTEN = ['S235', 'S275', 'S355'];
export const BOUTKLASSEN = ['4.6', '5.6', '8.8', '10.9'];
const PROFIEL = new Map(I_PROFIEL_TABEL.map((r) => [r[0], r]));
const PROFIEL_NAMEN = I_PROFIEL_TABEL.map((r) => r[0]);
const BOUT_NAMEN = ['M12', 'M16', 'M20', 'M22', 'M24'];

const ceil5 = (v) => Math.ceil(v / 5 - 1e-9) * 5;

/** Gatdiameter d0 (mm) van een normaal rond gat bij een boutdiameter d (NEN-EN 1090-2 tabel 11). */
export function gatDiameter(d) {
  if (d <= 14) return d + 1;
  if (d <= 24) return d + 2;
  return d + 3;
}

/** Standaard speling (mm) van een ankergat in een voetplaat: d0 = d + 6. */
export const ANKERGAT_SPELING = 6;

/**
 * Gatdiameter d0 (mm) van een ankergat in de voetplaat bij een ankerdiameter
 * d. `ankerGat` > d is een opgegeven gatmaat; anders d + ANKERGAT_SPELING.
 */
export function ankerGatDiameter(d, ankerGat = 0) {
  return ankerGat > d ? ankerGat : d + ANKERGAT_SPELING;
}

function profiel(naam, standaard) {
  const r = PROFIEL.get(naam) || PROFIEL.get(standaard);
  const [maat, h, b, tw, tf, rr] = r;
  return { maat, h, b, tw, tf, r: rr };
}

function bout(naam) {
  const key = BOUT_MATEN[naam] ? naam : 'M20';
  return { naam: key, ...BOUT_MATEN[key] };
}

function dashDot(len) {
  const u = Math.max(2.5, Math.min(10, len * 0.05));
  return [u, u * 0.45, u * 0.18, u * 0.45];
}

/** Controle van rand- en tussenafstanden (NEN-EN 1993-1-8 tabel 3.3). */
export function controleerAfstanden({ d0, e1, e2, p1, p2 }) {
  const regels = [
    ['e1', e1, 1.2 * d0],
    ['e2', e2, 1.2 * d0],
    ['p1', p1, 2.2 * d0],
    ['p2', p2, 2.4 * d0],
  ];
  return regels
    .filter(([, waarde]) => Number.isFinite(waarde))
    .map(([code, waarde, minimum]) => ({ code, waarde, minimum, ok: waarde >= minimum - 1e-9 }));
}

// ─── Kopplaat bij ligger ─────────────────────────────────────────────────

export function kopplaatParams(params = {}) {
  const p = params || {};
  return {
    profiel: PROFIEL.has(p.profiel) ? p.profiel : 'IPE 300',
    aanzicht: p.aanzicht === 'kop' ? 'kop' : 'zij',
    plaatDikte: getal(p.plaatDikte, 15, 4),
    plaatBreedte: getal(p.plaatBreedte, 0, 0),
    overstek: getal(p.overstek, 0, 0),
    boutMaat: BOUT_MATEN[p.boutMaat] ? p.boutMaat : 'M20',
    boutRijen: Math.min(8, geheelGetal(p.boutRijen, 2, 1)),
    e1: getal(p.e1, 0, 0),
    e2: getal(p.e2, 0, 0),
    boutklasse: BOUTKLASSEN.includes(String(p.boutklasse)) ? String(p.boutklasse) : '8.8',
    staalsoort: STAALSOORTEN.includes(p.staalsoort) ? p.staalsoort : 'S235',
    liggerLengte: getal(p.liggerLengte, 0, 0),
    toonLabel: p.toonLabel !== false,
  };
}

/** Plaatmaat, boutposities en de afstandscontrole (lokale mm, plaat-assen). */
export function kopplaatGeometrie(params) {
  const p = kopplaatParams(params);
  const pr = profiel(p.profiel, 'IPE 300');
  const bt = bout(p.boutMaat);
  const d0 = gatDiameter(bt.d);
  const bp = p.plaatBreedte > 0 ? p.plaatBreedte : pr.b;
  const hp = pr.h + 2 * p.overstek;
  const e1 = p.e1 > 0 ? p.e1
    : (p.overstek >= 2.4 * d0 ? ceil5(p.overstek / 2) : ceil5(p.overstek + pr.tf + 1.5 * d0));
  const e2 = p.e2 > 0 ? p.e2 : ceil5(1.5 * d0);
  const n = p.boutRijen;
  const rijen = n === 1 ? [hp / 2] : Array.from({ length: n }, (_, i) => e1 + ((hp - 2 * e1) * i) / (n - 1));
  const p1 = n > 1 ? (hp - 2 * e1) / (n - 1) : NaN;
  const p2 = bp - 2 * e2;
  const kolommen = [e2, bp - e2];
  return {
    p, profiel: pr, bout: bt, d0, bp, hp, e1, e2, p1, p2, rijen, kolommen,
    aantalBouten: rijen.length * kolommen.length,
    controle: controleerAfstanden({ d0, e1, e2, p1, p2 }),
  };
}

export function kopplaatLabel(params) {
  const g = kopplaatGeometrie(params);
  return [
    `kopplaat ${Math.round(g.bp)}×${Math.round(g.hp)}×${g.p.plaatDikte} ${g.p.staalsoort}`,
    `${g.aantalBouten} ${g.bout.naam}-${g.p.boutklasse} · ${g.profiel.maat}`,
  ];
}

/** Volledige opmaak in lokale mm (y omlaag). */
export function kopplaatLayout(params) {
  const g = kopplaatGeometrie(params);
  const { p, profiel: pr, bout: bt } = g;
  const F = Math.max(10, Math.max(g.hp, g.bp) * 0.05);
  const labels = p.toonLabel ? kopplaatLabel(p) : [];
  const labelH = labels.length ? labels.length * F * 1.5 + F * 0.5 : 0;
  if (p.aanzicht === 'kop') {
    const m = F;
    const W = Math.max(g.bp + 2 * m, ...labels.map((t) => t.length * F * 0.55 + F));
    const ox = (W - g.bp) / 2, oy = m;
    return { g, F, labels, ox, oy, W, H: oy + g.hp + m + labelH, labelY: oy + g.hp + m + F * 0.6 };
  }
  const Lb = p.liggerLengte > 0 ? p.liggerLengte : 1.5 * pr.h;
  const rechts = 2 * bt.d;                  // uitstekende bout achter de plaat
  const m = Math.max(F * 0.6, pr.h * 0.08); // ruimte voor de breeklijn
  const breedte = Lb + p.plaatDikte + rechts;
  const W = Math.max(breedte + 2 * m, ...labels.map((t) => t.length * F * 0.55 + F));
  const ox = (W - breedte) / 2, oy = m;
  return {
    g, F, labels, ox, oy, Lb, W,
    H: oy + g.hp + m + labelH, labelY: oy + g.hp + m + F * 0.6,
  };
}

function kopplaatZij(L, X, Y, S, cmds) {
  const { g, ox, oy, Lb } = L;
  const { p, profiel: pr, bout: bt } = g;
  const tp = p.plaatDikte;
  const ov = p.overstek;
  const xp = ox + Lb;                 // linkerzijde van de plaat
  // Ligger: flenzen + breeklijn links.
  const yT = oy + ov, yB = oy + ov + pr.h;
  cmds.push({ kind: 'line', x1: X(ox), y1: Y(yT), x2: X(xp), y2: Y(yT), role: 'ligger' });
  cmds.push({ kind: 'line', x1: X(ox), y1: Y(yB), x2: X(xp), y2: Y(yB), role: 'ligger' });
  cmds.push({ kind: 'line', x1: X(ox), y1: Y(yT + pr.tf), x2: X(xp), y2: Y(yT + pr.tf), role: 'ligger' });
  cmds.push({ kind: 'line', x1: X(ox), y1: Y(yB - pr.tf), x2: X(xp), y2: Y(yB - pr.tf), role: 'ligger' });
  const z = pr.h * 0.06;
  cmds.push({
    kind: 'polyline', role: 'breeklijn',
    points: [
      { x: X(ox), y: Y(yT) }, { x: X(ox), y: Y(yT + pr.h * 0.42) },
      { x: X(ox + z), y: Y(yT + pr.h * 0.48) }, { x: X(ox - z), y: Y(yT + pr.h * 0.54) },
      { x: X(ox), y: Y(yT + pr.h * 0.6) }, { x: X(ox), y: Y(yB) },
    ],
  });
  // Kopplaat.
  cmds.push(rechthoek(X(xp), Y(oy), tp * S, g.hp * S, { role: 'kopplaat' }));
  // Hoeklassen aan de flenzen (gevulde driehoekjes, a ≈ 0,5·tf).
  const a = Math.max(4, pr.tf * 0.7);
  const las = (y, richting) => ({
    kind: 'polyline', close: true, fill: true, role: 'las',
    points: [{ x: X(xp), y: Y(y) }, { x: X(xp - a), y: Y(y) }, { x: X(xp), y: Y(y + richting * a) }],
  });
  cmds.push(las(yT + pr.tf, 1), las(yB - pr.tf, -1));
  if (ov > a) cmds.push(las(yT, -1), las(yB, 1));
  // Bouten per rij: ring + moer (zeskant, beide zijden afgeschuind) aan de
  // liggerzijde, draadeind met afgeschuinde punt, schacht door de plaat,
  // hartlijn. Zelfde tekenwijze als het boutsymbool (templates/bout.js).
  for (const ry of g.rijen) {
    const y = oy + ry;
    // u loopt van de plaat af naar links (de boutas), v dwars daarop.
    const naarLinks = (u, v) => ({ x: X(xp - u), y: Y(y + v) });
    const xm0 = xp - bt.ringT - bt.m;
    cmds.push(...ringZijaanzicht(naarLinks, 0, bt.ringT, bt.ringD));
    cmds.push(...zeskantZijaanzicht(naarLinks, bt.ringT, bt.ringT + bt.m, bt.s, { afschuining: [true, true], role: 'moer' }));
    const x0 = xm0 - 0.8 * bt.d, x1 = xp + tp + 1.4 * bt.d;
    cmds.push(...schachtZijaanzicht(naarLinks, xp - xm0, xp - x0, bt, { uDraad: xp - xm0, punt: true, role: 'bout' }));
    cmds.push({ kind: 'line', x1: X(xp + tp), y1: Y(y - bt.d / 2), x2: X(x1), y2: Y(y - bt.d / 2), role: 'bout' });
    cmds.push({ kind: 'line', x1: X(xp + tp), y1: Y(y + bt.d / 2), x2: X(x1), y2: Y(y + bt.d / 2), role: 'bout' });
    const lijn = (x1 - x0 + bt.d) * S;
    cmds.push({ kind: 'line', x1: X(x0 - bt.d * 0.5), y1: Y(y), x2: X(x1 + bt.d * 0.5), y2: Y(y), dash: dashDot(lijn), role: 'hartlijn' });
  }
}

function kopplaatKop(L, X, Y, S, cmds) {
  const { g, ox, oy } = L;
  const { p, profiel: pr } = g;
  cmds.push(rechthoek(X(ox), Y(oy), g.bp * S, g.hp * S, { role: 'kopplaat' }));
  // Profiel (doorsnede, massief zwart) gecentreerd op de plaat.
  const px = ox + (g.bp - pr.b) / 2, py = oy + p.overstek;
  cmds.push({
    kind: 'rings', fill: true, role: 'profiel',
    loops: [iSectionPts(pr.b, pr.h, pr.tw, pr.tf, pr.r).map((q) => ({ x: X(px + q.x), y: Y(py + q.y) }))],
  });
  // Gaten met hartkruis.
  const r = g.d0 / 2;
  for (const ry of g.rijen) {
    for (const kx of g.kolommen) {
      const cx = X(ox + kx), cy = Y(oy + ry);
      cmds.push({ kind: 'circle', cx, cy, r: r * S, role: 'gat' });
      const k = r * 1.6 * S;
      cmds.push({ kind: 'line', x1: cx - k, y1: cy, x2: cx + k, y2: cy, role: 'hartkruis' });
      cmds.push({ kind: 'line', x1: cx, y1: cy - k, x2: cx, y2: cy + k, role: 'hartkruis' });
    }
  }
}

export const kopplaatTemplate = {
  id: 'kopplaat',
  name: 'Kopplaat bij ligger',
  nameEn: 'End plate at beam',
  category: 'NL Constructie',
  defaultSize: { width: 240, height: 160 },
  fixedSize: true,
  zoektermen: ['kopplaat', 'kopplaatverbinding', 'ligger', 'end plate', 'boutverbinding'],
  params: [
    { key: 'profiel', label: 'Profiel', labelEn: 'Section', type: 'enum', default: 'IPE 300', options: PROFIEL_NAMEN },
    {
      key: 'aanzicht', label: 'Aanzicht', labelEn: 'View', type: 'enum', default: 'zij',
      options: [{ value: 'zij', label: 'Zijaanzicht ligger' }, { value: 'kop', label: 'Kopaanzicht plaat' }],
    },
    { key: 'plaatDikte', label: 'Plaatdikte (mm)', labelEn: 'Plate thickness (mm)', type: 'number', default: 15, min: 4, step: 1 },
    { key: 'plaatBreedte', label: 'Plaatbreedte (mm, 0 = flensbreedte)', labelEn: 'Plate width (mm, 0 = flange width)', type: 'number', default: 0, min: 0, step: 5 },
    { key: 'overstek', label: 'Overstek boven/onder (mm)', labelEn: 'Extension top/bottom (mm)', type: 'number', default: 0, min: 0, step: 5 },
    { key: 'boutMaat', label: 'Bout', labelEn: 'Bolt', type: 'enum', default: 'M20', options: BOUT_NAMEN },
    { key: 'boutRijen', label: 'Aantal boutrijen', labelEn: 'Bolt rows', type: 'number', default: 2, min: 1, max: 8, step: 1 },
    { key: 'e1', label: 'Randafstand e1 (mm, 0 = auto)', labelEn: 'Edge distance e1 (mm, 0 = auto)', type: 'number', default: 0, min: 0, step: 5 },
    { key: 'e2', label: 'Randafstand e2 (mm, 0 = auto)', labelEn: 'Edge distance e2 (mm, 0 = auto)', type: 'number', default: 0, min: 0, step: 5 },
    { key: 'boutklasse', label: 'Boutklasse', labelEn: 'Bolt class', type: 'enum', default: '8.8', options: BOUTKLASSEN },
    { key: 'staalsoort', label: 'Staalsoort', labelEn: 'Steel grade', type: 'enum', default: 'S235', options: STAALSOORTEN },
    { key: 'liggerLengte', label: 'Getekende liggerlengte (mm, 0 = auto)', labelEn: 'Drawn beam length (mm, 0 = auto)', type: 'number', default: 0, min: 0, step: 10 },
    { key: 'toonLabel', label: 'Omschrijving tonen', labelEn: 'Show description', type: 'boolean', default: true },
  ],
  layout: kopplaatLayout,
  realSizeMm(params) {
    const L = kopplaatLayout(params);
    return { width: L.W, height: L.H };
  },
  snapPoints: bboxSnapPunten,
  render(params, bbox) {
    const L = kopplaatLayout(params);
    const { S, X, Y } = pasIn(L.W, L.H, bbox);
    const cmds = [];
    if (L.g.p.aanzicht === 'kop') kopplaatKop(L, X, Y, S, cmds);
    else kopplaatZij(L, X, Y, S, cmds);
    L.labels.forEach((t, i) => cmds.push({
      kind: 'text', x: X(L.W / 2), y: Y(L.labelY + i * L.F * 1.5), text: t, size: L.F * S, role: 'label',
    }));
    return cmds;
  },
};

// ─── Voetplaat bij staalprofiel ──────────────────────────────────────────

export function voetplaatParams(params = {}) {
  const p = params || {};
  const n = String(p.ankerAantal ?? '4');
  return {
    profiel: PROFIEL.has(p.profiel) ? p.profiel : 'HEA 200',
    aanzicht: p.aanzicht === 'zij' ? 'zij' : 'boven',
    plaatLengte: getal(p.plaatLengte, 0, 0),
    plaatBreedte: getal(p.plaatBreedte, 0, 0),
    plaatDikte: getal(p.plaatDikte, 20, 4),
    ankerMaat: BOUT_MATEN[p.ankerMaat] ? p.ankerMaat : 'M20',
    ankerAantal: ['2', '4', '6'].includes(n) ? Number(n) : 4,
    ankerGat: getal(p.ankerGat, 0, 0),
    e: getal(p.e, 0, 0),
    ankerLengte: getal(p.ankerLengte, 300, 50),
    ondersabeling: getal(p.ondersabeling, 30, 0),
    boutklasse: BOUTKLASSEN.includes(String(p.boutklasse)) ? String(p.boutklasse) : '4.6',
    staalsoort: STAALSOORTEN.includes(p.staalsoort) ? p.staalsoort : 'S235',
    toonLabel: p.toonLabel !== false,
  };
}

/** Plaatmaat en ankerposities (t.o.v. het plaatmidden, x langs het profiel-h). */
export function voetplaatGeometrie(params) {
  const p = voetplaatParams(params);
  const pr = profiel(p.profiel, 'HEA 200');
  const an = bout(p.ankerMaat);
  const d0 = ankerGatDiameter(an.d, p.ankerGat);
  const rand = Math.max(3 * d0, 60);
  const L = p.plaatLengte > 0 ? p.plaatLengte : Math.ceil((pr.h + 2 * rand) / 10) * 10;
  const B = p.plaatBreedte > 0 ? p.plaatBreedte : Math.ceil((pr.b + 2 * rand) / 10) * 10;
  const e = p.e > 0 ? p.e : ceil5(1.5 * d0);
  const ax = L / 2 - e, ay = B / 2 - e;
  let ankers;
  if (p.ankerAantal === 2) ankers = [{ x: -ax, y: 0 }, { x: ax, y: 0 }];
  else if (p.ankerAantal === 6) {
    ankers = [{ x: -ax, y: -ay }, { x: ax, y: -ay }, { x: -ax, y: ay }, { x: ax, y: ay }, { x: 0, y: -ay }, { x: 0, y: ay }];
  } else ankers = [{ x: -ax, y: -ay }, { x: ax, y: -ay }, { x: -ax, y: ay }, { x: ax, y: ay }];
  // Vrije ruimte tussen het hart van een anker en de flens/rand van het profiel.
  const vrij = Math.min(...ankers.map((a) => {
    const dx = Math.abs(a.x) - pr.h / 2;
    const dy = Math.abs(a.y) - pr.b / 2;
    return Math.max(dx, dy);
  }));
  return {
    p, profiel: pr, anker: an, d0, L, B, e, ankers,
    vrijeRuimte: vrij,
    controle: controleerAfstanden({
      d0, e1: e, e2: e,
      p1: p.ankerAantal === 2 ? NaN : (p.ankerAantal === 6 ? ax : 2 * ay),
      p2: 2 * ax,
    }),
  };
}

export function voetplaatLabel(params) {
  const g = voetplaatGeometrie(params);
  return [
    `voetplaat ${Math.round(g.L)}×${Math.round(g.B)}×${g.p.plaatDikte} ${g.p.staalsoort}`,
    `${g.ankers.length} ankers ${g.anker.naam}-${g.p.boutklasse} l=${Math.round(g.p.ankerLengte)} · ${g.profiel.maat}`,
  ];
}

export function voetplaatLayout(params) {
  const g = voetplaatGeometrie(params);
  const { p, profiel: pr, anker: an } = g;
  const F = Math.max(10, Math.max(g.L, g.B) * 0.06);
  const labels = p.toonLabel ? voetplaatLabel(p) : [];
  const labelH = labels.length ? labels.length * F * 1.5 + F * 0.5 : 0;
  const tekstW = Math.max(0, ...labels.map((t) => t.length * F * 0.55 + F));
  if (p.aanzicht === 'zij') {
    const uit = g.L * 0.2;                 // funderingslijn steekt uit
    const kolomH = pr.h * 0.9;
    const boven = kolomH + an.m + an.ringT + 0.6 * an.d;
    const onder = p.plaatDikte + p.ondersabeling + p.ankerLengte;
    const breedte = g.L + 2 * uit;
    const W = Math.max(breedte + 2 * F * 0.5, tekstW);
    const cx = W / 2;
    const oy = F * 0.5 + boven;            // bovenkant voetplaat
    return {
      g, F, labels, W, cx, oy, uit, kolomH,
      H: oy + onder + F * 0.8 + labelH, labelY: oy + onder + F * 1.4,
    };
  }
  const m = Math.max(F * 0.8, Math.max(g.L, g.B) * 0.1); // ruimte voor de hartlijnen
  const W = Math.max(g.L + 2 * m, tekstW);
  const cx = W / 2, cy = m + g.B / 2;
  return { g, F, labels, W, cx, cy, H: m + g.B + m + labelH, labelY: m + g.B + m + F * 0.6 };
}

function voetplaatBoven(L, X, Y, S, cmds) {
  const { g, cx, cy } = L;
  const pr = g.profiel;
  cmds.push(rechthoek(X(cx - g.L / 2), Y(cy - g.B / 2), g.L * S, g.B * S, { role: 'voetplaat' }));
  // Kolomdoorsnede: het profiel-h langs x (lijf horizontaal), massief.
  const pts = iSectionPts(pr.b, pr.h, pr.tw, pr.tf, pr.r);
  cmds.push({
    kind: 'rings', fill: true, role: 'profiel',
    loops: [pts.map((q) => ({ x: X(cx - pr.h / 2 + q.y), y: Y(cy - pr.b / 2 + q.x) }))],
  });
  const ex = Math.max(g.L, g.B) * 0.08;
  cmds.push({ kind: 'line', x1: X(cx - g.L / 2 - ex), y1: Y(cy), x2: X(cx + g.L / 2 + ex), y2: Y(cy), dash: dashDot((g.L + 2 * ex) * S), role: 'hartlijn' });
  cmds.push({ kind: 'line', x1: X(cx), y1: Y(cy - g.B / 2 - ex), x2: X(cx), y2: Y(cy + g.B / 2 + ex), dash: dashDot((g.B + 2 * ex) * S), role: 'hartlijn' });
  for (const a of g.ankers) {
    const ax = X(cx + a.x), ay = Y(cy + a.y);
    cmds.push({ kind: 'circle', cx: ax, cy: ay, r: (g.d0 / 2) * S, role: 'gat' });
    cmds.push({ kind: 'circle', cx: ax, cy: ay, r: (g.anker.ringD / 2) * S, role: 'ring' });
    const k = g.d0 * 0.9 * S;
    cmds.push({ kind: 'line', x1: ax - k, y1: ay, x2: ax + k, y2: ay, role: 'hartkruis' });
    cmds.push({ kind: 'line', x1: ax, y1: ay - k, x2: ax, y2: ay + k, role: 'hartkruis' });
  }
}

function voetplaatZij(L, X, Y, S, cmds) {
  const { g, cx, oy, uit, kolomH } = L;
  const { p, profiel: pr, anker: an } = g;
  const tp = p.plaatDikte, og = p.ondersabeling;
  // Kolom (flenzen in aanzicht) met breeklijn boven.
  const k0 = cx - pr.h / 2, k1 = cx + pr.h / 2, top = oy - kolomH;
  for (const x of [k0, k0 + pr.tf, k1 - pr.tf, k1]) {
    cmds.push({ kind: 'line', x1: X(x), y1: Y(top), x2: X(x), y2: Y(oy), role: 'kolom' });
  }
  const z = pr.h * 0.05;
  cmds.push({
    kind: 'polyline', role: 'breeklijn',
    points: [
      { x: X(k0), y: Y(top) }, { x: X(cx - z * 2), y: Y(top) }, { x: X(cx - z), y: Y(top - z) },
      { x: X(cx + z), y: Y(top + z) }, { x: X(cx + z * 2), y: Y(top) }, { x: X(k1), y: Y(top) },
    ],
  });
  // Voetplaat en ondersabeling.
  cmds.push(rechthoek(X(cx - g.L / 2), Y(oy), g.L * S, tp * S, { role: 'voetplaat' }));
  if (og > 0) cmds.push(rechthoek(X(cx - g.L / 2), Y(oy + tp), g.L * S, og * S, { role: 'ondersabeling', dash: [Math.max(2, og * S * 0.4), Math.max(1.5, og * S * 0.25)] }));
  // Bovenkant fundering met arcering-streepjes.
  const yf = oy + tp + og;
  const fx0 = cx - g.L / 2 - uit, fx1 = cx + g.L / 2 + uit;
  cmds.push({ kind: 'line', x1: X(fx0), y1: Y(yf), x2: X(fx1), y2: Y(yf), role: 'fundering' });
  const stap = (fx1 - fx0) / 14;
  for (let x = fx0 + stap / 2; x < fx1; x += stap) {
    cmds.push({ kind: 'line', x1: X(x), y1: Y(yf), x2: X(x - stap * 0.6), y2: Y(yf + stap * 0.6), role: 'arcering' });
  }
  // Hoeklassen kolom–plaat.
  const a = Math.max(4, pr.tf * 0.7);
  for (const [x, r] of [[k0, -1], [k1, 1]]) {
    cmds.push({
      kind: 'polyline', close: true, fill: true, role: 'las',
      points: [{ x: X(x), y: Y(oy) }, { x: X(x + r * a), y: Y(oy) }, { x: X(x), y: Y(oy - a) }],
    });
  }
  // Ankers (unieke x-posities in dit aanzicht).
  const xs = [...new Set(g.ankers.map((q) => Math.round(q.x * 1000) / 1000))];
  const ring = an.ringT;
  for (const ax of xs) {
    const x = cx + ax;
    const yEind = yf + p.ankerLengte;
    // Onderlegring + moer (zeskant, beide zijden afgeschuind) op de plaat en
    // het draadeind erboven, getekend zoals het boutsymbool (templates/bout.js).
    // u loopt vanaf de bovenkant plaat omhoog langs de ankeras.
    const omhoog = (u, v) => ({ x: X(x + v), y: Y(oy - u) });
    cmds.push(...ringZijaanzicht(omhoog, 0, ring, an.ringD));
    cmds.push(...zeskantZijaanzicht(omhoog, ring, ring + an.m, an.s, { afschuining: [true, true], role: 'moer' }));
    cmds.push(...schachtZijaanzicht(omhoog, ring + an.m, ring + an.m + 0.6 * an.d, an, { uDraad: ring + an.m, punt: true, role: 'anker' }));
    // Door plaat, ondersabeling en fundering verborgen (gestreept).
    for (const dx of [-an.d / 2, an.d / 2]) {
      cmds.push({ kind: 'line', x1: X(x + dx), y1: Y(oy), x2: X(x + dx), y2: Y(yEind), dash: [Math.max(2, an.d * S * 0.6), Math.max(1.5, an.d * S * 0.4)], role: 'anker' });
    }
    // Ankerplaatje aan het einde.
    cmds.push({ kind: 'line', x1: X(x - 1.5 * an.d), y1: Y(yEind), x2: X(x + 1.5 * an.d), y2: Y(yEind), dash: [Math.max(2, an.d * S * 0.6), Math.max(1.5, an.d * S * 0.4)], role: 'ankerplaat' });
  }
}

export const voetplaatTemplate = {
  id: 'voetplaat',
  name: 'Voetplaat bij staalprofiel',
  nameEn: 'Base plate at steel column',
  category: 'NL Constructie',
  defaultSize: { width: 220, height: 200 },
  fixedSize: true,
  zoektermen: ['voetplaat', 'kolomvoet', 'ankers', 'ankerbout', 'base plate', 'ondersabeling'],
  params: [
    { key: 'profiel', label: 'Profiel', labelEn: 'Section', type: 'enum', default: 'HEA 200', options: PROFIEL_NAMEN },
    {
      key: 'aanzicht', label: 'Aanzicht', labelEn: 'View', type: 'enum', default: 'boven',
      options: [{ value: 'boven', label: 'Bovenaanzicht' }, { value: 'zij', label: 'Zijaanzicht' }],
    },
    { key: 'plaatLengte', label: 'Plaatlengte (mm, 0 = auto)', labelEn: 'Plate length (mm, 0 = auto)', type: 'number', default: 0, min: 0, step: 10 },
    { key: 'plaatBreedte', label: 'Plaatbreedte (mm, 0 = auto)', labelEn: 'Plate width (mm, 0 = auto)', type: 'number', default: 0, min: 0, step: 10 },
    { key: 'plaatDikte', label: 'Plaatdikte (mm)', labelEn: 'Plate thickness (mm)', type: 'number', default: 20, min: 4, step: 1 },
    { key: 'ankerMaat', label: 'Anker', labelEn: 'Anchor', type: 'enum', default: 'M20', options: BOUT_NAMEN },
    {
      key: 'ankerAantal', label: 'Aantal ankers', labelEn: 'Number of anchors', type: 'enum', default: '4',
      options: [{ value: '2', label: '2 (op de lijfas)' }, { value: '4', label: '4 (hoeken)' }, { value: '6', label: '6 (hoeken + midden)' }],
    },
    { key: 'ankerGat', label: 'Gatdiameter anker (mm, 0 = d + 6)', labelEn: 'Anchor hole diameter (mm, 0 = d + 6)', type: 'number', default: 0, min: 0, step: 1 },
    { key: 'e', label: 'Randafstand anker (mm, 0 = auto)', labelEn: 'Anchor edge distance (mm, 0 = auto)', type: 'number', default: 0, min: 0, step: 5 },
    { key: 'ankerLengte', label: 'Ankerlengte in fundering (mm)', labelEn: 'Anchor embedment (mm)', type: 'number', default: 300, min: 50, step: 10 },
    { key: 'ondersabeling', label: 'Ondersabeling (mm)', labelEn: 'Grout layer (mm)', type: 'number', default: 30, min: 0, step: 5 },
    { key: 'boutklasse', label: 'Ankerklasse', labelEn: 'Anchor class', type: 'enum', default: '4.6', options: BOUTKLASSEN },
    { key: 'staalsoort', label: 'Staalsoort', labelEn: 'Steel grade', type: 'enum', default: 'S235', options: STAALSOORTEN },
    { key: 'toonLabel', label: 'Omschrijving tonen', labelEn: 'Show description', type: 'boolean', default: true },
  ],
  layout: voetplaatLayout,
  realSizeMm(params) {
    const L = voetplaatLayout(params);
    return { width: L.W, height: L.H };
  },
  snapPoints: bboxSnapPunten,
  render(params, bbox) {
    const L = voetplaatLayout(params);
    const { S, X, Y } = pasIn(L.W, L.H, bbox);
    const cmds = [];
    if (L.g.p.aanzicht === 'zij') voetplaatZij(L, X, Y, S, cmds);
    else voetplaatBoven(L, X, Y, S, cmds);
    L.labels.forEach((t, i) => cmds.push({
      kind: 'text', x: X(L.W / 2), y: Y(L.labelY + i * L.F * 1.5), text: t, size: L.F * S, role: 'label',
    }));
    return cmds;
  },
};
