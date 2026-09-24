// Kozijnprofielen in plattegrond: de doorsnede van kozijnhout, tussenstijl,
// deurblad, glas en raamhout, als pure geometrie in werkelijke millimeters.
//
// Deze module tekent niets en kent geen annotaties. Ze levert vormen die een
// symbool (door/window in js/symbols/templates/) of een kader-object
// (stijlen + panelen) zelf op het blad zet. Daardoor is er één plek waar
// staat hoe een kozijn er in doorsnede uitziet.
//
// Assen (een horizontale doorsnede, zoals een plattegrond hem snijdt):
//   u  langs de kaderlijn / de wand
//   v  dwars erop, de diepte; v = 0 is het BUITENvlak, v groeit naar binnen.
//
// Een STIJL heeft een contour die gecentreerd is op zijn eigen hartlijn
// (u van -b/2 tot +b/2) en loopt van v = 0 (buitenvlak van de stijl) tot
// v = diepte. Verschuiven is dus alleen het hart wijzigen.
//
// Een PANEEL (glas, deur, raam, dicht) krijgt de dagkanten van de stijlen
// ernaast mee: `vanU` en `totU` zijn de vlakken van de stijlen aan de dag,
// in mm vanaf het begin van het element; `diepteMm` is de diepte van het
// element. Staat de stijl niet over de volle diepte, geef dan `vVan`/`vTot`
// (de v van zijn buiten- en binnenvlak) mee.
//
// Vormen (het uitwisselformaat):
//   { soort: 'vlak', rol, punten: [{u, v}, ...] }             gesloten veelhoek
//   { soort: 'lijn', rol, van: {u, v}, tot: {u, v}, streep? }
//   { soort: 'boog', rol, midden: {u, v}, straal, vanRad, totRad, tegenKlok, streep? }
// Hoeken zijn in het (u, v)-vlak gemeten van +u naar +v; `tegenKlok` volgt
// de betekenis van de `ccw`-vlag van een canvas-boog in dat vlak.
// `rol` bepaalt de lijndikte bij het tekenen: 'stijl', 'raamhout',
// 'glaslat', 'paneel', 'deurblad' (doorsnede), 'glas', 'draaicirkel',
// 'aanzicht' (dun).

/** Standaardmaten (mm) van een Nederlands houten kozijn. */
export const KOZIJN_STANDAARD = Object.freeze({
  stijlBreedteMm: 67,      // zichtmaat van de stijl, langs de wand
  stijlDiepteMm: 114,      // diepte van de stijl, dwars op de wand
  sponningDiepteMm: 17,    // hoe ver de sponning in de stijl snijdt (langs u)
  glasDikteMm: 24,         // HR++ 4-16-4
  glaslatMm: 20,           // glaslat, dwars (langs v)
  insteekSpelingMm: 3,     // speling tussen glasrand en sponningbodem
  deurbladDikteMm: 40,
  deurSpelingMm: 2,        // kier tussen deurblad en sponning
  raamhoutBreedteMm: 54,   // raamhout van een draaiend raam, langs u
  raamhoutDiepteMm: 67,    // idem, dwars
  paneelDikteMm: 24,       // dicht paneel in een glassponning
});

/**
 * Onder deze papiermaat (pt) van de sponning tekenen we vereenvoudigd:
 * geen sponning, glas als één lijn, deurblad als lijn. Bij 1:50 is een
 * sponning van 17 mm 0,96 pt, bij 1:100 0,48 pt.
 */
export const DETAIL_GRENS_PT = 0.75;

/** 'vol' of 'eenvoudig' bij een schaal in paginapunten per mm. */
export function kozijnDetail(ptPerMm, sponningDiepteMm = KOZIJN_STANDAARD.sponningDiepteMm) {
  const k = Number(ptPerMm);
  return k > 0 && sponningDiepteMm * k >= DETAIL_GRENS_PT ? 'vol' : 'eenvoudig';
}

function maat(v, standaard) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : standaard;
}

