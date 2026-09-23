// Maatvoering die vastzit aan wat ze meet.
//
// Een losse maatlijn hangt nergens aan vast: verschuif de gevel en de maat
// blijft staan waar hij stond. Hier krijgt elk eindpunt van een maatlijn een
// ANKER — een verwijzing naar een object plus welk punt daarvan bedoeld is.
// Bij een herberekening worden de ankers opnieuw uitgelezen en verspringt de
// maat mee.
//
// Ontwerpregel uit #450: het anker is een HINT, nooit de enige bron van
// waarheid. Valt het object weg, dan houdt de maatlijn zijn laatste
// geometrie en meldt de herberekening dat het anker los is. Zo gaat er nooit
// een maat verloren doordat een wand verdwijnt.
//
// Anker:
//   { annotationId, punt: 'start' | 'end' | 'sparingVan' | 'sparingTot' | 'sparingHart' }
// Een maatlijn ligt `offsetMm` naast de gemeten lijn, aan de kant die
// `zijde` (+1 / -1) aanwijst. Alles in paginapunten tenzij anders vermeld.

const EPS = 1e-9;

/** Ankerpunten die deze module kent. */
export const ANKER_PUNTEN = Object.freeze([
  'start', 'end', 'sparingVan', 'sparingTot', 'sparingHart',
]);

function eenheid(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  return { x: dx / len, y: dy / len, len };
}

/**
 * Dagkanten van een gehost kozijn uit zijn eigen omhullende vak: het vak is
 * de dagmaat breed en de wand diep, om het hart gedraaid over `rotation`
 * (graden). Zo hoeft de maatlijn niets van de wand te weten om de dag terug
 * te vinden — ook niet na het opslaan en opnieuw openen.
 */
export function sparingKanten(ann) {
  if (!ann || !Number.isFinite(ann.x) || !Number.isFinite(ann.width)) return null;
  const hoek = ((Number(ann.rotation) || 0) * Math.PI) / 180;
  const u = { x: Math.cos(hoek), y: Math.sin(hoek) };
  const halve = (Number(ann.width) || 0) / 2;
  const hart = { x: ann.x + halve, y: ann.y + (Number(ann.height) || 0) / 2 };
  return {
    hart,
    van: { x: hart.x - u.x * halve, y: hart.y - u.y * halve },
    tot: { x: hart.x + u.x * halve, y: hart.y + u.y * halve },
  };
}

/**
 * Los een anker op tegen de huidige toestand.
 * @param {object} anker
 * @param {Map|object} index  id → annotatie (Map of gewoon object)
 * @param {object} extra      optioneel `{ sparingen: [{ id, van, tot, hart }] }`
 *   — terugval voor een sparing die nog geen annotatie is (plannen vooraf).
 * @returns {null|{x:number,y:number}}
 */
export function ankerPunt(anker, index, extra = {}) {
  if (!anker || !anker.annotationId) return null;
  const haal = (id) => (index instanceof Map ? index.get(id) : index?.[id]);
  const ann = haal(anker.annotationId);
  switch (anker.punt) {
    case 'start':
      return ann && Number.isFinite(ann.startX) ? { x: ann.startX, y: ann.startY } : null;
    case 'end':
      return ann && Number.isFinite(ann.endX) ? { x: ann.endX, y: ann.endY } : null;
    case 'sparingVan':
    case 'sparingTot':
    case 'sparingHart': {
      const veld = anker.punt === 'sparingVan' ? 'van' : anker.punt === 'sparingTot' ? 'tot' : 'hart';
      const kanten = sparingKanten(ann);
      if (kanten) return kanten[veld];
      const sp = (extra.sparingen || []).find((s) => s.id === anker.annotationId);
      return sp && sp[veld] ? { x: sp[veld].x, y: sp[veld].y } : null;
    }
    default:
      return null;
  }
}

/**
 * Geometrie van een maatlijn tussen twee punten, `offsetMm` opzij gelegd.
 * `zijde` +1 legt hem aan de linkerkant van de richting p1→p2 in
 * paginacoördinaten (y omlaag), -1 aan de andere kant.
 * @returns {null|{startX,startY,endX,endY,lengteMm}}
 */
export function maatGeometrie(p1, p2, offsetMm = 0, pxPerMm = 1, zijde = 1) {
  if (!p1 || !p2) return null;
  const u = eenheid(p2.x - p1.x, p2.y - p1.y);
  if (!u) return null;
  const k = pxPerMm > 0 ? pxPerMm : 1;
  const d = offsetMm * k * (zijde < 0 ? -1 : 1);
  const n = { x: -u.y, y: u.x };
  return {
    startX: p1.x + n.x * d, startY: p1.y + n.y * d,
    endX: p2.x + n.x * d, endY: p2.y + n.y * d,
    lengteMm: u.len / k,
  };
}

