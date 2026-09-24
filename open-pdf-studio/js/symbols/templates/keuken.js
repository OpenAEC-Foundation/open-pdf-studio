// Parametrische keukeninrichting (#478): een aanrecht als strekkende meter,
// een hoekopstelling (L-vorm) en een kookeiland — met de onderdelen erin.
//
// EÉN annotatie per keukenblok: het blad en alles wat erin zit (spoelbak,
// kookplaat, vaatwasser, koelkast, hoge kast) verplaatst en draait als één
// geheel. De onderdelen staan als lijst in de parameters:
//
//   onderdelen: [{ soort, vanaf, breedte, been? }, ...]
//
//   soort   een sleutel uit ONDERDEEL_SOORTEN
//   vanaf   mm vanaf het begin van het been tot de linkerkant van het
//           onderdeel (kijkend naar de wand)
//   breedte mm langs het blad (standaard de modulemaat van de soort)
//   been    alleen bij de hoekopstelling: 1 = langs de achterwand (vanaf het
//           vrije linkereinde), 2 = langs de rechterwand (vanaf de buitenhoek)
//
// Lokaal stelsel in mm, zoals alle inrichting (mm-tekening.js): de wand aan
// de bovenrand, y naar beneden. Bij de hoekopstelling ligt de buitenhoek
// rechtsboven; gespiegeld linksboven.
//
// Alle bewerkingen op de lijst (normaliseren, toevoegen, wijzigen, wisselen,
// verwijderen) zijn pure functies: ze geven een NIEUWE lijst terug en laten
// de invoer ongemoeid. Het eigenschappenpaneel en de MCP-kant gebruiken
// dezelfde functies.

import {
  maatWaarde, rondAf, rechthoek, ellips, afgerondeRechthoek, spiegel, naarVak,
} from './mm-tekening.js';

const CATEGORIE = 'NL Keuken';

export const ONDERDEEL_SOORTEN = Object.freeze({
  spoelbak: Object.freeze({ breedte: 600, label: 'Spoelbak', labelEn: 'Sink' }),
  'spoelbak-dubbel': Object.freeze({ breedte: 900, label: 'Spoelbak dubbel', labelEn: 'Double sink' }),
  'kookplaat-4': Object.freeze({ breedte: 600, label: 'Kookplaat 4 pits', labelEn: '4-burner hob' }),
  'kookplaat-5': Object.freeze({ breedte: 900, label: 'Kookplaat 5 pits', labelEn: '5-burner hob' }),
  inductie: Object.freeze({ breedte: 800, label: 'Inductiekookplaat', labelEn: 'Induction hob' }),
  vaatwasser: Object.freeze({ breedte: 600, label: 'Vaatwasser', labelEn: 'Dishwasher' }),
  koelkast: Object.freeze({ breedte: 600, label: 'Koelkast', labelEn: 'Fridge' }),
  'hoge-kast': Object.freeze({ breedte: 600, label: 'Hoge kast', labelEn: 'Tall cabinet' }),
});

/** Smalste onderdeel dat nog getekend wordt (een smalle nis of kolom). */
export const MIN_BREEDTE = 150;

const GRENS = {
  lengte: [300, 12000],
  lengteEiland: [600, 6000],
  diepte: [300, 1200],
  diepteEiland: [500, 1600],
};

// ── Maten en benen ───────────────────────────────────────────────────────

/**
 * De maten van een keukenblok, geklemd tot iets tekenbaars.
 * Geeft ook de maat van het symboolvak (breedte x diepte).
 */
export function keukenMaat(params = {}, opstelling = 'recht') {
  if (opstelling === 'eiland') {
    const lengte = maatWaarde(params.lengte, 2400, ...GRENS.lengteEiland);
    const diepte = maatWaarde(params.diepte, 1000, ...GRENS.diepteEiland);
    const ruwOverstek = Number(params.overstek);
    const overstek = Math.min(Math.max(Number.isFinite(ruwOverstek) ? ruwOverstek : 0, 0), diepte - 300);
    return { lengte, diepte, overstek, kastDiepte: diepte - overstek, breedte: lengte, hoogte: diepte };
  }
  const diepte = maatWaarde(params.diepte, 600, ...GRENS.diepte);
  if (opstelling === 'hoek') {
    // Een been moet langer zijn dan de diepte, anders is er geen L.
    const lengte = Math.max(maatWaarde(params.lengte, 3000, ...GRENS.lengte), diepte + MIN_BREEDTE);
    const lengte2 = Math.max(maatWaarde(params.lengte2, 1800, ...GRENS.lengte), diepte + MIN_BREEDTE);
    return { lengte, lengte2, diepte, kastDiepte: diepte, breedte: lengte, hoogte: lengte2 };
  }
  const lengte = maatWaarde(params.lengte, 3000, ...GRENS.lengte);
  return { lengte, diepte, kastDiepte: diepte, breedte: lengte, hoogte: diepte };
}

