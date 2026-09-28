// Weergave draaien (#200): de pagina op het scherm draaien zonder het document
// te bewerken.
//
// Twee ruimtes:
//  - paginaruimte: waar annotaties, meetschalen en tekstbewerkingen in leven.
//    Punten, oorsprong linksboven van de pagina zoals het document hem toont
//    (dus ná de eigen paginarotatie), y omlaag. Maat breedte × hoogte.
//  - weergaveruimte: diezelfde pagina, rechtsom gedraaid over de
//    weergaverotatie (0/90/180/270). Maat breedte × hoogte, of hoogte ×
//    breedte bij een kwartslag.
//
// Het scherm toont de weergaveruimte (zoom + verschuiving). Alles wat van het
// scherm naar de pagina rekent, gaat via naarPagina(); alles wat de pagina op
// het scherm zet via naarWeergave() of weergaveMatrix(). Rechtsom is dezelfde
// richting als /Rotate in een PDF en als rotatePage(+90).
//
// Puur rekenwerk, zonder DOM of app-toestand: getest met node --test.

/** 0, 90, 180 of 270; alles wat geen kwartslag is telt als 0. */
export function normaliseerRotatie(graden) {
  const r = ((Math.round(Number(graden) || 0) % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/** Wisselen breedte en hoogte bij deze rotatie? */
export function isKwartslag(rotatie) {
  const r = normaliseerRotatie(rotatie);
  return r === 90 || r === 270;
}

/**
 * Maat van de gedraaide pagina.
 * @param {number} breedte  paginabreedte (paginaruimte)
 * @param {number} hoogte   paginahoogte (paginaruimte)
 * @param {number} rotatie  weergaverotatie in graden
 * @returns {{breedte: number, hoogte: number}}
 */
export function weergaveMaat(breedte, hoogte, rotatie) {
  return isKwartslag(rotatie)
    ? { breedte: hoogte, hoogte: breedte }
    : { breedte, hoogte };
}

/**
 * Affiene matrix [a, b, c, d, e, f] van paginaruimte naar weergaveruimte
 * (canvas-conventie: x' = a·x + c·y + e, y' = b·x + d·y + f).
 */
export function weergaveMatrix(breedte, hoogte, rotatie) {
  switch (normaliseerRotatie(rotatie)) {
    case 90: return [0, 1, -1, 0, hoogte, 0];
    case 180: return [-1, 0, 0, -1, breedte, hoogte];
    case 270: return [0, -1, 1, 0, 0, breedte];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

/** De omgekeerde matrix: weergaveruimte naar paginaruimte. */
export function paginaMatrix(breedte, hoogte, rotatie) {
  switch (normaliseerRotatie(rotatie)) {
    case 90: return [0, -1, 1, 0, 0, hoogte];
    case 180: return [-1, 0, 0, -1, breedte, hoogte];
    case 270: return [0, 1, -1, 0, breedte, 0];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

/**
 * Product van twee affiene matrices: eerst `binnen`, dan `buiten`
 * (zoals ctx.setTransform(buiten) gevolgd door ctx.transform(binnen)).
 */
export function vermenigvuldig(buiten, binnen) {
  const [a1, b1, c1, d1, e1, f1] = buiten;
  const [a2, b2, c2, d2, e2, f2] = binnen;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ].map(zonderMinNul);
}

// -0 → 0, zodat vergelijkingen en sleutels geen verschil zien.
function zonderMinNul(v) {
  return v === 0 ? 0 : v;
}

function pas(m, x, y) {
  return {
    x: zonderMinNul(m[0] * x + m[2] * y + m[4]),
    y: zonderMinNul(m[1] * x + m[3] * y + m[5]),
  };
}

/** Punt in paginaruimte → punt in weergaveruimte. */
export function naarWeergave(x, y, breedte, hoogte, rotatie) {
  return pas(weergaveMatrix(breedte, hoogte, rotatie), x, y);
}

/** Punt in weergaveruimte → punt in paginaruimte. */
export function naarPagina(u, v, breedte, hoogte, rotatie) {
  return pas(paginaMatrix(breedte, hoogte, rotatie), u, v);
}

/** Verplaatsing (zonder oorsprong) in weergaveruimte → paginaruimte. */
export function vectorNaarPagina(du, dv, rotatie) {
  const m = paginaMatrix(0, 0, rotatie);
  return { x: zonderMinNul(m[0] * du + m[2] * dv), y: zonderMinNul(m[1] * du + m[3] * dv) };
}

/** Verplaatsing in paginaruimte → weergaveruimte. */
export function vectorNaarWeergave(dx, dy, rotatie) {
  const m = weergaveMatrix(0, 0, rotatie);
  return { x: zonderMinNul(m[0] * dx + m[2] * dy), y: zonderMinNul(m[1] * dx + m[3] * dy) };
}

function rechthoek(m, r) {
  const x = Number(r?.x) || 0;
  const y = Number(r?.y) || 0;
  const w = Number(r?.width) || 0;
  const h = Number(r?.height) || 0;
  const p1 = pas(m, x, y);
  const p2 = pas(m, x + w, y + h);
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    width: Math.abs(p2.x - p1.x),
    height: Math.abs(p2.y - p1.y),
  };
}

/**
 * Rechthoek {x, y, width, height} in paginaruimte → weergaveruimte. Een
 * kwartslag houdt een rechthoek recht, dus het resultaat is exact.
 */
export function rectNaarWeergave(r, breedte, hoogte, rotatie) {
  return rechthoek(weergaveMatrix(breedte, hoogte, rotatie), r);
}

/** Rechthoek in weergaveruimte → paginaruimte. */
export function rectNaarPagina(r, breedte, hoogte, rotatie) {
  return rechthoek(paginaMatrix(breedte, hoogte, rotatie), r);
}

// ─── Enkelpagina-viewport ───────────────────────────────────────────────────
// De viewport (pdf-viewport.js) toont één pagina met zoom en verschuiving:
// scherm = verschuiving + zoom · weergavepunt. `pageW`/`pageH` zijn de maat na
// de eigen /Rotate van de PDF, `rotation` de paginarotatie van het document en
// `viewRotation` de weergaverotatie. Zoom, pannen en passend maken rekenen in
// de weergaveruimte (schermBreedte × schermHoogte); de pagina-inhoud en de
// annotaties staan in de paginaruimte en gaan via `matrix` naar het scherm.

/**
 * @param {{pageW:number, pageH:number, rotation?:number, viewRotation?:number,
 *          zoom?:number, offsetX?:number, offsetY?:number}} vp
 * @returns {{paginaBreedte:number, paginaHoogte:number, schermBreedte:number,
 *            schermHoogte:number, rotatie:number, matrix:number[]}}
 *          matrix: paginaruimte → CSS-pixels binnen het viewport-canvas.
 */
export function viewportGeometrie(vp) {
  const pag = weergaveMaat(Number(vp?.pageW) || 0, Number(vp?.pageH) || 0, vp?.rotation);
  const rotatie = normaliseerRotatie(vp?.viewRotation);
  const scherm = weergaveMaat(pag.breedte, pag.hoogte, rotatie);
  const zoom = Number(vp?.zoom) || 1;
  const verschuiving = [zoom, 0, 0, zoom, Number(vp?.offsetX) || 0, Number(vp?.offsetY) || 0];
  return {
    paginaBreedte: pag.breedte,
    paginaHoogte: pag.hoogte,
    schermBreedte: scherm.breedte,
    schermHoogte: scherm.hoogte,
    rotatie,
    matrix: vermenigvuldig(verschuiving, weergaveMatrix(pag.breedte, pag.hoogte, rotatie)),
  };
}

/** CSS-pixel binnen het viewport-canvas → punt in paginaruimte. */
export function viewportNaarPagina(vp, sx, sy) {
  const g = viewportGeometrie(vp);
  const zoom = Number(vp?.zoom) || 1;
  const u = (sx - (Number(vp?.offsetX) || 0)) / zoom;
  const v = (sy - (Number(vp?.offsetY) || 0)) / zoom;
  return naarPagina(u, v, g.paginaBreedte, g.paginaHoogte, g.rotatie);
}

/** Punt in paginaruimte → CSS-pixel binnen het viewport-canvas. */
export function viewportNaarScherm(vp, x, y) {
  return pas(viewportGeometrie(vp).matrix, x, y);
}

/**
 * Het zichtbare deel van de pagina, in paginaruimte: het canvas (cssBreedte ×
 * cssHoogte) terugrekenen naar de weergave, bijsnijden op de pagina en
 * terugdraaien. Lege rechthoek (breedte/hoogte 0) als de pagina buiten beeld is.
 */
export function viewportZichtbaar(vp, cssBreedte, cssHoogte) {
  const g = viewportGeometrie(vp);
  const zoom = Number(vp?.zoom) || 1;
  const offX = Number(vp?.offsetX) || 0;
  const offY = Number(vp?.offsetY) || 0;
  const links = Math.max(0, -offX / zoom);
  const boven = Math.max(0, -offY / zoom);
  const rechts = Math.min(g.schermBreedte, (cssBreedte - offX) / zoom);
  const onder = Math.min(g.schermHoogte, (cssHoogte - offY) / zoom);
  const inBeeld = {
    x: links,
    y: boven,
    width: Math.max(0, rechts - links),
    height: Math.max(0, onder - boven),
  };
  return rectNaarPagina(inBeeld, g.paginaBreedte, g.paginaHoogte, g.rotatie);
}

// ─── Rechtop op het scherm ──────────────────────────────────────────────────
// Een nieuw tekstvak in een gedraaide weergave krijgt de tegengestelde
// rotatie, zodat het op het scherm rechtop staat (weergave-ruimte.js,
// rechtopRotatie). Annotaties draaien om hun midden, rechtsom, y omlaag.

/**
 * Het vak dat de gebruiker sleepte, rechtop op het scherm. `omhullende` is de
 * gesleepte rechthoek in de paginaruimte; het vak zelf krijgt de maat zoals
 * op het scherm (bij een kwartslag wisselen breedte en hoogte) om hetzelfde
 * midden, met de gegeven rotatie.
 * @returns {{x:number, y:number, width:number, height:number, rotation:number}}
 */
export function rechtopVak(omhullende, rotatie) {
  const rot = normaliseerRotatie(rotatie);
  const x = Number(omhullende?.x) || 0;
  const y = Number(omhullende?.y) || 0;
  const breedte = Number(omhullende?.width) || 0;
  const hoogte = Number(omhullende?.height) || 0;
  const kwart = isKwartslag(rot);
  const w = kwart ? hoogte : breedte;
  const h = kwart ? breedte : hoogte;
  return { x: x + breedte / 2 - w / 2, y: y + hoogte / 2 - h / 2, width: w, height: h, rotation: rot };
}

/**
 * Een vak dat om zijn midden gedraaid is (`rotation` in graden, rechtsom) een
 * nieuwe maat geven met zijn eigen linkerbovenhoek op dezelfde plek. Zo groeit
 * het vak zoals de gebruiker het ziet naar rechts en omlaag, ook als het
 * gedraaid op de pagina staat. Zonder rotatie blijven x en y staan.
 * @returns {{x:number, y:number, width:number, height:number}}
 */
export function nieuweMaatHoekVast(vak, breedte, hoogte) {
  const a = ((Number(vak?.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const draai = (dx, dy) => [dx * cos - dy * sin, dx * sin + dy * cos];
  const oudB = Number(vak?.width) || 0;
  const oudH = Number(vak?.height) || 0;
  const [hx, hy] = draai(-oudB / 2, -oudH / 2);
  const hoekX = (Number(vak?.x) || 0) + oudB / 2 + hx;
  const hoekY = (Number(vak?.y) || 0) + oudH / 2 + hy;
  const [mx, my] = draai(breedte / 2, hoogte / 2);
  return { x: hoekX + mx - breedte / 2, y: hoekY + my - hoogte / 2, width: breedte, height: hoogte };
}
