// Lange tekst afbreken op een breedte, zodat "Tekst toevoegen" binnen de
// pagina blijft. Breekt op spaties; een woord dat zelf te breed is wordt op
// tekens afgebroken. Bestaande regeleinden blijven staan.

/**
 * @param {string} tekst
 * @param {number} maxBreedte  beschikbare breedte (zelfde eenheid als meet())
 * @param {(s: string) => number} meet  breedte van een tekenreeks
 * @returns {string} dezelfde tekst met regeleinden op de breekpunten
 */
export function wrapTekst(tekst, maxBreedte, meet) {
  const bron = String(tekst ?? '');
  if (!(maxBreedte > 0) || typeof meet !== 'function') return bron;
  return bron.split('\n').map((alinea) => wrapAlinea(alinea, maxBreedte, meet)).join('\n');
}

function wrapAlinea(alinea, maxBreedte, meet) {
  if (alinea === '' || meet(alinea) <= maxBreedte) return alinea;
  const regels = [];
  let regel = '';
  for (const woord of alinea.split(' ')) {
    const kandidaat = regel === '' ? woord : `${regel} ${woord}`;
    if (meet(kandidaat) <= maxBreedte) {
      regel = kandidaat;
      continue;
    }
    if (regel !== '') regels.push(regel);
    regel = '';
    // Een los woord dat niet past: op tekens afbreken.
    let rest = woord;
    while (rest !== '' && meet(rest) > maxBreedte) {
      let n = 1;
      while (n < rest.length && meet(rest.slice(0, n + 1)) <= maxBreedte) n++;
      regels.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    regel = rest;
  }
  if (regel !== '') regels.push(regel);
  return regels.join('\n');
}
