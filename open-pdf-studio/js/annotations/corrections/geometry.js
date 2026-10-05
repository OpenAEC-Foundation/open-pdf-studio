// Meetkunde van proefleescorrecties (#508).
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
 * Raakt (x, y) het vak van een invoegteken? Het teken is klein, dus het vak
 * groeit aan elke kant met de raaktolerantie `tol`.
 */
export function caretHit(box, x, y, tol = 0) {
  const t = Math.max(0, Number(tol) || 0);
  return x >= box.x - t && x <= box.x + box.width + t
    && y >= box.y - t && y <= box.y + box.height + t;
}
