// Openingen die bij een wand horen (#1229). Pure module.
//
// Een deur of raam dat IN een wand geplaatst is, blijft bij die wand: de wand
// is één annotatie en houdt een lijst `openingen` bij. Elke opening is
//
//   { id, key, afstandMm, breedteMm, soort: 'deur' | 'raam', zijde: 1 | -1 }
//
//   id         de annotatie van het kozijn (parametricSymbol door/window);
//              dat symbool wijst terug met params.hostWallId
//   key        vaste sleutel van de opening; staat ook in het symbool als
//              params.hostKey. Annotatie-id's veranderen bij opslaan en
//              heropenen, de sleutel niet: daarmee vindt de lader de twee
//              weer bij elkaar (herkoppelOpeningen)
//   afstandMm  van het BEGINpunt van de wand tot het HART van de opening,
//              langs de hartlijn, in werkelijke mm
//   breedteMm  de breedte van het gat (de kozijnmaat)
//   zijde      naar welke kant de deur draait: +1 = links van de wandrichting
//
// Deze module levert wat het tekenen nodig heeft: waar de wandband open is.
// Het plaatsen, verschuiven en meebewegen staat in
// plattegrond/gehoste-opening.js (die pas laadt als er iets te hosten valt).
//
// Wanden uit oudere bestanden zijn om een kozijn heen in stukken geknipt en
// hebben geen `openingen`: voor hen verandert er niets.

const EPS = 1e-6;

/** De soorten opening. */
export const OPENING_SOORTEN = Object.freeze(['deur', 'raam']);

/** De soort opening bij een kozijnsymbool. */
export const SOORT_VAN_SYMBOOL = Object.freeze({ door: 'deur', window: 'raam' });

function getal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** De geldige openingen van een wand (lege lijst zonder). */
export function wandOpeningen(wand) {
  const lijst = wand?.openingen;
  if (!Array.isArray(lijst) || lijst.length === 0) return [];
  return lijst.filter((o) => o && getal(o.breedteMm) > 0 && getal(o.afstandMm) !== null);
}

/** Heeft deze wand openingen? */
export function heeftOpeningen(wand) {
  return wandOpeningen(wand).length > 0;
}

