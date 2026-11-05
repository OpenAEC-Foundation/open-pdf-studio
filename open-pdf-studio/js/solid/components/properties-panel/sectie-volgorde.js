// Volgorde van de secties in het eigenschappenpaneel (#967): rekenwerk
// zonder Solid of DOM, zodat het in Node testbaar is. De opslag en de
// sleepbediening staan in stores/sectieVolgordeStore.js en
// CollapsibleSection.jsx.
//
// De opgeslagen volgorde is een lijst sectiesleutels. Bij het samenvoegen met
// de standaardvolgorde:
//  - onbekende sleutels (secties die niet meer bestaan) vallen weg;
//  - dubbele sleutels tellen een keer;
//  - secties die de gebruiker nog niet geplaatst heeft (bv. nieuw in een
//    latere versie) komen op hun standaardplek: direct na de dichtstbijzijnde
//    voorganger uit de standaardvolgorde, of vooraan als er geen is.

/** Volledige volgorde: de opgeslagen lijst aangevuld met de standaard. */
export function voegVolgordeSamen(standaard, opgeslagen) {
  const std = Array.isArray(standaard) ? standaard : [];
  const bekend = new Set(std);
  const uit = [];
  const gezien = new Set();
  for (const k of Array.isArray(opgeslagen) ? opgeslagen : []) {
    if (bekend.has(k) && !gezien.has(k)) { uit.push(k); gezien.add(k); }
  }
  for (let i = 0; i < std.length; i++) {
    const k = std[i];
    if (gezien.has(k)) continue;
    // Plaats na de dichtstbijzijnde standaardvoorganger die al in de lijst staat.
    let pos = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = uit.indexOf(std[j]);
      if (p !== -1) { pos = p + 1; break; }
    }
    uit.splice(pos, 0, k);
    gezien.add(k);
  }
  return uit;
}

/**
 * `sleutel` voor (of met `erna` na) `doel` zetten. Ongewijzigde kopie als een
 * van beide ontbreekt of ze gelijk zijn.
 */
export function verplaatsNaast(volgorde, sleutel, doel, erna = false) {
  const lijst = [...(volgorde || [])];
  if (sleutel === doel || !lijst.includes(sleutel) || !lijst.includes(doel)) return lijst;
  lijst.splice(lijst.indexOf(sleutel), 1);
  const d = lijst.indexOf(doel);
  lijst.splice(erna ? d + 1 : d, 0, sleutel);
  return lijst;
}

/**
 * Een sectie een plek omhoog (-1) of omlaag (+1) tussen de secties die nu
 * zichtbaar zijn: ze springt over de verborgen secties heen, zodat elke
 * toetsdruk iets zichtbaars doet.
 */
export function verschuifZichtbaar(volgorde, sleutel, richting, zichtbaar) {
  const lijst = [...(volgorde || [])];
  const zicht = zichtbaar ? new Set(zichtbaar) : new Set(lijst);
  const zichtLijst = lijst.filter(k => zicht.has(k) || k === sleutel);
  const i = zichtLijst.indexOf(sleutel);
  if (i === -1) return lijst;
  const buur = zichtLijst[i + (richting < 0 ? -1 : 1)];
  if (buur === undefined) return lijst;
  return verplaatsNaast(lijst, sleutel, buur, richting > 0);
}

/** Is de volgorde (na samenvoegen) gelijk aan de standaard? */
export function isStandaardVolgorde(volgorde, standaard) {
  const a = voegVolgordeSamen(standaard, volgorde);
  return a.length === standaard.length && a.every((k, i) => k === standaard[i]);
}
