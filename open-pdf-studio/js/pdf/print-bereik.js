// Het paginabereik van de printdialoog (#606).
//
// Exporteren, verwijderen en uitpakken lezen een bereik als verzameling
// (parsePageRange in exporter.js: gesorteerd, elke pagina één keer). Bij
// afdrukken betekent "1,1,1" drie afdrukken van pagina 1 en "3,1,2" die
// volgorde; dat liet die verzameling stil weg, in het voorbeeld én in de
// afdruk. Deze regel houdt het bereik zoals het getypt is. Geen DOM.

/**
 * De pagina's (vanaf 1) van een getypt printbereik, in de getypte volgorde en
 * met herhalingen. "a-b" loopt van a naar b, ook aflopend ("5-3" = 5, 4, 3),
 * begrensd op het document zoals bij exporteren. Een onleesbaar deel of een
 * losse pagina buiten het document maakt het hele bereik leeg, zoals
 * parsePageRange dat doet.
 * @param {string} tekst
 * @param {number} totaal  aantal pagina's van het document
 * @returns {number[]}
 */
export function printPaginaBereik(tekst, totaal) {
  if (typeof tekst !== 'string' || !Number.isSafeInteger(totaal) || totaal < 1) return [];
  const paginas = [];
  for (const deel of tekst.split(',')) {
    const t = deel.trim();
    const bereik = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (bereik) {
      const van = Number(bereik[1]);
      const tot = Number(bereik[2]);
      if (!Number.isSafeInteger(van) || !Number.isSafeInteger(tot)) return [];
      const stap = tot >= van ? 1 : -1;
      const lo = Math.max(1, Math.min(van, tot));
      const hi = Math.min(totaal, Math.max(van, tot));
      if (lo > hi) return [];
      const begin = stap === 1 ? lo : hi;
      const eind = stap === 1 ? hi : lo;
      for (let i = begin; stap === 1 ? i <= eind : i >= eind; i += stap) paginas.push(i);
      continue;
    }
    if (!/^\d+$/.test(t)) return [];
    const nr = Number(t);
    if (!Number.isSafeInteger(nr) || nr < 1 || nr > totaal) return [];
    paginas.push(nr);
  }
  return paginas;
}