/**
 * Maatketting: opeenvolgende tussenmaten op één lijn, plus — als er meer dan
 * één tussenmaat is — een totaalmaat een regel verder naar buiten, zoals op
 * elke bouwtekening.
 *
 * @param {Array<{x,y,anker?}>} punten  minimaal twee, op volgorde
 * @returns {{ maten: Array<{startX,startY,endX,endY,lengteMm,rol,ankerStart,ankerEind}> }}
 */
export function maatketting(punten, opties = {}) {
  const pxPerMm = opties.pxPerMm > 0 ? opties.pxPerMm : 1;
  const offsetMm = opties.offsetMm ?? 500;
  const totaalOffsetMm = opties.totaalOffsetMm ?? offsetMm + 350;
  const zijde = opties.zijde < 0 ? -1 : 1;
  const punten_ = (punten || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const maten = [];
  for (let i = 0; i + 1 < punten_.length; i++) {
    const g = maatGeometrie(punten_[i], punten_[i + 1], offsetMm, pxPerMm, zijde);
    if (!g || g.lengteMm <= 0) continue;
    maten.push({
      ...g, rol: 'tussenmaat',
      ankerStart: punten_[i].anker || null,
      ankerEind: punten_[i + 1].anker || null,
    });
  }
  if (maten.length > 1) {
    const g = maatGeometrie(punten_[0], punten_[punten_.length - 1], totaalOffsetMm, pxPerMm, zijde);
    if (g) {
      maten.push({
        ...g, rol: 'totaalmaat',
        ankerStart: punten_[0].anker || null,
        ankerEind: punten_[punten_.length - 1].anker || null,
      });
    }
  }
  return { maten };
}

/**
 * De kettingpunten van een gevel volgen uit de wandstukken zelf: elk stuk
 * levert zijn begin- en eindpunt, en het gat tussen het einde van het ene en
 * het begin van het volgende stuk IS de sparing. Zo krijg je precies de
 * maatketting van een bouwtekening — penant, dagmaat, penant — waarvan elk
 * punt aan een wand hangt. Verschuift die wand, dan verspringt de maat mee.
 *
 * @param {Array} wanden `{ id, startX, startY, endX, endY }`, op volgorde
 *   langs de loop.
 */
export function kettingUitWandstukken(wanden) {
  const punten = [];
  for (const w of wanden || []) {
    punten.push({ x: w.startX, y: w.startY, anker: { annotationId: w.id, punt: 'start' } });
    punten.push({ x: w.endX, y: w.endY, anker: { annotationId: w.id, punt: 'end' } });
  }
  return punten;
}

/**
 * Herbereken één verankerde maatlijn tegen de huidige toestand.
 * @returns {{ status: 'ongewijzigd'|'bijgewerkt'|'losgeraakt', patch?: object }}
 *   `patch` bevat alleen de gewijzigde geometrie; `losgeraakt` betekent dat
 *   (een van) de ankers niet meer bestaat — de maatlijn blijft zoals hij is.
 */
export function herberekenMaat(maat, index, opties = {}) {
  const pxPerMm = opties.pxPerMm > 0 ? opties.pxPerMm : 1;
  const extra = { sparingen: opties.sparingen || [] };
  const a = ankerPunt(maat?.ankerStart, index, extra);
  const b = ankerPunt(maat?.ankerEind, index, extra);
  if (!a || !b) return { status: 'losgeraakt' };
  const g = maatGeometrie(a, b, maat.offsetMm ?? 0, pxPerMm, maat.zijde ?? 1);
  if (!g) return { status: 'losgeraakt' };
  const zelfde = ['startX', 'startY', 'endX', 'endY']
    .every((k) => Math.abs((maat[k] ?? NaN) - g[k]) < 1e-6);
  if (zelfde) return { status: 'ongewijzigd' };
  return {
    status: 'bijgewerkt',
    patch: { startX: g.startX, startY: g.startY, endX: g.endX, endY: g.endY },
    lengteMm: g.lengteMm,
  };
}

/** Herbereken een hele set verankerde maatlijnen in één keer. */
export function herberekenMaten(maten, index, opties = {}) {
  const bijgewerkt = [];
  const losgeraakt = [];
  let ongewijzigd = 0;
  for (const m of maten || []) {
    const r = herberekenMaat(m, index, opties);
    if (r.status === 'bijgewerkt') bijgewerkt.push({ id: m.id, patch: r.patch, lengteMm: r.lengteMm });
    else if (r.status === 'losgeraakt') losgeraakt.push({ id: m.id });
    else ongewijzigd++;
  }
  return { bijgewerkt, losgeraakt, ongewijzigd };
}