function opties(o = {}) {
  const S = KOZIJN_STANDAARD;
  return {
    sponningDiepteMm: maat(o.sponningDiepteMm, S.sponningDiepteMm),
    glasDikteMm: maat(o.glasDikteMm, S.glasDikteMm),
    glaslatMm: maat(o.glaslatMm, S.glaslatMm),
    insteekSpelingMm: Number.isFinite(Number(o.insteekSpelingMm)) ? Number(o.insteekSpelingMm) : S.insteekSpelingMm,
    deurbladDikteMm: maat(o.deurbladDikteMm, S.deurbladDikteMm),
    deurSpelingMm: Number.isFinite(Number(o.deurSpelingMm)) ? Number(o.deurSpelingMm) : S.deurSpelingMm,
    raamhoutBreedteMm: maat(o.raamhoutBreedteMm, S.raamhoutBreedteMm),
    raamhoutDiepteMm: maat(o.raamhoutDiepteMm, S.raamhoutDiepteMm),
    paneelDikteMm: maat(o.paneelDikteMm, S.paneelDikteMm),
  };
}

/**
 * Breedte (langs v) van de sponning voor wat erin komt:
 * glas = glas + glaslat, deur = blad + kier, raam = raamhout + kier,
 * paneel = paneel + glaslat, open = geen sponning.
 */
export function sponningBreedte(vulling, o = {}) {
  const p = opties(o);
  switch (vulling) {
    case 'glas': return p.glasDikteMm + p.glaslatMm;
    case 'deur': return p.deurbladDikteMm + p.deurSpelingMm;
    case 'raam': return p.raamhoutDiepteMm + p.deurSpelingMm;
    case 'paneel': return p.paneelDikteMm + p.glaslatMm;
    default: return 0;
  }
}

/**
 * Contour van een stijl, gecentreerd op zijn hartlijn.
 * @param {{ breedteMm, diepteMm, sponningen?: Array<{ kant: 'min'|'plus',
 *   diepteMm, breedteMm, zijde: 'binnen'|'buiten' }> }} o
 *   `kant` is de dagkant waar de sponning in zit (min = -u, plus = +u);
 *   `diepteMm` hoe ver hij in de stijl snijdt (langs u), `breedteMm` hoe
 *   breed hij is (langs v), `zijde` aan welk vlak.
 * @returns {Array<{u, v}>} gesloten veelhoek (eerste punt niet herhaald)
 */
export function stijlContour(o = {}) {
  const b = maat(o.breedteMm, KOZIJN_STANDAARD.stijlBreedteMm);
  const d = maat(o.diepteMm, KOZIJN_STANDAARD.stijlDiepteMm);
  const h = b / 2;
  const uit = (kant, zijde) => {
    const s = (o.sponningen || []).find((x) => x && x.kant === kant && (x.zijde === 'buiten' ? 'buiten' : 'binnen') === zijde);
    if (!s) return null;
    // Nooit de hele stijl wegsnijden: er blijft minstens een derde staan.
    const sd = Math.min(Math.max(0, Number(s.diepteMm) || 0), (b * 2) / 3);
    const sw = Math.min(Math.max(0, Number(s.breedteMm) || 0), (d * 2) / 3);
    return sd > 0 && sw > 0 ? { sd, sw } : null;
  };
  const punten = [];
  // Rondgang: buitenvlak (v=0) van -u naar +u, plus-kant omlaag, binnenvlak
  // (v=d) terug, min-kant omhoog. Een sponning vervangt een hoekpunt door
  // drie punten.
  const om = uit('min', 'buiten');
  if (om) punten.push({ u: -h + om.sd, v: 0 }); else punten.push({ u: -h, v: 0 });
  const op = uit('plus', 'buiten');
  if (op) punten.push({ u: h - op.sd, v: 0 }, { u: h - op.sd, v: op.sw }, { u: h, v: op.sw });
  else punten.push({ u: h, v: 0 });
  const ip = uit('plus', 'binnen');
  if (ip) punten.push({ u: h, v: d - ip.sw }, { u: h - ip.sd, v: d - ip.sw }, { u: h - ip.sd, v: d });
  else punten.push({ u: h, v: d });
  const im = uit('min', 'binnen');
  if (im) punten.push({ u: -h + im.sd, v: d }, { u: -h + im.sd, v: d - im.sw }, { u: -h, v: d - im.sw });
  else punten.push({ u: -h, v: d });
  if (om) punten.push({ u: -h, v: om.sw }, { u: -h + om.sd, v: om.sw });
  return punten;
}