/**
 * De benen waarin onderdelen kunnen staan, met hun bruikbare bereik (mm,
 * gemeten zoals `vanaf`). Bij de hoek is het hoekvak (diepte x diepte) geen
 * plek voor een onderdeel.
 */
export function benenVan(params = {}, opstelling = 'recht') {
  const m = keukenMaat(params, opstelling);
  if (opstelling === 'hoek') {
    return [
      { nr: 1, min: 0, max: m.lengte - m.diepte },
      { nr: 2, min: m.diepte, max: m.lengte2 },
    ];
  }
  return [{ nr: 1, min: 0, max: m.lengte }];
}

/** Van vak-coördinaten (u langs het blad, v vanaf de wand) naar het lokale stelsel. */
function vakNaarLokaal(item, m, opstelling) {
  if (opstelling === 'hoek' && item.been === 2) {
    // Langs de rechterwand, naar beneden; de wand is x = lengte.
    return (u, v) => ({ x: m.lengte - v, y: item.vanaf + u });
  }
  const vAf = opstelling === 'eiland' ? m.overstek : 0;
  return (u, v) => ({ x: item.vanaf + u, y: vAf + v });
}

// ── De lijst met onderdelen ──────────────────────────────────────────────

function rond(v) {
  return Math.round(v);
}

function sorteer(lijst) {
  return lijst.sort((a, b) => (a.been || 1) - (b.been || 1) || a.vanaf - b.vanaf);
}

/**
 * Maak van ruwe invoer (paneel, MCP, oud bestand) een nette lijst:
 * onbekende soorten vallen weg, de breedte komt uit de soort als hij
 * ontbreekt, de positie blijft binnen het been, en de lijst staat op
 * volgorde (per been, van begin naar eind).
 */
export function normaliseerOnderdelen(lijst, params = {}, opstelling = 'recht') {
  if (!Array.isArray(lijst)) return [];
  const benen = benenVan(params, opstelling);
  const uit = [];
  for (const ruw of lijst) {
    if (!ruw || typeof ruw !== 'object') continue;
    const soort = typeof ruw.soort === 'string' && ONDERDEEL_SOORTEN[ruw.soort] ? ruw.soort : null;
    if (!soort) continue;
    const beenNr = opstelling === 'hoek' && Number(ruw.been) === 2 ? 2 : 1;
    const been = benen.find((b) => b.nr === beenNr);
    const ruimte = been.max - been.min;
    if (!(ruimte > 0)) continue;
    const breedte = Math.min(
      Math.max(maatWaarde(ruw.breedte, ONDERDEEL_SOORTEN[soort].breedte), MIN_BREEDTE),
      ruimte,
    );
    const ruwVanaf = Number(ruw.vanaf);
    const vanaf = Math.min(
      Math.max(Number.isFinite(ruwVanaf) ? ruwVanaf : been.min, been.min),
      been.max - breedte,
    );
    const item = { soort, vanaf: rond(vanaf), breedte: rond(breedte) };
    if (opstelling === 'hoek') item.been = beenNr;
    uit.push(item);
  }
  return sorteer(uit);
}

/**
 * Een onderdeel toevoegen in de eerste vrije plek die breed genoeg is
 * (been 1 eerst). Is er nergens plek, dan komt het achteraan been 1 — de
 * knop mag nooit stil niets doen; schuiven kan daarna.
 */
