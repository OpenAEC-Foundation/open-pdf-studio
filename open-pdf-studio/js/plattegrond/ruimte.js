// Ruimten die zichzelf herkennen: uit de wanden van een blad volgen de
// omsloten ruimten, hun netto-oppervlakte en de plek voor het label.
//
// Het uitgangspunt van #450: een ruimte bewaart geen vaste contour maar een
// ZAADPUNT. Bij elke herberekening worden de wanden opnieuw gelezen en de
// omsluiting opnieuw bepaald. Verschuift een wand, dan verandert de
// oppervlakte mee — dat is precies de meerwaarde.
//
// Werkwijze (puur, zonder app-state):
//   1. Wandeindpunten clusteren tot knopen (tolerantie in paginapunten).
//   2. Gaten die door een sparing zijn ontstaan overbruggen: twee in elkaars
//      verlengde liggende wandstukken met een gat ertussen horen bij de
//      omsluiting; een deuropening is geen onderbreking van de ruimte.
//   3. Vlakken van de planaire graaf aflopen (halve ribben, bij elke knoop
//      de eerstvolgende met de klok mee) → elke begrensde lus is een ruimte.
//   4. De lus is de HARTLIJN-contour; de netto ruimte ligt binnen de
//      binnenvlakken, dus elke ribbe schuift een halve wanddikte naar binnen
//      en de hoekpunten zijn de snijpunten van die verschoven lijnen.
//
// Alle coördinaten in paginapunten; `pxPerMm` rekent om naar werkelijke maat.

const EPS = 1e-9;

/** Shoelace-som van een gesloten ring (paginacoördinaten, y omlaag). */
export function shoelace(poly) {
  let som = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    som += a.x * b.y - b.x * a.y;
  }
  return som;
}

/** Oppervlakte van een ring in paginapunten². */
export function vlak(poly) {
  return Math.abs(shoelace(poly)) / 2;
}

/** Omtrek van een ring in paginapunten. */
export function omtrek(poly) {
  let som = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    som += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return som;
}

/** Ligt p binnen de ring? (even-oddregel, rand telt als binnen.) */
export function puntInPolygoon(p, poly) {
  let binnen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (Math.abs((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) < 1e-7
      && Math.min(a.x, b.x) - 1e-7 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-7
      && Math.min(a.y, b.y) - 1e-7 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-7) {
      return true;                                   // op de rand
    }
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      binnen = !binnen;
    }
  }
  return binnen;
}

/**
 * Plek voor het ruimtelabel: het zwaartepunt, en als dat buiten de ruimte
 * valt (L-vormige ruimte, vide) het midden van de langste horizontale koorde
 * op de hoogte van dat zwaartepunt. Zo staat het label altijd ín de ruimte.
 */