/**
 * Kozijnstijl (buitenstijl van een kozijn): één sponning aan de dagkant.
 * @param {{ breedteMm?, diepteMm?, dagkant?: 'min'|'plus', zijde?: 'binnen'|'buiten',
 *   vulling?: 'glas'|'deur'|'raam'|'paneel'|'open', sponningDiepteMm?, sponningBreedteMm? }} o
 */
export function kozijnstijl(o = {}) {
  const breedteMm = maat(o.breedteMm, KOZIJN_STANDAARD.stijlBreedteMm);
  const diepteMm = maat(o.diepteMm, KOZIJN_STANDAARD.stijlDiepteMm);
  const p = opties(o);
  const sw = Number(o.sponningBreedteMm) > 0 ? Number(o.sponningBreedteMm) : sponningBreedte(o.vulling || 'glas', o);
  const sponningen = sw > 0 ? [{
    kant: o.dagkant === 'min' ? 'min' : 'plus',
    diepteMm: p.sponningDiepteMm, breedteMm: sw,
    zijde: o.zijde === 'buiten' ? 'buiten' : 'binnen',
  }] : [];
  return { breedteMm, diepteMm, contour: stijlContour({ breedteMm, diepteMm, sponningen }) };
}

/**
 * Tussenstijl: een sponning aan beide kanten (links en rechts een vak).
 * `vullingMin`/`vullingPlus` kiezen per kant; zonder die geldt `vulling`.
 */
export function tussenstijl(o = {}) {
  const breedteMm = maat(o.breedteMm, KOZIJN_STANDAARD.stijlBreedteMm);
  const diepteMm = maat(o.diepteMm, KOZIJN_STANDAARD.stijlDiepteMm);
  const p = opties(o);
  const zijde = o.zijde === 'buiten' ? 'buiten' : 'binnen';
  const sponningen = [];
  for (const kant of ['min', 'plus']) {
    const vulling = (kant === 'min' ? o.vullingMin : o.vullingPlus) || o.vulling || 'glas';
    const sw = sponningBreedte(vulling, o);
    if (sw > 0) sponningen.push({ kant, diepteMm: p.sponningDiepteMm, breedteMm: sw, zijde });
  }
  return { breedteMm, diepteMm, contour: stijlContour({ breedteMm, diepteMm, sponningen }) };
}

function vlakken(o) {
  const D = maat(o.diepteMm, KOZIJN_STANDAARD.stijlDiepteMm);
  const vVan = Number.isFinite(Number(o.vVan)) ? Number(o.vVan) : 0;
  const vTot = Number.isFinite(Number(o.vTot)) ? Number(o.vTot) : D;
  return { vVan, vTot };
}

function rechthoek(rol, u0, u1, v0, v1) {
  return {
    soort: 'vlak', rol,
    punten: [{ u: u0, v: v0 }, { u: u1, v: v0 }, { u: u1, v: v1 }, { u: u0, v: v1 }],
  };
}

/**
 * Glas in een vak tussen twee stijlen.
 * 'vol': dubbel glas als twee lijnen (de vlakken van het isolatieglas) die
 * in de sponning steken, plus de glaslatten. 'eenvoudig': één lijn op het
 * hart van het glas, van stijl tot stijl.
 * @param {{ vanU, totU, diepteMm, zijde?: 'binnen'|'buiten', vVan?, vTot?, detail? }} o
 */
export function glasVormen(o) {
  const p = opties(o);
  const { vVan, vTot } = vlakken(o);
  const vanU = Number(o.vanU), totU = Number(o.totU);
  const sw = p.glasDikteMm + p.glaslatMm;
  const binnen = o.zijde !== 'buiten';
  // Glas ligt tegen de aanslag (het volle deel van de stijl); de glaslat
  // zit aan de kant van de sponning.
  const g0 = binnen ? vTot - sw : vVan + p.glaslatMm;
  const g1 = g0 + p.glasDikteMm;
  if (o.detail === 'eenvoudig') {
    const m = (g0 + g1) / 2;
    return [{ soort: 'lijn', rol: 'glas', van: { u: vanU, v: m }, tot: { u: totU, v: m } }];
  }
  const u0 = vanU - p.sponningDiepteMm + p.insteekSpelingMm;
  const u1 = totU + p.sponningDiepteMm - p.insteekSpelingMm;
  const l0 = binnen ? vTot - p.glaslatMm : vVan;
  const l1 = l0 + p.glaslatMm;
  return [
    { soort: 'lijn', rol: 'glas', van: { u: u0, v: g0 }, tot: { u: u1, v: g0 } },
    { soort: 'lijn', rol: 'glas', van: { u: u0, v: g1 }, tot: { u: u1, v: g1 } },
    rechthoek('glaslat', vanU - p.sponningDiepteMm, vanU, l0, l1),
    rechthoek('glaslat', totU, totU + p.sponningDiepteMm, l0, l1),
  ];
}