export function voegOnderdeelToe(lijst, soort, params = {}, opstelling = 'recht') {
  if (!ONDERDEEL_SOORTEN[soort]) return normaliseerOnderdelen(lijst, params, opstelling);
  const huidig = normaliseerOnderdelen(lijst, params, opstelling);
  const breedte = ONDERDEEL_SOORTEN[soort].breedte;
  for (const been of benenVan(params, opstelling)) {
    const bezet = huidig.filter((o) => (o.been || 1) === been.nr);
    let cursor = been.min;
    let plek = null;
    for (const o of bezet) {
      if (o.vanaf - cursor >= breedte) { plek = cursor; break; }
      cursor = Math.max(cursor, o.vanaf + o.breedte);
    }
    if (plek === null && been.max - cursor >= breedte) plek = cursor;
    if (plek !== null) {
      const nieuw = { soort, vanaf: plek, breedte };
      if (opstelling === 'hoek') nieuw.been = been.nr;
      return normaliseerOnderdelen([...huidig, nieuw], params, opstelling);
    }
  }
  const eerste = benenVan(params, opstelling)[0];
  const nieuw = { soort, vanaf: eerste.max - breedte, breedte };
  if (opstelling === 'hoek') nieuw.been = 1;
  return normaliseerOnderdelen([...huidig, nieuw], params, opstelling);
}

/**
 * Eén onderdeel wijzigen (soort, positie, breedte, been). Een andere soort
 * zonder eigen breedte krijgt de modulemaat van die soort: een 5-pits
 * kookplaat is 900 breed, niet de 600 van de 4-pits die hij vervangt.
 */
export function wijzigOnderdeel(lijst, index, patch = {}, params = {}, opstelling = 'recht') {
  const huidig = normaliseerOnderdelen(lijst, params, opstelling);
  if (!Number.isInteger(index) || index < 0 || index >= huidig.length) return huidig;
  const oud = huidig[index];
  const nieuw = { ...oud, ...patch };
  if (patch.soort && patch.soort !== oud.soort && patch.breedte === undefined
      && ONDERDEEL_SOORTEN[patch.soort]) {
    nieuw.breedte = ONDERDEEL_SOORTEN[patch.soort].breedte;
  }
  return normaliseerOnderdelen(huidig.map((o, i) => (i === index ? nieuw : o)), params, opstelling);
}

export function verwijderOnderdeel(lijst, index, params = {}, opstelling = 'recht') {
  const huidig = normaliseerOnderdelen(lijst, params, opstelling);
  return huidig.filter((_, i) => i !== index);
}

/**
 * Een onderdeel wisselen met zijn buurman verderop in hetzelfde been: de
 * tweede schuift naar de plek van de eerste, de eerste eindigt waar de
 * tweede eindigde. De ruimte ertussen blijft even groot.
 */
export function wisselOnderdelen(lijst, index, params = {}, opstelling = 'recht') {
  const huidig = normaliseerOnderdelen(lijst, params, opstelling);
  const a = huidig[index];
  const b = huidig[index + 1];
  if (!a || !b || (a.been || 1) !== (b.been || 1)) return huidig;
  const nieuwB = { ...b, vanaf: a.vanaf };
  const nieuwA = { ...a, vanaf: b.vanaf + b.breedte - a.breedte };
  const uit = huidig.slice();
  uit[index] = nieuwA;
  uit[index + 1] = nieuwB;
  return normaliseerOnderdelen(uit, params, opstelling);
}

// ── Tekenwijze per onderdeel ─────────────────────────────────────────────

// Een gaspit: dubbele ring (brander + kroon).
function gaspit(cx, cy, r) {
  return [
    { kind: 'circle', cx, cy, r, rol: 'pit' },
    { kind: 'circle', cx, cy, r: r * 0.45, rol: 'pit' },
  ];
}

/**
 * De vormen van één onderdeel in zijn eigen vak: u langs het blad (0..w),
 * v vanaf de wand (0..d). Toestellen hebben hun eigen werkelijke diepte en
 * liggen aan de voorkant van het blad; kasten vullen het vak.
 */