export function labelPunt(poly) {
  if (!poly || poly.length < 3) return null;
  const opp = shoelace(poly);
  let cx = 0, cy = 0;
  if (Math.abs(opp) > EPS) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const k = a.x * b.y - b.x * a.y;
      cx += (a.x + b.x) * k;
      cy += (a.y + b.y) * k;
    }
    cx /= 3 * opp;
    cy /= 3 * opp;
  } else {
    for (const p of poly) { cx += p.x; cy += p.y; }
    cx /= poly.length; cy /= poly.length;
  }
  const zwaartepunt = { x: cx, y: cy };
  if (puntInPolygoon(zwaartepunt, poly)) return zwaartepunt;

  // Snijpunten van de horizontale lijn y = cy met de ring, op x gesorteerd;
  // de langste binnenkoorde levert het midden.
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a.y > cy) === (b.y > cy)) continue;
    xs.push(a.x + ((cy - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  xs.sort((p, q) => p - q);
  let beste = null;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const breedte = xs[i + 1] - xs[i];
    if (breedte > EPS && (!beste || breedte > beste.breedte)) {
      beste = { breedte, x: (xs[i] + xs[i + 1]) / 2 };
    }
  }
  return beste ? { x: beste.x, y: cy } : zwaartepunt;
}

// ── graaf ────────────────────────────────────────────────────────────────

function halveDikte(wand) {
  const d = Number(wand?.dikteMm);
  return (d > 0 ? d : 100) / 2;
}

function eenheid(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  return { x: dx / len, y: dy / len, len };
}

/**
 * Gaten overbruggen die door een sparing zijn ontstaan: twee wandstukken die
 * in elkaars verlengde liggen (richting binnen `hoekTol` radialen) met een
 * vrij uiteinde tegenover elkaar en een gat van hooguit `maxGatPt`. Het gat
 * krijgt een virtuele ribbe met de dikte van de wand ernaast.
 *
 * `maxGatPt` is een MAAT OP HET BLAD en hangt dus van de schaal af;
 * `ruimtenUitWanden` rekent hem uit `maxGatMm` (standaard 3000 mm — breder
 * dan dat is geen sparing meer maar een echt gat in de contour).
 */
export function overbrugSparingen(wanden, opties = {}) {
  const maxGat = opties.maxGatPt ?? Infinity;
  const tol = opties.tolerantie ?? 1.5;
  const hoekTol = opties.hoekTol ?? 0.05;
  const uiteinden = [];
  for (const w of wanden) {
    const u = eenheid(w.endX - w.startX, w.endY - w.startY);
    if (!u) continue;
    uiteinden.push({ wand: w, u, punt: { x: w.startX, y: w.startY }, naarBuiten: { x: -u.x, y: -u.y } });
    uiteinden.push({ wand: w, u, punt: { x: w.endX, y: w.endY }, naarBuiten: { x: u.x, y: u.y } });
  }
  const bruggen = [];
  for (let i = 0; i < uiteinden.length; i++) {
    for (let j = i + 1; j < uiteinden.length; j++) {
      const a = uiteinden[i], b = uiteinden[j];
      if (a.wand === b.wand || a.wand.id === b.wand.id) continue;
      const gat = eenheid(b.punt.x - a.punt.x, b.punt.y - a.punt.y);
      if (!gat || gat.len <= tol || gat.len > maxGat) continue;
      // Beide uiteinden moeten NAAR het gat toe wijzen en de wanden moeten
      // in elkaars verlengde liggen.
      if (a.naarBuiten.x * gat.x + a.naarBuiten.y * gat.y < 1 - hoekTol) continue;
      if (b.naarBuiten.x * -gat.x + b.naarBuiten.y * -gat.y < 1 - hoekTol) continue;
      bruggen.push({
        id: `brug:${a.wand.id}:${b.wand.id}`,
        startX: a.punt.x, startY: a.punt.y, endX: b.punt.x, endY: b.punt.y,
        dikteMm: Math.max(Number(a.wand.dikteMm) || 0, Number(b.wand.dikteMm) || 0) || 100,
        brug: true,
      });
    }
  }
  return bruggen;
}

/**
 * T-aansluitingen opknippen. Een binnenwand die halverwege tegen een gevel
 * eindigt maakt daar geen knoop: de gevel loopt gewoon door. Zonder deze stap
 * ziet de vlakzoeker twee kamers als één. Elke ribbe wordt daarom gesplitst
 * op de eindpunten van andere ribben die op haar hartlijn liggen. De
 * deelribben houden de id en de dikte van hun wand.
 */
export function splitsOpAansluitingen(ribben, tol = 1.5) {
  const punten = [];
  for (const r of ribben) {
    punten.push({ x: r.startX, y: r.startY }, { x: r.endX, y: r.endY });
  }
  const uit = [];
  for (const r of ribben) {
    const u = eenheid(r.endX - r.startX, r.endY - r.startY);
    if (!u) continue;
    const langs = [];
    for (const p of punten) {
      const rx = p.x - r.startX, ry = p.y - r.startY;
      const t = rx * u.x + ry * u.y;
      if (Math.abs(rx * -u.y + ry * u.x) > tol) continue;
      if (t <= tol || t >= u.len - tol) continue;
      langs.push(t);
    }
    if (!langs.length) { uit.push(r); continue; }
    langs.sort((a, b) => a - b);
    const grenzen = [0];
    for (const t of langs) if (t - grenzen[grenzen.length - 1] > tol) grenzen.push(t);
    grenzen.push(u.len);
    for (let i = 0; i + 1 < grenzen.length; i++) {
      const a = grenzen[i], b = grenzen[i + 1];
      if (b - a <= tol) continue;
      uit.push({
        ...r,
        startX: r.startX + u.x * a, startY: r.startY + u.y * a,
        endX: r.startX + u.x * b, endY: r.startY + u.y * b,
      });
    }
  }
  return uit;
}

function bouwGraaf(ribben, tol) {
  const knopen = [];
  const sleutel = (p) => {
    for (let i = 0; i < knopen.length; i++) {
      if (Math.hypot(knopen[i].x - p.x, knopen[i].y - p.y) <= tol) return i;
    }
    knopen.push({ x: p.x, y: p.y });
    return knopen.length - 1;
  };
  const halve = [];
  for (const r of ribben) {
    const a = sleutel({ x: r.startX, y: r.startY });
    const b = sleutel({ x: r.endX, y: r.endY });
    if (a === b) continue;                              // lus op één knoop
    const i = halve.length;
    halve.push({ van: a, naar: b, ribbe: r, omgekeerd: i + 1, index: i });
    halve.push({ van: b, naar: a, ribbe: r, omgekeerd: i, index: i + 1 });
  }
  const uit = knopen.map(() => []);
  for (const h of halve) {
    const k = knopen[h.van], n = knopen[h.naar];
    h.hoek = Math.atan2(n.y - k.y, n.x - k.x);
    uit[h.van].push(h);
  }
  for (const lijst of uit) lijst.sort((a, b) => a.hoek - b.hoek);
  return { knopen, halve, uit };
}

/**
 * Vlakken van de planaire graaf. Bij aankomst via `h` in knoop v is de
 * volgende halve ribbe de VOORGANGER van de omgekeerde ribbe in de op hoek
 * gesorteerde lijst. Die keuze levert in paginacoördinaten (y omlaag) de
 * begrensde vlakken met een POSITIEVE shoelace; het buitenvlak loopt
 * andersom en valt zo vanzelf af.
 */
function vlakken(graaf) {
  const { knopen, halve, uit } = graaf;
  const gezien = new Set();
  const uit_ = [];
  for (const start of halve) {
    if (gezien.has(start.index)) continue;
    const lus = [];
    let h = start;
    let veilig = 0;
    while (!gezien.has(h.index) && veilig++ < halve.length + 2) {
      gezien.add(h.index);
      lus.push(h);
      const omg = halve[h.omgekeerd];
      const lijst = uit[h.naar];
      const pos = lijst.indexOf(omg);
      h = lijst[(pos - 1 + lijst.length) % lijst.length];
    }
    if (lus.length < 3) continue;
    const poly = lus.map((e) => knopen[e.van]);
    if (shoelace(poly) <= 0) continue;                  // buitenvlak
    // Een lus die een ribbe heen én terug loopt is een doodlopend aanhangsel,
    // geen ruimte.
    const ribben = new Set();
    let dubbel = false;
    for (const e of lus) {
      if (ribben.has(e.ribbe)) { dubbel = true; break; }
      ribben.add(e.ribbe);
    }
    if (dubbel) continue;
    uit_.push({ lus, poly });
  }
  return uit_;
}

/**
 * Binnencontour: elke hartlijn-ribbe schuift een halve wanddikte naar binnen
 * en de hoekpunten zijn de snijpunten van de verschoven lijnen. Bij
 * evenwijdige buren valt het terug op het verschoven eindpunt.
 */
export function binnenContour(poly, halveDiktesPt) {
  const n = poly.length;
  if (n < 3) return poly.slice();
  const s = shoelace(poly) > 0 ? 1 : -1;
  const lijnen = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const u = eenheid(b.x - a.x, b.y - a.y);
    if (!u) return poly.slice();
    const nx = -u.y * s, ny = u.x * s;                  // naar binnen
    const d = halveDiktesPt[i] ?? 0;
    lijnen.push({ p: { x: a.x + nx * d, y: a.y + ny * d }, u });
  }
  const uit = [];
  for (let i = 0; i < n; i++) {
    const l1 = lijnen[(i - 1 + n) % n], l2 = lijnen[i];
    const den = l1.u.x * l2.u.y - l1.u.y * l2.u.x;
    if (Math.abs(den) < 1e-7) {
      uit.push({ x: l2.p.x, y: l2.p.y });
      continue;
    }
    const t = ((l2.p.x - l1.p.x) * l2.u.y - (l2.p.y - l1.p.y) * l2.u.x) / den;
    uit.push({ x: l1.p.x + l1.u.x * t, y: l1.p.y + l1.u.y * t });
  }
  return uit;
}

