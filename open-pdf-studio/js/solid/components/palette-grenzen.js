// Bovengrens voor zwevende paletten (#1027).
//
// De titelbalk ligt boven de paletten (z-index 1001 tegen 950) en is een
// sleepgebied van het venster. Een palet dat tot y = 0 gesleept (of op een
// opgeslagen positie hersteld) wordt, verdwijnt met zijn eigen kop onder de
// titelbalk: het kan dan niet meer verplaatst of gesloten worden. Elke
// zwevende positie blijft daarom onder de titelbalk en binnen het venster.

/** De kleinste y voor de bovenkant van een zwevend palet: onder de titelbalk. */
export function paletBovengrens() {
  const titel = typeof document !== 'undefined' ? document.querySelector('.title-bar') : null;
  return titel ? Math.ceil(titel.getBoundingClientRect().bottom) : 0;
}

/** Een zwevende positie {x, y} binnen het venster en onder de titelbalk. */
export function klemPaletPositie(pos, breedte, hoogte) {
  const minY = paletBovengrens();
  const x = Math.max(0, Math.min(pos.x, window.innerWidth - breedte));
  const y = Math.max(minY, Math.min(pos.y, window.innerHeight - hoogte));
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : minY };
}
