// Een kader om een afbeelding: kleur en dikte (pt). Dikte 0 = geen kader.
// Het kader ligt BINNEN de afbeelding, zodat de maat van de afbeelding gelijk
// blijft. Puur: canvas, opgeslagen appearance en tests delen deze regels.

export const KADER_STANDAARD_KLEUR = '#000000';

/** De dikte van het kader van een afbeelding, of 0. */
export function kaderDikte(ann) {
  const d = Number(ann?.frameWidth);
  return d > 0 && Number.isFinite(d) ? d : 0;
}

/** De kleur van het kader (hex); zonder geldige kleur zwart. */
export function kaderKleur(ann) {
  const c = ann?.frameColor;
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : KADER_STANDAARD_KLEUR;
}

/** De rechthoek van de kaderlijn (de lijn staat op de rand, dus een halve dikte naar binnen). */
export function kaderRechthoek(breedte, hoogte, dikte) {
  const h = dikte / 2;
  return { x: h, y: h, w: Math.max(0, breedte - dikte), h: Math.max(0, hoogte - dikte) };
}