/** Dicht paneel in de glassponning (borstweringspaneel, dichte deur). */
export function dichtPaneelVormen(o) {
  const p = opties(o);
  const { vVan, vTot } = vlakken(o);
  const vanU = Number(o.vanU), totU = Number(o.totU);
  const binnen = o.zijde !== 'buiten';
  const d = p.paneelDikteMm;
  const v0 = binnen ? vTot - p.glaslatMm - d : vVan + p.glaslatMm;
  if (o.detail === 'eenvoudig') return [rechthoek('paneel', vanU, totU, v0, v0 + d)];
  return [rechthoek('paneel',
    vanU - p.sponningDiepteMm + p.insteekSpelingMm, totU + p.sponningDiepteMm - p.insteekSpelingMm,
    v0, v0 + d)];
}

/**
 * Breedte van het deurblad in een vak: de dag plus twee keer de sponning,
 * min de kier aan beide kanten. Kozijn 930 met stijlen van 67 geeft een
 * blad van 826 (de maat van een 830-blad min de kieren).
 */
export function deurbladBreedte(o) {
  const p = opties(o);
  return (Number(o.totU) - Number(o.vanU)) + 2 * (p.sponningDiepteMm - p.deurSpelingMm);
}

/** Scharnier aan de +u-kant? Accepteert 'plus' en (kader-object) 'eind'. */
function scharnierPlus(s) {
  return s === 'plus' || s === 'eind';
}

function draai(p, phi) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return { u: p.u * c - p.v * s, v: p.u * s + p.v * c };
}

/**
 * Deurblad met draaicirkel. Het scharnier zit in de sponning, op het vlak
 * aan de kant waar de deur heen draait: een naar binnen draaiende deur ligt
 * dicht gelijk met het binnenvlak van het kozijn en draait de ruimte in.
 * @param {{ vanU, totU, diepteMm, scharnier?: 'min'|'plus', draaiNaar?: 'binnen'|'buiten',
 *   hoekGraden?, deurbladDikteMm?, vVan?, vTot?, detail? }} o
 */
export function deurVormen(o) {
  const p = opties(o);
  const { vVan, vTot } = vlakken(o);
  const vanU = Number(o.vanU), totU = Number(o.totU);
  const a = scharnierPlus(o.scharnier) ? -1 : 1;     // richting van het dichte blad
  const s = o.draaiNaar === 'buiten' ? -1 : 1;         // +1 = naar grote v
  const theta = (Math.max(1, Math.min(180, Number(o.hoekGraden) || 90)) * Math.PI) / 180;
  const phi = theta * a * s;
  const L = deurbladBreedte(o);
  const t = p.deurbladDikteMm;
  const scharnier = {
    u: a > 0 ? vanU - p.sponningDiepteMm + p.deurSpelingMm : totU + p.sponningDiepteMm - p.deurSpelingMm,
    v: s > 0 ? vTot : vVan,
  };
  const plaats = (q) => {
    const r = draai(q, phi);
    return { u: scharnier.u + r.u, v: scharnier.v + r.v };
  };
  const vormen = [];
  if (o.detail === 'eenvoudig') {
    vormen.push({
      soort: 'lijn', rol: 'deurblad',
      van: plaats({ u: 0, v: (-s * t) / 2 }), tot: plaats({ u: a * L, v: (-s * t) / 2 }),
    });
  } else {
    vormen.push({
      soort: 'vlak', rol: 'deurblad',
      punten: [{ u: 0, v: 0 }, { u: a * L, v: 0 }, { u: a * L, v: -s * t }, { u: 0, v: -s * t }].map(plaats),
    });
  }
  const vanRad = a > 0 ? 0 : Math.PI;
  vormen.push({
    soort: 'boog', rol: 'draaicirkel',
    midden: scharnier, straal: L, vanRad, totRad: vanRad + phi, tegenKlok: phi < 0,
  });
  return vormen;
}

