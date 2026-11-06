// GD&T- en bewerkingssymbolen (ISO 1101 / ASME Y14.5, ISO 1302, ISO 129).
//
// Eén bron voor de geometrie: elk teken is een lijst primitieven in een
// 64×64-raster (y naar beneden). Daaruit komen
//   * de statische SVG-stempels van de palettecategorie (gdtSvg), en
//   * de tekencommando's van het parametrische kenmerkkader (feature control
//     frame) — de kenmerk-cel tekent hetzelfde teken op celgrootte.
//
// Primitieven:
//   ['L', x1, y1, x2, y2]                lijn
//   ['C', cx, cy, r]                     cirkel (alleen omtrek)
//   ['P', [[x, y], …], dicht?, gevuld?]  polylijn / veelhoek
//   ['A', cx, cy, r, a0, a1]             boog met de klok mee (radialen)
//   ['T', x, y, grootte, tekst]          tekst, gecentreerd op (x, y)

/** Pijl van staart naar punt met een gevulde kop (slagtekens). */
function pijl(x0, y0, x1, y1, lengte = 11, half = 4.5) {
  const d = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / d;
  const uy = (y1 - y0) / d;
  const bx = x1 - ux * lengte;
  const by = y1 - uy * lengte;
  const r = (v) => Math.round(v * 100) / 100;
  return [
    ['L', x0, y0, r(bx), r(by)],
    ['P', [[x1, y1], [r(bx - uy * half), r(by + ux * half)], [r(bx + uy * half), r(by - ux * half)]], true, true],
  ];
}

// Geometrische kenmerken (ISO 1101). Volgorde = de gebruikelijke tabel:
// vorm, richting, plaats, slag.
export const GDT_KENMERKEN = [
  { id: 'rechtheid', name: 'Rechtheid', nameEn: 'Straightness', geo: [['L', 10, 32, 54, 32]] },
  { id: 'vlakheid', name: 'Vlakheid', nameEn: 'Flatness', geo: [['P', [[20, 22], [56, 22], [44, 42], [8, 42]], true]] },
  { id: 'rondheid', name: 'Rondheid', nameEn: 'Circularity', geo: [['C', 32, 32, 18]] },
  {
    id: 'cilindriciteit', name: 'Cilindriciteit', nameEn: 'Cylindricity',
    // Cirkel met twee raaklijnen onder 60°.
    geo: [['C', 32, 32, 12], ['L', 9.61, 46.78, 33.61, 5.22], ['L', 30.39, 58.78, 54.39, 17.22]],
  },
  { id: 'lijnprofiel', name: 'Profiel van een lijn', nameEn: 'Profile of a line', geo: [['A', 32, 44, 20, Math.PI, 2 * Math.PI]] },
  {
    id: 'vlakprofiel', name: 'Profiel van een vlak', nameEn: 'Profile of a surface',
    geo: [['A', 32, 44, 20, Math.PI, 2 * Math.PI], ['L', 12, 44, 52, 44]],
  },
  { id: 'haaksheid', name: 'Haaksheid', nameEn: 'Perpendicularity', geo: [['L', 32, 12, 32, 50], ['L', 10, 50, 54, 50]] },
  { id: 'hoekigheid', name: 'Hoekigheid', nameEn: 'Angularity', geo: [['L', 10, 50, 54, 50], ['L', 10, 50, 48, 28]] },
  { id: 'evenwijdigheid', name: 'Evenwijdigheid', nameEn: 'Parallelism', geo: [['L', 14, 52, 34, 12], ['L', 30, 52, 50, 12]] },
  { id: 'positie', name: 'Positie', nameEn: 'Position', geo: [['C', 32, 32, 13], ['L', 32, 8, 32, 56], ['L', 8, 32, 56, 32]] },
  { id: 'concentriciteit', name: 'Concentriciteit', nameEn: 'Concentricity', geo: [['C', 32, 32, 8], ['C', 32, 32, 19]] },
  {
    id: 'symmetrie', name: 'Symmetrie', nameEn: 'Symmetry',
    geo: [['L', 8, 32, 56, 32], ['L', 18, 20, 46, 20], ['L', 18, 44, 46, 44]],
  },
  { id: 'slag', name: 'Cirkelvormige slag', nameEn: 'Circular runout', geo: pijl(14, 50, 50, 14) },
  {
    id: 'totale-slag', name: 'Totale slag', nameEn: 'Total runout',
    geo: [...pijl(8, 52, 36, 24), ...pijl(26, 52, 54, 24), ['L', 8, 52, 26, 52]],
  },
];