/** Kortste afstand van p tot de rand van een ring. */
function afstandTotRand(p, poly) {
  let beste = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    beste = Math.min(beste, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return beste;
}

/**
 * Een spouwmuur is getekend als losse wandlussen per laag (buitenblad,
 * isolatie, binnenblad). Elke laaglus sluit een eigen vlak in, maar alleen
 * het binnenste is een ruimte: een vlak dat een kleiner vlak omsluit en er
 * overal vlak langs loopt (hooguit `ringMaxPt`) is de ring van een
 * luchtspouw of isolatielaag en valt af. Een ruimte met een losse schacht
 * erin blijft staan: haar rand ligt ver van de schacht.
 */
function zonderLaagringen(ruimten, ringMaxPt) {
  const ring = (a) => ruimten.some((b) => b !== a
    && b.oppervlakteM2 < a.oppervlakteM2
    && b.polygoon.every((p) => puntInPolygoon(p, a.polygoon))
    && a.polygoon.every((p) => afstandTotRand(p, b.polygoon) <= ringMaxPt));
  const weg = ruimten.filter(ring);
  for (const r of weg) ruimten.splice(ruimten.indexOf(r), 1);
}

/**
 * De ruimten van een blad.
 *
 * @param {Array} wanden  `{ id, startX, startY, endX, endY, dikteMm }`
 * @param {object} opties `{ pxPerMm, tolerantie, maxGatMm, bruggen }`
 * @returns {{ ruimten: Array<{ polygoon, hartlijn, oppervlakteM2, omtrekM,
 *   labelPunt, wandIds }>, losseEinden: Array<{x,y,wandId}> }}
 *   `losseEinden` zijn wandeinden die nergens op aansluiten: dáár is de
 *   contour niet gesloten. Melden, niet stilzwijgend half vullen.
 */
export function ruimtenUitWanden(wanden, opties = {}) {
  const pxPerMm = opties.pxPerMm > 0 ? opties.pxPerMm : 1;
  const tol = opties.tolerantie ?? 1.5;
  const echte = (wanden || []).filter((w) => eenheid(w.endX - w.startX, w.endY - w.startY));
  const bruggen = opties.bruggen ?? overbrugSparingen(echte, {
    maxGatPt: (opties.maxGatMm ?? 3000) * pxPerMm,
    tolerantie: tol,
  });
  const graaf = bouwGraaf(splitsOpAansluitingen([...echte, ...bruggen], tol), tol);

  const ruimten = [];
  for (const { lus, poly } of vlakken(graaf)) {
    const diktes = lus.map((e) => halveDikte(e.ribbe) * pxPerMm);
    const binnen = binnenContour(poly, diktes);
    if (binnen.length < 3) continue;
    const oppPt = vlak(binnen);
    if (oppPt <= EPS) continue;
    ruimten.push({
      polygoon: binnen,
      hartlijn: poly.map((p) => ({ x: p.x, y: p.y })),
      oppervlakteM2: oppPt / (pxPerMm * pxPerMm) / 1e6,
      omtrekM: omtrek(binnen) / pxPerMm / 1000,
      labelPunt: labelPunt(binnen),
      wandIds: [...new Set(lus.filter((e) => !e.ribbe.brug).map((e) => e.ribbe.id))],
    });
  }
  ruimten.sort((a, b) => b.oppervlakteM2 - a.oppervlakteM2);
  zonderLaagringen(ruimten, (opties.ringMaxMm ?? 600) * pxPerMm);

  // Losse einden: knopen met graad 1 (wand die nergens op aansluit).
  const losseEinden = [];
  graaf.uit.forEach((lijst, i) => {
    if (lijst.length !== 1) return;
    const k = graaf.knopen[i];
    losseEinden.push({ x: k.x, y: k.y, wandId: lijst[0].ribbe.id });
  });
  return { ruimten, losseEinden };
}

/** De ruimte waarin `zaad` ligt — de kleinste, zodat een ruimte binnen een
 *  ruimte (vide) het wint van de omhullende. */
export function ruimteBijZaad(ruimten, zaad) {
  let beste = null;
  for (const r of ruimten || []) {
    if (!puntInPolygoon(zaad, r.polygoon)) continue;
    if (!beste || r.oppervlakteM2 < beste.oppervlakteM2) beste = r;
  }
  return beste;
}

/** Labeltekst zoals op een bouwtekening: naam boven, netto oppervlakte eronder. */
export function ruimteLabel(naam, oppervlakteM2, decimalen = 1) {
  const opp = `${oppervlakteM2.toFixed(decimalen)} m²`;
  return naam ? `${naam}\n${opp}` : opp;
}