const DRAAIENDE_RAMEN = new Set(['turn', 'pivot', 'tilt', 'draai', 'tuimel', 'klep', 'kiep']);

/**
 * Raam in een vak: 'fixed' = glas direct in het kozijn; een draaiend raam
 * ('turn', 'pivot', 'tilt') heeft raamhout in de sponning met het glas
 * daarin. De draaicirkel van een draairaam ('turn') komt er alleen bij met
 * `toonDraairichting`: op een plattegrond leest een kwartcirkel als een deur,
 * en de draairichting van een raam hoort in het aanzicht. Klep- en
 * tuimelramen draaien niet de ruimte in en krijgen hem nooit.
 * @param {{ vanU, totU, diepteMm, type?, zijde?, scharnier?, vVan?, vTot?, detail?, toonDraairichting? }} o
 */
export function raamVormen(o) {
  const type = o.type || 'fixed';
  if (!DRAAIENDE_RAMEN.has(type)) return glasVormen(o);
  const p = opties(o);
  const { vVan, vTot } = vlakken(o);
  const vanU = Number(o.vanU), totU = Number(o.totU);
  const binnen = o.zijde !== 'buiten';
  const rd = p.raamhoutDiepteMm;
  const r0 = binnen ? vTot - rd : vVan;
  const r1 = r0 + rd;
  const vormen = [];
  let glasVan = vanU, glasTot = totU;
  if (o.detail !== 'eenvoudig') {
    const buitenkant0 = vanU - p.sponningDiepteMm + p.deurSpelingMm;
    const buitenkant1 = totU + p.sponningDiepteMm - p.deurSpelingMm;
    vormen.push(rechthoek('raamhout', buitenkant0, buitenkant0 + p.raamhoutBreedteMm, r0, r1));
    vormen.push(rechthoek('raamhout', buitenkant1 - p.raamhoutBreedteMm, buitenkant1, r0, r1));
    glasVan = buitenkant0 + p.raamhoutBreedteMm;
    glasTot = buitenkant1 - p.raamhoutBreedteMm;
  }
  // Glas midden in het raamhout; het raamhout heeft zijn eigen sponning,
  // dus het glas steekt er net zo ver in als in een kozijn.
  const gm = (r0 + r1) / 2;
  const g0 = gm - p.glasDikteMm / 2, g1 = gm + p.glasDikteMm / 2;
  if (o.detail === 'eenvoudig') {
    vormen.push({ soort: 'lijn', rol: 'glas', van: { u: glasVan, v: gm }, tot: { u: glasTot, v: gm } });
  } else {
    const in0 = glasVan - p.sponningDiepteMm + p.insteekSpelingMm;
    const in1 = glasTot + p.sponningDiepteMm - p.insteekSpelingMm;
    vormen.push({ soort: 'lijn', rol: 'glas', van: { u: in0, v: g0 }, tot: { u: in1, v: g0 } });
    vormen.push({ soort: 'lijn', rol: 'glas', van: { u: in0, v: g1 }, tot: { u: in1, v: g1 } });
  }
  if ((type === 'turn' || type === 'draai') && o.toonDraairichting === true) {
    const a = scharnierPlus(o.scharnier) ? -1 : 1;
    const s = binnen ? 1 : -1;
    const phi = (Math.PI / 2) * a * s;
    const midden = {
      u: a > 0 ? vanU - p.sponningDiepteMm + p.deurSpelingMm : totU + p.sponningDiepteMm - p.deurSpelingMm,
      v: binnen ? vTot : vVan,
    };
    const vanRad = a > 0 ? 0 : Math.PI;
    vormen.push({
      soort: 'boog', rol: 'draaicirkel', streep: [4, 3],
      midden, straal: deurbladBreedte(o), vanRad, totRad: vanRad + phi, tegenKlok: phi < 0,
    });
  }
  return vormen;
}

