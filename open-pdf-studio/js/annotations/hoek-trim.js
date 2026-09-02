// Kruisende hoek — gedeelde regel voor balken en wanden. Pure module.
//
// Twee bandvormige elementen (betonbalk, wand) die als hoek bedoeld zijn
// sluiten in de praktijk zelden exact aan: los getekend steken ze net
// voorbij elkaar of blijven ze net te kort. Deze module beantwoordt één
// vraag: is dit een bedoelde hoek, en zo ja, wáár ligt hij?
//
// De veiligheidsgrens zit in de eis dat BEIDE elementen een uiteinde vlak
// bij het snijpunt van hun hartlijnen hebben. Een element dat het MIDDEN
// van een ander kruist heeft dat niet en blijft dus gewoon een kruising.

/**
 * Reikwijdte als factor × de grootste halve bandbreedte: hoe ver een
 * uiteinde voorbij (of vóór) het snijpunt mag liggen en toch als hoek
 * geldt. Schaalt mee met de breedte — bij een dikke balk klikt niemand op
 * de punt nauwkeurig.
 */
export const CROSS_REIK_FACTOR = 4;

/** Ondergrens in app-px (≈ paginapunten): 12 pt ≈ 4 mm op papier. */
export const CROSS_REIK_MIN = 12;

export function kruisendeHoekReik(halfA, halfB) {
  return Math.max(CROSS_REIK_FACTOR * Math.max(halfA || 0, halfB || 0), CROSS_REIK_MIN);
}

function _unit(dx, dy) {
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? null : { x: dx / len, y: dy / len };
}

function _isect(p1, d1, p2, d2) {
  const noemer = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(noemer) < 1e-9) return null; // parallel
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / noemer;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/**
 * Bepaal of het uiteinde P (van een element dat vanaf `eigenVer` loopt) met
 * het element S→E een kruisende hoek vormt.
 *
 * @returns {{at:{x,y}, far:{x,y}, score:number}|null} `at` = het hoekpunt
 *   (snijpunt van de hartlijnen), `far` = het VERRE uiteinde van het andere
 *   element (de richting waarin dat element wegloopt), `score` = som van
 *   beide afstanden tot het hoekpunt, voor het kiezen van de beste kandidaat.
 */
export function kruisendeHoek(P, eigenVer, S, E, eigenHalf, doelHalf) {
  if (!P || !eigenVer || !S || !E) return null;
  const d1 = _unit(P.x - eigenVer.x, P.y - eigenVer.y);
  const d2 = _unit(E.x - S.x, E.y - S.y);
  if (!d1 || !d2) return null;
  const X = _isect(P, d1, S, d2);
  if (!X) return null;
  const reik = kruisendeHoekReik(eigenHalf, doelHalf);
  const dEigen = Math.hypot(P.x - X.x, P.y - X.y);
  if (dEigen > reik) return null;
  let beste = null;
  for (const [eind, ver] of [[S, E], [E, S]]) {
    const dDoel = Math.hypot(eind.x - X.x, eind.y - X.y);
    if (dDoel > reik) continue;
    const score = dEigen + dDoel;
    if (!beste || score < beste.score) beste = { at: X, far: ver, score };
  }
  return beste;
}
