// Echte (ongedraaide) maat van een gedraaide rechthoek, cirkel/ellips of
// parametrisch symbool bij het inlezen.
//
// De saver schrijft voor zo'n vorm /Rect als assen-uitgelijnde omhullende
// (AABB) van de gedraaide vorm, plus de rotatie in /OPS_Rotation. De AABB is
// dus NIET de maat van de vorm: wie hem als breedte/hoogte overneemt, laat de
// vorm bij elke opslaan-en-heropenen-rondgang groeien.
//
// Bronnen voor de echte maat, in volgorde van voorkeur:
//   1. kandidaten die de saver letterlijk wegschrijft — /OPS_Maat en de /BBox
//      van de appearance (die tekent de vorm ongedraaid op [0 0 w h]);
//   2. terugrekenen uit de AABB (exact, behalve rond 45° waar het stelsel
//      singulier is).
// Een kandidaat telt alleen als zijn gedraaide omhullende weer precies de
// /Rect oplevert. Zo wordt een /BBox die gewoon gelijk is aan /Rect (andere
// schrijvers, of een appearance zonder rotatie) niet voor de vormmaat
// aangezien.
//
// Kandidaten staan in PDF-ruimte. Op een blad met /Rotate 90 of 270 liggen
// breedte en hoogte in de weergave dus andersom.

const GRAD = Math.PI / 180;

/** Assen-uitgelijnde omhullende van een w×h-rechthoek onder `rotatie` graden. */
export function omhullendeMaat(w, h, rotatie) {
  const c = Math.abs(Math.cos(rotatie * GRAD));
  const s = Math.abs(Math.sin(rotatie * GRAD));
  return { width: w * c + h * s, height: w * s + h * c };
}

function klopt(kandidaat, omhullende, rotatie) {
  if (!kandidaat || !(kandidaat.width > 0) || !(kandidaat.height > 0)) return false;
  const o = omhullendeMaat(kandidaat.width, kandidaat.height, rotatie);
  // Relatieve tolerantie met een piepkleine technische bodem. Een absolute
  // term (was 0,1 pt) liet bij een vorm rond 0,1 pt ELKE kandidaat kloppen,
  // ook een /BBox die gewoon gelijk is aan /Rect, waardoor de omhullende als
  // maat werd overgenomen en de vorm per rondgang groeide.
  const tol = Math.max(1e-6, 0.002 * Math.max(omhullende.width, omhullende.height));
  return Math.abs(o.width - omhullende.width) <= tol
    && Math.abs(o.height - omhullende.height) <= tol;
}

/**
 * @param {object} p
 * @param {number} p.rotatie        rotatie in graden (onafgerond)
 * @param {{x,y,width,height}} p.omhullende  /Rect in weergaveruimte (AABB)
 * @param {Array<{width,height}|null>} [p.kandidaten]  maten in PDF-ruimte
 * @param {number} [p.paginaRotatie]  /Rotate van de pagina
 * @returns {{x,y,width,height,bron:string}}
 */
export function maatVanGedraaideVorm({ rotatie, omhullende, kandidaten = [], paginaRotatie = 0 }) {
  const cx = omhullende.x + omhullende.width / 2;
  const cy = omhullende.y + omhullende.height / 2;
  const rond = (w, h, bron) => ({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, bron });

  if (!Number.isFinite(rotatie) || Math.abs(Math.sin(rotatie * GRAD)) < 1e-9) {
    return rond(omhullende.width, omhullende.height, 'omhullende');
  }

  const pr = ((Math.round(paginaRotatie || 0) % 360) + 360) % 360;
  const wissel = pr === 90 || pr === 270;
  for (const k of kandidaten) {
    if (!k) continue;
    const weergave = wissel ? { width: k.height, height: k.width } : { width: k.width, height: k.height };
    if (klopt(weergave, omhullende, rotatie)) return rond(weergave.width, weergave.height, 'kandidaat');
  }

  // Terugrekenen: W = w·c + h·s, H = w·s + h·c  →  det = c² − s².
  const W = omhullende.width, H = omhullende.height;
  const c = Math.abs(Math.cos(rotatie * GRAD));
  const s = Math.abs(Math.sin(rotatie * GRAD));
  const det = c * c - s * s;
  if (Math.abs(det) > 0.01) {
    const w = (W * c - H * s) / det;
    const h = (H * c - W * s) / det;
    if (w > 0 && h > 0) return rond(w, h, 'terugrekening');
  }
  // Rond 45° is elke w+h met dezelfde som mogelijk; kies het vierkant dat
  // precies in de omhullende past. Kleiner dan de omhullende, dus geen groei.
  const zijde = Math.min(W, H) / (c + s);
  return rond(zijde, zijde, 'vierkant');
}