/** Punten op een boog, voor de omhullende. */
function boogPunten(b, n = 32) {
  const uit = [];
  for (let i = 0; i <= n; i++) {
    const a = b.vanRad + ((b.totRad - b.vanRad) * i) / n;
    uit.push({ u: b.midden.u + b.straal * Math.cos(a), v: b.midden.v + b.straal * Math.sin(a) });
  }
  // Exacte uitersten waar de boog een as kruist.
  for (let k = -4; k <= 4; k++) {
    const a = (k * Math.PI) / 2;
    const lo = Math.min(b.vanRad, b.totRad), hi = Math.max(b.vanRad, b.totRad);
    if (a >= lo - 1e-12 && a <= hi + 1e-12) {
      uit.push({ u: b.midden.u + b.straal * Math.cos(a), v: b.midden.v + b.straal * Math.sin(a) });
    }
  }
  return uit;
}

/** Omhullende { uMin, uMax, vMin, vMax } van een lijst vormen. */
export function vormenOmhullende(vormen) {
  const pts = [];
  for (const f of vormen || []) {
    if (!f) continue;
    if (f.soort === 'vlak') pts.push(...f.punten);
    else if (f.soort === 'lijn') pts.push(f.van, f.tot);
    else if (f.soort === 'boog') pts.push(...boogPunten(f));
  }
  if (!pts.length) return null;
  return {
    uMin: Math.min(...pts.map((p) => p.u)), uMax: Math.max(...pts.map((p) => p.u)),
    vMin: Math.min(...pts.map((p) => p.v)), vMax: Math.max(...pts.map((p) => p.v)),
  };
}

/**
 * Lijndikte en vulling per rol. `factor` is een fractie van de lijndikte
 * van het symbool: de doorsnede (kozijnhout) krijgt de volle dikte, wat je
 * ziet of wat dun is (glas, draaicirkel, aanzicht) een fractie.
 */
export const VORM_STIJL = Object.freeze({
  stijl: { factor: 1, vul: '#ffffff' },
  raamhout: { factor: 0.6, vul: '#ffffff' },
  glaslat: { factor: 0.4, vul: '#ffffff' },
  paneel: { factor: 0.6, vul: '#ffffff' },
  deurblad: { factor: 0.6, vul: '#ffffff' },
  glas: { factor: 0.5 },
  draaicirkel: { factor: 0.35 },
  aanzicht: { factor: 0.35 },
});

/**
 * Vormen (mm) naar tekenopdrachten voor een symbool-template (paginapunten).
 * x = x0 + (u - uMin)·k;  y = y0 + (v - vMin)·k, of met `spiegelV`
 * y = y0 + (vMax - v)·k (dan staat de binnenzijde bovenaan).
 */
export function vormenNaarTekenopdrachten(vormen, o = {}) {
  const k = Number(o.ptPerMm) || 1;
  const x0 = Number(o.x0) || 0, y0 = Number(o.y0) || 0;
  const uMin = Number(o.uMin) || 0, vMin = Number(o.vMin) || 0;
  const spiegel = !!o.spiegelV;
  const vMax = Number(o.vMax) || 0;
  const X = (u) => x0 + (u - uMin) * k;
  const Y = (v) => (spiegel ? y0 + (vMax - v) * k : y0 + (v - vMin) * k);
  const pt = (p) => ({ x: X(p.u), y: Y(p.v) });
  const cmds = [];
  for (const f of vormen || []) {
    if (!f) continue;
    const st = VORM_STIJL[f.rol] || { factor: 1 };
    const streep = Array.isArray(f.streep) ? { dash: f.streep } : {};
    if (f.soort === 'vlak') {
      cmds.push({
        kind: 'polyline', points: f.punten.map(pt), close: true,
        ...(st.vul ? { fill: st.vul } : {}), lineWidthFactor: st.factor, ...streep,
      });
    } else if (f.soort === 'lijn') {
      const a = pt(f.van), b = pt(f.tot);
      cmds.push({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, lineWidthFactor: st.factor, ...streep });
    } else if (f.soort === 'boog') {
      const m = pt(f.midden);
      cmds.push({
        kind: 'arc', cx: m.x, cy: m.y, r: f.straal * k,
        a0: spiegel ? -f.vanRad : f.vanRad,
        a1: spiegel ? -f.totRad : f.totRad,
        ccw: spiegel ? !f.tegenKlok : !!f.tegenKlok,
        lineWidthFactor: st.factor, ...streep,
      });
    }
  }
  return cmds;
}