// Aanvullende GD&T-tekens: referentievlak (datum feature) en
// materiaalvoorwaarden.
export const GDT_AANVULLEND = [
  {
    id: 'referentie', name: 'Referentie-element', nameEn: 'Datum feature',
    geo: [
      ['P', [[20, 6], [44, 6], [44, 30], [20, 30]], true],
      ['T', 32, 18, 18, 'A'],
      ['L', 32, 30, 32, 44],
      ['P', [[21, 56], [43, 56], [32, 44]], true, true],
    ],
  },
  { id: 'mmc', name: 'Maximum-materiaalvoorwaarde', nameEn: 'Maximum material condition, MMC', geo: [['C', 32, 32, 18], ['T', 32, 32, 22, 'M']] },
  { id: 'lmc', name: 'Minimum-materiaalvoorwaarde', nameEn: 'Least material condition, LMC', geo: [['C', 32, 32, 18], ['T', 32, 32, 22, 'L']] },
];

// Bewerkingssymbolen: oppervlaktegesteldheid (ISO 1302) en maattekens.
const OPP = [[16, 34.7], [26, 52], [46, 17.4]];
export const BEWERKING_SYMBOLEN = [
  { id: 'oppervlak', name: 'Oppervlaktegesteldheid (basis)', nameEn: 'Surface texture, basic', geo: [['P', OPP]] },
  {
    id: 'oppervlak-verspanen', name: 'Oppervlak: verspanen vereist', nameEn: 'Surface texture, material removal required',
    geo: [['P', OPP], ['L', 16, 34.7, 36, 34.7]],
  },
  {
    id: 'oppervlak-niet-verspanen', name: 'Oppervlak: verspanen niet toegestaan', nameEn: 'Surface texture, material removal prohibited',
    geo: [['P', OPP], ['C', 26, 40.47, 5.77]],
  },
  {
    id: 'rondom', name: 'Rondom', nameEn: 'All around',
    geo: [['L', 8, 54, 23.76, 38.24], ['C', 28, 34, 6], ['L', 34, 34, 56, 34]],
  },
  { id: 'verzinking', name: 'Verzinking', nameEn: 'Countersink', geo: [['P', [[12, 20], [32, 40], [52, 20]]]] },
  { id: 'verzinkboring', name: 'Verzinkboring', nameEn: 'Counterbore', geo: [['P', [[14, 20], [14, 44], [50, 44], [50, 20]]]] },
  {
    id: 'diepte', name: 'Diepte', nameEn: 'Depth',
    geo: [['L', 32, 10, 32, 50], ['P', [[24, 38], [32, 50], [40, 38]]], ['L', 18, 50, 46, 50]],
  },
  { id: 'diameter', name: 'Diameter', nameEn: 'Diameter', geo: [['C', 32, 32, 15], ['L', 16, 50, 48, 14]] },
  { id: 'vierkant', name: 'Vierkant', nameEn: 'Square', geo: [['P', [[16, 16], [48, 16], [48, 48], [16, 48]], true]] },
  {
    id: 'bol-diameter', name: 'Boldiameter', nameEn: 'Spherical diameter',
    geo: [['T', 18, 32, 26, 'S'], ['C', 44, 32, 11], ['L', 34, 46, 54, 18]],
  },
];

const KENMERK_BY_ID = new Map(GDT_KENMERKEN.map((k) => [k.id, k]));

// ── SVG ─────────────────────────────────────────────────────────────────────

const getal = (v) => String(Math.round(v * 100) / 100);
const punten = (pts) => pts.map(([x, y]) => `${getal(x)} ${getal(y)}`).join('L');

function svgVan(p) {
  switch (p[0]) {
    case 'L':
      return `<path d="M${getal(p[1])} ${getal(p[2])}L${getal(p[3])} ${getal(p[4])}"/>`;
    case 'C':
      return `<circle cx="${getal(p[1])}" cy="${getal(p[2])}" r="${getal(p[3])}"/>`;
    case 'P':
      return `<path d="M${punten(p[1])}${p[2] ? 'Z' : ''}"${p[3] ? ' fill="#000"' : ''}/>`;
    case 'A': {
      const [, cx, cy, r, a0, a1] = p;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const groot = a1 - a0 > Math.PI ? 1 : 0;
      return `<path d="M${getal(x0)} ${getal(y0)}A${getal(r)} ${getal(r)} 0 ${groot} 1 ${getal(x1)} ${getal(y1)}"/>`;
    }
    case 'T': {
      const [, x, y, size, tekst] = p;
      // Basislijn: het midden van een hoofdletter ligt ~0,35 em boven de basislijn.
      return `<text x="${getal(x)}" y="${getal(y + size * 0.35)}" font-family="Arial, sans-serif" font-size="${getal(size)}" text-anchor="middle" fill="#000" stroke="none">${tekst}</text>`;
    }
    default:
      return '';
  }
}