export function onderdeelVormen(soort, w, d) {
  switch (soort) {
    case 'spoelbak':
    case 'spoelbak-dubbel': {
      const m = Math.min(40, w * 0.07);
      const rand = Math.min(500, d - 80);
      const v1 = d - 50;
      const v0 = v1 - rand;
      const vormen = [{ kind: 'polyline', close: true, rol: 'rand', points: rechthoek(m, v0, w - m, v1) }];
      const bx0 = m + 30, bx1 = w - m - 30;
      const bv0 = v0 + 90, bv1 = v1 - 30;
      const bakken = soort === 'spoelbak-dubbel'
        ? [[bx0, (bx0 + bx1) / 2 - 20], [(bx0 + bx1) / 2 + 20, bx1]]
        : [[bx0, bx1]];
      for (const [x0, x1] of bakken) {
        if (x1 - x0 <= 0 || bv1 - bv0 <= 0) continue;
        vormen.push({ kind: 'polyline', close: true, rol: 'bak', points: afgerondeRechthoek(x0, bv0, x1, bv1, 40) });
        vormen.push({ kind: 'circle', rol: 'afvoer', cx: (x0 + x1) / 2, cy: (bv0 + bv1) / 2, r: Math.min(20, (x1 - x0) / 6) });
      }
      vormen.push({ kind: 'circle', rol: 'kraan', cx: w / 2, cy: v0 + 45, r: Math.min(22, (w - 2 * m) / 8) });
      return vormen;
    }
    case 'kookplaat-4':
    case 'kookplaat-5':
    case 'inductie': {
      const pw = Math.max(w - 20, 1);
      const ph = Math.min(510, d - 60);
      const px0 = (w - pw) / 2;
      const pv1 = d - 50;
      const pv0 = pv1 - ph;
      const vormen = [{ kind: 'polyline', close: true, rol: 'plaat', points: rechthoek(px0, pv0, px0 + pw, pv1) }];
      const k = Math.min(pw, ph);
      const P = (fx, fy) => [px0 + pw * fx, pv0 + ph * fy];
      if (soort === 'inductie') {
        for (const [fx, fy] of [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]]) {
          const [cx, cy] = P(fx, fy);
          vormen.push({ kind: 'circle', cx, cy, r: k * 0.2, rol: 'zone' });
        }
      } else if (soort === 'kookplaat-5') {
        for (const [fx, fy] of [[0.18, 0.27], [0.82, 0.27], [0.18, 0.73], [0.82, 0.73]]) {
          vormen.push(...gaspit(...P(fx, fy), k * 0.13));
        }
        vormen.push(...gaspit(...P(0.5, 0.5), k * 0.2));
      } else {
        vormen.push(...gaspit(...P(0.27, 0.27), k * 0.14));
        vormen.push(...gaspit(...P(0.73, 0.27), k * 0.19));
        vormen.push(...gaspit(...P(0.27, 0.73), k * 0.19));
        vormen.push(...gaspit(...P(0.73, 0.73), k * 0.14));
      }
      return vormen;
    }
    case 'vaatwasser': {
      // Onder het werkblad, dus onder de snede: gestippeld, met "VW".
      const v1 = d - 20;
      const v0 = Math.max(0, v1 - 560);
      return [
        { kind: 'polyline', close: true, stippel: true, rol: 'toestel', points: rechthoek(15, v0, w - 15, v1) },
        { kind: 'text', x: w / 2, y: (v0 + v1) / 2, text: 'VW', size: Math.min(120, w * 0.35, d * 0.25) },
      ];
    }
    case 'koelkast':
      return [
        { kind: 'polyline', close: true, rol: 'kast', points: rechthoek(0, 0, w, d) },
        { kind: 'text', x: w / 2, y: d / 2, text: 'K', size: Math.min(150, w * 0.35, d * 0.3) },
      ];
    case 'hoge-kast':
      // Kolomkast: rechthoek met kruis.
      return [
        { kind: 'polyline', close: true, rol: 'kast', points: rechthoek(0, 0, w, d) },
        { kind: 'line', x1: 0, y1: 0, x2: w, y2: d, rol: 'kruis' },
        { kind: 'line', x1: w, y1: 0, x2: 0, y2: d, rol: 'kruis' },
      ];
    default:
      return [];
  }
}