/** Een nieuwe sleutel voor een opening. */
export function nieuweOpeningSleutel() {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Het hart van een opening zo dicht mogelijk bij `afstandMm` terwijl ze
 * binnen de wand past. Is de opening breder dan de wand, dan staat ze in
 * het midden.
 */
export function klemAfstandMm(lengteMm, breedteMm, afstandMm) {
  const L = Math.max(0, getal(lengteMm) ?? 0);
  const b = Math.max(0, getal(breedteMm) ?? 0);
  const c = getal(afstandMm) ?? 0;
  if (b >= L) return L / 2;
  return Math.min(L - b / 2, Math.max(b / 2, c));
}

/**
 * De openingen ingepast in een wand van `lengteMm`: elke opening houdt haar
 * afstand tot het begin, tenzij ze dan buiten de wand valt; dan schuift ze
 * terug tot ze past. Openingen schuiven elkaar daarbij opzij in plaats van
 * over elkaar te vallen. Geeft nieuwe objecten terug, op volgorde langs de
 * wand; de invoer blijft ongemoeid.
 */
export function pasOpeningenIn(lengteMm, openingen) {
  const L = Math.max(0, getal(lengteMm) ?? 0);
  const uit = (openingen || [])
    .filter((o) => o && getal(o.breedteMm) > 0 && getal(o.afstandMm) !== null)
    .map((o) => ({ ...o, afstandMm: Number(o.afstandMm), breedteMm: Number(o.breedteMm) }))
    .sort((a, b) => a.afstandMm - b.afstandMm);
  // Van het eind terug: niets voorbij het eindpunt, niets over de volgende.
  let grens = L;
  for (let i = uit.length - 1; i >= 0; i--) {
    const o = uit[i];
    o.afstandMm = Math.min(o.afstandMm, grens - o.breedteMm / 2);
    grens = o.afstandMm - o.breedteMm / 2;
  }
  // Van het begin vooruit: niets voor het beginpunt, niets over de vorige.
  grens = 0;
  for (const o of uit) {
    o.afstandMm = Math.max(o.afstandMm, grens + o.breedteMm / 2);
    grens = o.afstandMm + o.breedteMm / 2;
  }
  // Past het geheel niet, dan blijft ten minste elke opening op de wand.
  if (grens > L + EPS) {
    for (const o of uit) o.afstandMm = klemAfstandMm(L, o.breedteMm, o.afstandMm);
  }
  return uit;
}

/**
 * Waar de wandband open is: intervallen [t0, t1] langs de as, in
 * paginapunten vanaf het beginpunt, op volgorde en zonder overlap.
 * @param {number} lengtePt  lengte van de wand in paginapunten
 * @param {Array} openingen  de openingen van de wand
 * @param {number} pxPerMm   paginapunten per werkelijke millimeter
 * @returns {Array<{t0:number, t1:number, id?:string}>}
 */
export function openingIntervallen(lengtePt, openingen, pxPerMm) {
  if (!(lengtePt > 0) || !(pxPerMm > 0)) return [];
  const ingepast = pasOpeningenIn(lengtePt / pxPerMm, openingen);
  const uit = [];
  for (const o of ingepast) {
    const t0 = Math.max(0, (o.afstandMm - o.breedteMm / 2) * pxPerMm);
    const t1 = Math.min(lengtePt, (o.afstandMm + o.breedteMm / 2) * pxPerMm);
    if (t1 - t0 <= 0.01) continue;
    const vorige = uit[uit.length - 1];
    if (vorige && t0 <= vorige.t1 + EPS) vorige.t1 = Math.max(vorige.t1, t1);
    else uit.push({ t0, t1, id: o.id });
  }
  return uit;
}

/** Overlapt het gat [hart - b/2, hart + b/2] een van de andere openingen? */
export function overlaptOpening(afstandMm, breedteMm, anderen) {
  const a0 = afstandMm - breedteMm / 2, a1 = afstandMm + breedteMm / 2;
  return (anderen || []).some((o) => {
    const b0 = o.afstandMm - o.breedteMm / 2, b1 = o.afstandMm + o.breedteMm / 2;
    return a0 < b1 - EPS && b0 < a1 - EPS;
  });
}

/**
 * Na het laden: wanden en hun kozijnen weer aan elkaar koppelen. De wand
 * kent van elke opening de sleutel, het kozijn draagt dezelfde sleutel in
 * params.hostKey. Een opening zonder kozijn op de pagina vervalt (de wand
 * is daar dan dicht); een kozijn zonder wand blijft een los symbool.
 * Muteert de annotaties en geeft het aantal gelegde koppelingen terug.
 */
export function herkoppelOpeningen(annotaties) {
  const lijst = annotaties || [];
  const wanden = lijst.filter((a) => a?.type === 'wall' && Array.isArray(a.openingen) && a.openingen.length);
  if (!wanden.length) return 0;
  const perSleutel = new Map();
  for (const a of lijst) {
    const sleutel = a?.type === 'parametricSymbol' ? a.params?.hostKey : null;
    if (typeof sleutel !== 'string' || !sleutel) continue;
    if (!perSleutel.has(sleutel)) perSleutel.set(sleutel, []);
    perSleutel.get(sleutel).push(a);
  }
  let gekoppeld = 0;
  const bezet = new Set();
  for (const wand of wanden) {
    const blijft = [];
    for (const o of wand.openingen) {
      const kandidaten = (o && typeof o.key === 'string' ? perSleutel.get(o.key) : null) || [];
      const symbool = kandidaten.find((s) => !bezet.has(s) && (s.page ?? 1) === (wand.page ?? 1));
      if (!symbool) continue;
      bezet.add(symbool);
      symbool.params = { ...symbool.params, hostWallId: wand.id };
      blijft.push({ ...o, id: symbool.id });
      gekoppeld++;
    }
    if (blijft.length) wand.openingen = blijft;
    else delete wand.openingen;
  }
  return gekoppeld;
}