/** Statische 64×64-SVG van een teken (stempel en paletpictogram). */
export function gdtSvg(geo) {
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${geo.map(svgVan).join('')}</g></svg>`;
}

// ── Tekencommando's ────────────────────────────────────────────────────────

/**
 * Een teken in een vierkante cel (linksboven x, y, zijde s): 64-raster →
 * cel, met wat marge zodat het teken de kaderlijnen niet raakt.
 */
export function gdtCommandos(geo, x, y, s, vulling = 0.78) {
  const k = (s * vulling) / 64;
  const ox = x + s / 2 - 32 * k;
  const oy = y + s / 2 - 32 * k;
  const X = (v) => ox + v * k;
  const Y = (v) => oy + v * k;
  const out = [];
  for (const p of geo) {
    switch (p[0]) {
      case 'L': out.push({ kind: 'line', x1: X(p[1]), y1: Y(p[2]), x2: X(p[3]), y2: Y(p[4]), role: 'kenmerk' }); break;
      case 'C': out.push({ kind: 'circle', cx: X(p[1]), cy: Y(p[2]), r: p[3] * k, role: 'kenmerk' }); break;
      case 'P': out.push({
        kind: 'polyline', points: p[1].map(([px, py]) => ({ x: X(px), y: Y(py) })),
        close: !!p[2], fill: !!p[3], role: 'kenmerk',
      }); break;
      case 'A': out.push({ kind: 'arc', cx: X(p[1]), cy: Y(p[2]), r: p[3] * k, a0: p[4], a1: p[5], role: 'kenmerk' }); break;
      case 'T': out.push({ kind: 'text', x: X(p[1]), y: Y(p[2]), size: p[3] * k, text: p[4], role: 'kenmerk' }); break;
      default: break;
    }
  }
  return out;
}

// ── Kenmerkkader (feature control frame) ───────────────────────────────────
// Cellen in eenheden van de kaderhoogte: kenmerk (1), tolerantie (breedte
// naar inhoud) en 0–3 referenties. De vakbreedte volgt de inhoud
// (breedteBijHoogte), zodat een langere tolerantie het kader verbreedt.

const TEKST = 0.6;          // teksthoogte t.o.v. de kaderhoogte
const TEKEN_BREEDTE = 0.56; // geschatte breedte van een teken (Arial) per teksthoogte
const MARGE = 0.3;

const tekstBreedte = (tekst) => String(tekst).length * TEKST * TEKEN_BREEDTE;

function referenties(params) {
  return [params?.referentie1, params?.referentie2, params?.referentie3]
    .map((r) => String(r ?? '').trim())
    .filter(Boolean);
}

/** Celindeling in eenheden van de kaderhoogte. */
export function kaderIndeling(params = {}) {
  const tol = String(params.tolerantie ?? '').trim();
  const dia = params.diameter === true;
  const mc = params.materiaal === 'M' || params.materiaal === 'L' ? params.materiaal : null;
  const tolBreedte = Math.max(1.5, MARGE + (dia ? 0.55 : 0) + tekstBreedte(tol) + (mc ? 0.7 : 0) + MARGE);
  const cellen = [
    { soort: 'kenmerk', breedte: 1 },
    { soort: 'tolerantie', breedte: tolBreedte, tekst: tol, diameter: dia, materiaal: mc },
    ...referenties(params).map((r) => ({ soort: 'referentie', breedte: Math.max(1, 2 * MARGE + tekstBreedte(r)), tekst: r })),
  ];
  return { cellen, breedte: cellen.reduce((s, c) => s + c.breedte, 0) };
}

export const gdtKenmerkkaderTemplate = {
  id: 'gdt-kenmerkkader',
  name: 'Kenmerkkader (GD&T)',
  nameEn: 'Feature control frame',
  category: 'GD&T',
  defaultSize: { width: 248, height: 40 },
  zoektermen: ['GD&T', 'feature control frame', 'tolerantiekader', 'vorm- en plaatstolerantie'],
  params: [
    {
      key: 'kenmerk', label: 'Kenmerk', labelEn: 'Characteristic', type: 'enum',
      options: GDT_KENMERKEN.map((k) => ({ value: k.id, label: k.name })),
      default: 'positie',
    },
    { key: 'diameter', label: 'Diametertolerantiezone (⌀)', labelEn: 'Diameter zone', type: 'boolean', default: true },
    { key: 'tolerantie', label: 'Tolerantie', labelEn: 'Tolerance', type: 'string', default: '0.1' },
    {
      key: 'materiaal', label: 'Materiaalvoorwaarde', labelEn: 'Material condition', type: 'enum',
      options: [
        { value: 'geen', label: 'Geen' },
        { value: 'M', label: 'Ⓜ maximum materiaal (MMC)' },
        { value: 'L', label: 'Ⓛ minimum materiaal (LMC)' },
      ],
      default: 'geen',
    },
    { key: 'referentie1', label: 'Referentie 1', labelEn: 'Primary datum', type: 'string', default: 'A' },
    { key: 'referentie2', label: 'Referentie 2', labelEn: 'Secondary datum', type: 'string', default: 'B' },
    { key: 'referentie3', label: 'Referentie 3', labelEn: 'Tertiary datum', type: 'string', default: 'C' },
  ],
  breedteBijHoogte(params = {}, hoogte) {
    if (!(hoogte > 0)) return null;
    return kaderIndeling(params).breedte * hoogte;
  },
  snapPoints(_params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    return [
      { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
      { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
      { kind: 'midpoint', x, y: y + h / 2 }, { kind: 'midpoint', x: x + w, y: y + h / 2 },
    ];
  },
  render(params = {}, bbox) {
    const { cellen, breedte } = kaderIndeling(params);
    const s = Math.max(1, Math.min(bbox.height, bbox.width / breedte));
    const x0 = bbox.x + (bbox.width - breedte * s) / 2;
    const y0 = bbox.y + (bbox.height - s) / 2;
    const y1 = y0 + s;
    const cmds = [{
      kind: 'polyline', close: true, role: 'kader',
      points: [{ x: x0, y: y0 }, { x: x0 + breedte * s, y: y0 }, { x: x0 + breedte * s, y: y1 }, { x: x0, y: y1 }],
    }];
    const size = s * TEKST;
    let cx = x0;
    for (let i = 0; i < cellen.length; i++) {
      const cel = cellen[i];
      const w = cel.breedte * s;
      if (i > 0) cmds.push({ kind: 'line', x1: cx, y1: y0, x2: cx, y2: y1, role: 'kader' });
      if (cel.soort === 'kenmerk') {
        const k = KENMERK_BY_ID.get(params.kenmerk) || KENMERK_BY_ID.get('positie');
        cmds.push(...gdtCommandos(k.geo, cx, y0, s));
      } else if (cel.soort === 'tolerantie') {
        // Inhoud gecentreerd: [⌀] tekst [Ⓜ/Ⓛ]; ⌀ en de omcirkelde letter als
        // geometrie, dan hangt de weergave niet van het lettertype af.
        const inhoud = (cel.diameter ? 0.55 : 0) + tekstBreedte(cel.tekst) + (cel.materiaal ? 0.7 : 0);
        let x = cx + (w - inhoud * s) / 2;
        const ym = y0 + s / 2;
        if (cel.diameter) {
          const r = 0.19 * s;
          const m = x + 0.25 * s;
          cmds.push({ kind: 'circle', cx: m, cy: ym, r, role: 'diameter' });
          cmds.push({ kind: 'line', x1: m - 0.25 * s, y1: ym + 0.25 * s, x2: m + 0.25 * s, y2: ym - 0.25 * s, role: 'diameter' });
          x += 0.55 * s;
        }
        if (cel.tekst) {
          const tw = tekstBreedte(cel.tekst) * s;
          cmds.push({ kind: 'text', x: x + tw / 2, y: ym, text: cel.tekst, size, role: 'tolerantie' });
          x += tw;
        }
        if (cel.materiaal) {
          const m = x + 0.4 * s;
          cmds.push({ kind: 'circle', cx: m, cy: ym, r: 0.27 * s, role: 'materiaal' });
          cmds.push({ kind: 'text', x: m, y: ym, text: cel.materiaal, size: 0.36 * s, role: 'materiaal' });
        }
      } else {
        cmds.push({ kind: 'text', x: cx + w / 2, y: y0 + s / 2, text: cel.tekst, size, role: 'referentie' });
      }
      cx += w;
    }
    return cmds;
  },
};