function zetOm(vorm, naar) {
  switch (vorm.kind) {
    case 'polyline': return { ...vorm, points: vorm.points.map((p) => naar(p.x, p.y)) };
    case 'line': {
      const a = naar(vorm.x1, vorm.y1);
      const b = naar(vorm.x2, vorm.y2);
      return { ...vorm, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case 'circle': {
      const c = naar(vorm.cx, vorm.cy);
      return { ...vorm, cx: c.x, cy: c.y };
    }
    case 'text': {
      const c = naar(vorm.x, vorm.y);
      return { ...vorm, x: c.x, y: c.y };
    }
    default: return vorm;
  }
}

// ── Het hele keukenblok ──────────────────────────────────────────────────

/**
 * Contour plus onderdelen van een keukenblok, in mm. Elke onderdeelvorm
 * draagt `onderdeel: i` (plaats in de genormaliseerde lijst).
 */
export function keukenGeometrie(params = {}, opstelling = 'recht') {
  const m = keukenMaat(params, opstelling);
  const vormen = [];
  if (opstelling === 'hoek') {
    vormen.push({
      kind: 'polyline', close: true, rol: 'blad',
      points: [
        { x: 0, y: 0 }, { x: m.lengte, y: 0 }, { x: m.lengte, y: m.lengte2 },
        { x: m.lengte - m.diepte, y: m.lengte2 }, { x: m.lengte - m.diepte, y: m.diepte },
        { x: 0, y: m.diepte },
      ],
    });
  } else {
    vormen.push({ kind: 'polyline', close: true, rol: 'blad', points: rechthoek(0, 0, m.lengte, m.diepte) });
    if (opstelling === 'eiland' && m.overstek > 0) {
      // Achterkant van de kasten onder een zitgedeelte: gestippeld.
      vormen.push({ kind: 'line', stippel: true, rol: 'kastlijn', x1: 0, y1: m.overstek, x2: m.lengte, y2: m.overstek });
    }
  }
  const lijst = normaliseerOnderdelen(params.onderdelen, params, opstelling);
  lijst.forEach((item, i) => {
    const naar = vakNaarLokaal(item, m, opstelling);
    for (const v of onderdeelVormen(item.soort, item.breedte, m.kastDiepte)) {
      vormen.push({ ...zetOm(v, naar), onderdeel: i });
    }
  });
  return {
    maat: { breedte: m.breedte, diepte: m.hoogte },
    vormen: spiegel(vormen, m.breedte, params.spiegelen === true),
  };
}

// ── Templates ────────────────────────────────────────────────────────────

const SOORT_OPTIES = Object.freeze(Object.entries(ONDERDEEL_SOORTEN)
  .map(([value, s]) => Object.freeze({ value, label: s.label, labelEn: s.labelEn })));

function onderdelenParam(opstelling, standaard) {
  const items = [
    { key: 'soort', label: 'Soort', labelEn: 'Type', type: 'enum', options: SOORT_OPTIES },
    { key: 'vanaf', label: 'Vanaf', labelEn: 'From', type: 'number', unit: 'mm', min: 0, step: 10 },
    { key: 'breedte', label: 'Breedte', labelEn: 'Width', type: 'number', unit: 'mm', min: MIN_BREEDTE, step: 10 },
  ];
  if (opstelling === 'hoek') {
    items.push({ key: 'been', label: 'Been', labelEn: 'Leg', type: 'enum', options: [
      { value: 1, label: '1 (achterwand)' },
      { value: 2, label: '2 (zijwand)' },
    ] });
  }
  return {
    key: 'onderdelen', label: 'Onderdelen', labelEn: 'Components', type: 'list',
    default: standaard,
    items,
    normalize: (lijst, params) => normaliseerOnderdelen(lijst, params, opstelling),
    add: (lijst, params, soort) => voegOnderdeelToe(lijst, soort, params, opstelling),
    update: (lijst, i, patch, params) => wijzigOnderdeel(lijst, i, patch, params, opstelling),
    remove: (lijst, i, params) => verwijderOnderdeel(lijst, i, params, opstelling),
    swap: (lijst, i, params) => wisselOnderdelen(lijst, i, params, opstelling),
  };
}

const SPIEGELEN = { key: 'spiegelen', label: 'Spiegelen', labelEn: 'Mirror', type: 'boolean', default: false };

function maakTemplate({ id, name, nameEn, opstelling, params, paramsUitMaat, anker }) {
  return {
    id,
    name,
    nameEn,
    category: CATEGORIE,
    opstelling,
    defaultSize: { width: 200, height: 60 },
    params,
    realSizeMm(p) {
      const m = keukenMaat(p || {}, opstelling);
      return { width: m.breedte, height: m.hoogte };
    },
    paramsUitMaat,
    maatAnker: anker,
    render(p = {}, bbox) {
      const { maat, vormen } = keukenGeometrie(p, opstelling);
      return naarVak(vormen, maat, bbox);
    },
  };
}

export const aanrechtTemplate = maakTemplate({
  id: 'aanrecht',
  name: 'Aanrecht',
  nameEn: 'Kitchen worktop',
  opstelling: 'recht',
  params: [
    { key: 'lengte', label: 'Lengte', labelEn: 'Length', type: 'number', unit: 'mm', default: 3000, min: GRENS.lengte[0], max: GRENS.lengte[1], step: 10 },
    { key: 'diepte', label: 'Diepte', labelEn: 'Depth', type: 'number', unit: 'mm', default: 600, min: GRENS.diepte[0], max: GRENS.diepte[1], step: 10 },
    SPIEGELEN,
    onderdelenParam('recht', [
      { soort: 'koelkast', vanaf: 0, breedte: 600 },
      { soort: 'spoelbak', vanaf: 800, breedte: 600 },
      { soort: 'vaatwasser', vanaf: 1400, breedte: 600 },
      { soort: 'kookplaat-4', vanaf: 2200, breedte: 600 },
    ]),
  ],
  paramsUitMaat: (p, { breedteMm, hoogteMm }) => ({ ...(p || {}), lengte: rondAf(breedteMm), diepte: rondAf(hoogteMm) }),
  // Langer maken gaat vanaf het begin van het blad (meestal een wandhoek).
  anker: (p) => (p?.spiegelen === true ? 'back-right' : 'back-left'),
});

export const aanrechtHoekTemplate = maakTemplate({
  id: 'aanrecht-hoek',
  name: 'Aanrecht hoekopstelling',
  nameEn: 'L-shaped kitchen worktop',
  opstelling: 'hoek',
  params: [
    { key: 'lengte', label: 'Lengte been 1', labelEn: 'Length leg 1', type: 'number', unit: 'mm', default: 3000, min: GRENS.lengte[0], max: GRENS.lengte[1], step: 10 },
    { key: 'lengte2', label: 'Lengte been 2', labelEn: 'Length leg 2', type: 'number', unit: 'mm', default: 1800, min: GRENS.lengte[0], max: GRENS.lengte[1], step: 10 },
    { key: 'diepte', label: 'Diepte', labelEn: 'Depth', type: 'number', unit: 'mm', default: 600, min: GRENS.diepte[0], max: GRENS.diepte[1], step: 10 },
    SPIEGELEN,
    onderdelenParam('hoek', [
      { soort: 'koelkast', vanaf: 0, breedte: 600, been: 1 },
      { soort: 'spoelbak', vanaf: 800, breedte: 600, been: 1 },
      { soort: 'vaatwasser', vanaf: 1400, breedte: 600, been: 1 },
      { soort: 'kookplaat-4', vanaf: 900, breedte: 600, been: 2 },
    ]),
  ],
  paramsUitMaat: (p, { breedteMm, hoogteMm }) => ({ ...(p || {}), lengte: rondAf(breedteMm), lengte2: rondAf(hoogteMm) }),
  // De buitenhoek blijft staan: rechtsboven, gespiegeld linksboven.
  anker: (p) => (p?.spiegelen === true ? 'back-left' : 'back-right'),
});

export const kookeilandTemplate = maakTemplate({
  id: 'kookeiland',
  name: 'Kookeiland',
  nameEn: 'Kitchen island',
  opstelling: 'eiland',
  params: [
    { key: 'lengte', label: 'Lengte', labelEn: 'Length', type: 'number', unit: 'mm', default: 2400, min: GRENS.lengteEiland[0], max: GRENS.lengteEiland[1], step: 10 },
    { key: 'diepte', label: 'Diepte', labelEn: 'Depth', type: 'number', unit: 'mm', default: 1000, min: GRENS.diepteEiland[0], max: GRENS.diepteEiland[1], step: 10 },
    { key: 'overstek', label: 'Overstek zitgedeelte', labelEn: 'Seating overhang', type: 'number', unit: 'mm', default: 0, min: 0, max: 600, step: 10 },
    SPIEGELEN,
    onderdelenParam('eiland', [
      { soort: 'inductie', vanaf: 800, breedte: 800 },
    ]),
  ],
  paramsUitMaat: (p, { breedteMm, hoogteMm }) => ({ ...(p || {}), lengte: rondAf(breedteMm), diepte: rondAf(hoogteMm) }),
  anker: () => 'center',
});

export const KEUKEN_TEMPLATES = Object.freeze([aanrechtTemplate, aanrechtHoekTemplate, kookeilandTemplate]);
