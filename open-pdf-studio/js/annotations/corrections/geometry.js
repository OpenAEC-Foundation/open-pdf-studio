// Meetkunde van proefleescorrecties (#508) en van de lijnen van gewone
// tekstmarkeringen (#527).
//
// Paginaruimte van de app: punten, oorsprong linksboven van de getoonde
// pagina, y omlaag. textDir is de leesrichting met de klok mee in die ruimte:
// 0, 90, 180 of 270 (0 = gewone tekst van links naar rechts). Ontbreekt hij,
// dan geldt 0.
//
// Puur: geen DOM, geen app-imports, zodat de saver, de lader en de tests
// (ook onder Node 20) dezelfde regels gebruiken.

// Tekstbox per regel: boven = basislijn + 0,8 h, onder = basislijn - 0,2 h,
// met h de lettergrootte. Dezelfde conventie als search/match-rect.js.
export const TEXT_ASCENT = 0.8;
export const TEXT_DESCENT = 0.2;

/** Leesrichting naar een kwartslag 0/90/180/270; onbruikbaar wordt 0. */
export function normTextDir(dir) {
  const d = Number(dir);
  if (!Number.isFinite(d)) return 0;
  return (((Math.round(d / 90) * 90) % 360) + 360) % 360;
}

/** Eenheidsvector in de leesrichting (y omlaag). */
export function dirVector(textDir) {
  switch (normTextDir(textDir)) {
    case 90: return { x: 0, y: 1 };
    case 180: return { x: -1, y: 0 };
    case 270: return { x: 0, y: -1 };
    default: return { x: 1, y: 0 };
  }
}

/** Eenheidsvector naar de bovenkant van de tekst (y omlaag). */
export function upVector(textDir) {
  switch (normTextDir(textDir)) {
    case 90: return { x: 1, y: 0 };
    case 180: return { x: 0, y: 1 };
    case 270: return { x: -1, y: 0 };
    default: return { x: 0, y: -1 };
  }
}

/**
 * Hoeken van een assen-uitgelijnde tekstrechthoek, geordend naar de tekst:
 * [begin-boven, eind-boven, begin-onder, eind-onder]. Voor gewone tekst is dat
 * linksboven, rechtsboven, linksonder, rechtsonder.
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {number} [textDir]
 */
export function quadCorners(rect, textDir) {
  const { x, y, width: w, height: h } = rect;
  const tl = { x, y };
  const tr = { x: x + w, y };
  const bl = { x, y: y + h };
  const br = { x: x + w, y: y + h };
  switch (normTextDir(textDir)) {
    case 90: return [tr, br, tl, bl];
    case 180: return [br, bl, tr, tl];
    case 270: return [bl, tl, br, tr];
    default: return [tl, tr, bl, br];
  }
}

const midden = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * De doorhaallijn van een quad: van het midden van begin-boven/begin-onder naar
 * het midden van eind-boven/eind-onder. Dezelfde lijn die pdf.js als
 * terugvaluiterlijk tekent.
 * @param {Array<{x:number,y:number}>} q  [p1, p2, p3, p4]
 */
export function quadMidline(q) {
  return [midden(q[0], q[2]), midden(q[1], q[3])];
}

const afstand = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// Punt `p` over afstand `d` richting `naar` geschoven.
function opschuiven(p, naar, d) {
  const l = afstand(p, naar);
  if (!(l > 0)) return { x: p.x, y: p.y };
  return { x: p.x + (naar.x - p.x) * d / l, y: p.y + (naar.y - p.y) * d / l };
}

/**
 * De onderstreping van een quad (#527): de onderrand van begin-onder naar
 * eind-onder, `inset` naar de bovenkant geschoven (hooguit de halve hoogte).
 * Het scherm tekent haar 1 pt boven de onderkant. Alleen de quadpunten
 * tellen, dus het werkt ook in PDF-gebruikersruimte.
 * @param {Array<{x:number,y:number}>} q  [p1, p2, p3, p4]
 * @param {number} [inset]
 */
export function quadUnderline(q, inset = 1) {
  const d = Math.min(inset, afstand(q[2], q[0]) / 2);
  return [opschuiven(q[2], q[0], d), opschuiven(q[3], q[1], d)];
}

