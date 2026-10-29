// Eigen draaipunt voor afbeeldingen en stempels (#826).
//
// Standaard draait en schaalt een vak om zijn midden (draaien) of om de
// overliggende greep (schalen). Met een eigen draaipunt draait het vak om dat
// punt en blijft dat punt bij schalen op dezelfde plek op de pagina staan.
// Handig om een onderlegger op twee punten uit te lijnen: punt A vastzetten,
// dan draaien en schalen tot punt B klopt.
//
// Het draaipunt staat op de annotatie als `draaipunt: { u, v }`: de plek in
// het ONGEDRAAIDE vak als fractie van breedte en hoogte (0,0 = linksboven,
// 0.5,0.5 = midden). Zo beweegt het mee met verplaatsen, draaien en schalen,
// en mag het ook buiten het vak liggen. Geen veld = het midden (het oude
// gedrag). Pure functies; x/y is de ongedraaide linkerbovenhoek en `rotation`
// draait om het midden van het vak, zoals overal in de app.

export const DRAAIPUNT_TYPES = Object.freeze(new Set(['image', 'stamp', 'signature']));

const MIDDEN = Object.freeze({ u: 0.5, v: 0.5 });

/** Kan dit soort annotatie een eigen draaipunt hebben? */
export function kanDraaipunt(ann) {
  return !!ann && DRAAIPUNT_TYPES.has(ann.type) && ann.width > 0 && ann.height > 0;
}

/** Heeft de annotatie een eigen draaipunt (niet het midden)? */
export function heeftEigenDraaipunt(ann) {
  const d = ann?.draaipunt;
  return !!d && Number.isFinite(d.u) && Number.isFinite(d.v)
    && (Math.abs(d.u - 0.5) > 1e-9 || Math.abs(d.v - 0.5) > 1e-9);
}

/** Het draaipunt als fractie van het vak (het midden als er geen eigen is). */
export function draaipuntRelatief(ann) {
  return heeftEigenDraaipunt(ann) ? { u: ann.draaipunt.u, v: ann.draaipunt.v } : { ...MIDDEN };
}

function draai(px, py, cx, cy, graden) {
  const r = (graden || 0) * Math.PI / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Het draaipunt in het ongedraaide vak (paginacoördinaten, vóór de draaiing). */
export function draaipuntLokaal(ann) {
  const { u, v } = draaipuntRelatief(ann);
  return { x: ann.x + u * ann.width, y: ann.y + v * ann.height };
}

/** Het draaipunt op de pagina, met de draaiing van het vak. */
export function draaipuntOpPagina(ann) {
  const lokaal = draaipuntLokaal(ann);
  if (!ann.rotation) return lokaal;
  return draai(lokaal.x, lokaal.y, ann.x + ann.width / 2, ann.y + ann.height / 2, ann.rotation);
}

/**
 * Zet het draaipunt op paginapunt (px, py). Geeft het nieuwe `draaipunt`
 * (of undefined als het op het midden valt, dan is er geen eigen draaipunt).
 */
export function draaipuntVoorPunt(ann, px, py) {
  const cx = ann.x + ann.width / 2;
  const cy = ann.y + ann.height / 2;
  const lokaal = ann.rotation ? draai(px, py, cx, cy, -ann.rotation) : { x: px, y: py };
  const u = (lokaal.x - ann.x) / ann.width;
  const v = (lokaal.y - ann.y) / ann.height;
  const opMidden = Math.abs(u - 0.5) < 1e-6 && Math.abs(v - 0.5) < 1e-6;
  return opMidden ? undefined : { u, v };
}

/**
 * Draai een vak om zijn draaipunt. `orig` is de stand bij het begin van het
 * slepen, (startX, startY) waar de draaigreep gepakt werd en (muisX, muisY)
 * waar de muis nu is: de hoek is het verschil tussen die twee, gezien vanuit
 * het draaipunt, zodat het vak niet verspringt bij het pakken. De uitkomst
 * staat met 'snap' binnen 3° van een veelvoud van 45° precies op dat veelvoud,
 * zoals bij gewoon draaien. Geeft { x, y, rotation } voor het vak.
 */
export function draaiOmDraaipunt(orig, startX, startY, muisX, muisY, { snap = true } = {}) {
  const p = draaipuntOpPagina(orig);
  const hoek = (x, y) => Math.atan2(y - p.y, x - p.x) * 180 / Math.PI;
  let delta = hoek(muisX, muisY) - hoek(startX, startY);
  let rotatie = (orig.rotation || 0) + delta;
  rotatie = Math.round(rotatie);
  if (snap) {
    const dichtst = Math.round(rotatie / 45) * 45;
    if (Math.abs(rotatie - dichtst) <= 3) rotatie = dichtst;
  }
  rotatie = ((rotatie % 360) + 360) % 360;
  delta = rotatie - (orig.rotation || 0);
  // Het midden draait om het draaipunt mee; x/y blijft de ongedraaide hoek.
  const cx = orig.x + orig.width / 2;
  const cy = orig.y + orig.height / 2;
  const midden = draai(cx, cy, p.x, p.y, delta);
  return { x: midden.x - orig.width / 2, y: midden.y - orig.height / 2, rotation: rotatie };
}

/**
 * Na het schalen met een greep: verschuif het vak zo dat het draaipunt op
 * dezelfde plek op de pagina blijft als in `orig`. Geeft { x, y }.
 */
export function houdDraaipuntVast(orig, geschaald) {
  const voor = draaipuntOpPagina(orig);
  const na = draaipuntOpPagina({ ...geschaald, draaipunt: orig.draaipunt });
  return { x: geschaald.x + (voor.x - na.x), y: geschaald.y + (voor.y - na.y) };
}