/**
 * Kronkellijn van een quad (#527): een zigzag langs de onderrand, van
 * begin-onder naar eind-onder. Elk oneven punt ligt een tand naar de
 * bovenkant; de punten staan een tand uit elkaar langs de tekst. De tand is
 * h/6 (zoals pdf.js hem zelf tekent), begrensd op 0,5..4 pt en nooit hoger
 * dan de regel. Ook in PDF-gebruikersruimte bruikbaar.
 * @param {Array<{x:number,y:number}>} q  [p1, p2, p3, p4]
 * @returns {Array<{x:number,y:number}>}
 */
export function quadSquiggle(q) {
  const lengte = afstand(q[2], q[3]);
  const h = afstand(q[2], q[0]);
  if (!(lengte > 0) || !(h > 0)) return [{ x: q[2].x, y: q[2].y }, { x: q[3].x, y: q[3].y }];
  const tand = Math.min(4, Math.max(0.5, h / 6), h);
  const e = { x: (q[3].x - q[2].x) / lengte, y: (q[3].y - q[2].y) / lengte };
  const u = { x: (q[0].x - q[2].x) / h, y: (q[0].y - q[2].y) / h };
  const punten = [];
  for (let i = 0; ; i++) {
    const t = Math.min(i * tand, lengte);
    const hoog = i % 2 === 1 ? tand : 0;
    punten.push({ x: q[2].x + e.x * t + u.x * hoog, y: q[2].y + e.y * t + u.y * hoog });
    if (t >= lengte) break;
  }
  return punten;
}

/**
 * Vak van het invoegteken bij invoegpunt P (op de basislijn), lettergrootte h.
 * Zijde s = 0,5 h, begrensd op 3..16; de top ligt 0,1 h boven P en het vak
 * hangt vanaf de top naar de onderkant van de tekst.
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function caretGlyphBox(P, h, textDir) {
  const s = Math.min(16, Math.max(3, 0.5 * (Number(h) || 0)));
  const up = upVector(textDir);
  const top = { x: P.x + up.x * 0.1 * h, y: P.y + up.y * 0.1 * h };
  const mid = { x: top.x - up.x * s / 2, y: top.y - up.y * s / 2 };
  return { x: mid.x - s / 2, y: mid.y - s / 2, width: s, height: s };
}

/**
 * Punten van het invoegteken in zijn vak: [top, eind-voet, inkeping,
 * begin-voet]. De vorm van drawInsert (rendering/comment-icons.js): de top in
 * het midden van de bovenkant, de voeten op de onderhoeken, de inkeping op een
 * kwart van de hoogte boven de voet.
 */
export function caretGlyphPoints(box, textDir) {
  const s = Math.min(box.width, box.height);
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const up = upVector(textDir);
  const d = dirVector(textDir);
  const punt = (langs, omhoog) => ({ x: c.x + d.x * langs + up.x * omhoog, y: c.y + d.y * langs + up.y * omhoog });
  return [
    punt(0, s / 2),
    punt(s / 2, -s / 2),
    punt(0, -s / 4),
    punt(-s / 2, -s / 2),
  ];
}

/**
 * Leesrichting uit een vector (y omlaag): 0/90/180/270 als de hoek binnen
 * 1 graad van een kwartslag ligt, anders null.
 */
export function textDirFromVector(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null;
  const graden = Math.atan2(dy, dx) * 180 / Math.PI;
  const kwart = Math.round(graden / 90) * 90;
  if (Math.abs(graden - kwart) > 1) return null;
  return ((kwart % 360) + 360) % 360;
}

/** Leesrichting na een draaiing met de klok mee over `delta` graden. */
export function rotateTextDir(dir, delta) {
  return normTextDir(normTextDir(dir) + Number(delta || 0));
}

/**
 * Leesrichting in de paginaruimte van de app uit een pdf.js-teksttransform
 * [a, b, c, d, e, f] (PDF-gebruikersruimte, y omhoog; (a, b) is de basislijn)
 * op een pagina met totale rotatie `pageRot` (eigen /Rotate plus de
 * paginarotatie in de app). null als de tekst niet op een kwartslag ligt.
 */
export function textDirFromTransform(transform, pageRot) {
  if (!Array.isArray(transform)) return null;
  const inBestand = textDirFromVector(Number(transform[0]), -Number(transform[1]));
  return inBestand === null ? null : rotateTextDir(inBestand, pageRot);
}

/**
 * Raakt (x, y) het vak van een invoegteken? Het teken is klein, dus het vak
 * groeit aan elke kant met de raaktolerantie `tol`.
 */
export function caretHit(box, x, y, tol = 0) {
  const t = Math.max(0, Number(tol) || 0);
  return x >= box.x - t && x <= box.x + box.width + t
    && y >= box.y - t && y <= box.y + box.height + t;
}
