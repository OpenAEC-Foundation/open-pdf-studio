// Kiezen welke pagina's van een bron-PDF erin komen (#963): Invoegen uit
// bestand en Pagina's vervangen vragen dat als het gekozen bestand meer dan
// één pagina heeft. Een PDF van één pagina hoeft geen vraag.

/**
 * Vraag welke pagina's van `bytes` gebruikt worden.
 * @param {Uint8Array} bytes de bron-PDF (voor de miniaturen in het venster)
 * @param {string} naam bestandsnaam, getoond in het venster
 * @param {number} aantal paginatal van de bron
 * @param {'insert'|'replace'} doel waarvoor (tekst van de knop)
 * @returns {Promise<number[]|null>} 0-based pagina-indexen in bronvolgorde,
 *   of null als de gebruiker annuleerde
 */
export async function kiesBronPaginas(bytes, naam, aantal, doel = 'insert') {
  if (!(aantal > 1)) return aantal === 1 ? [0] : [];
  const { openDialog } = await import('../solid/stores/dialogStore.js');
  return new Promise((resolve) => {
    let klaar = false;
    const einde = (paginas) => {
      if (klaar) return;
      klaar = true;
      resolve(Array.isArray(paginas) && paginas.length ? naarIndexen(paginas, aantal) : null);
    };
    openDialog('choose-pages', { bytes, naam, aantal, doel, onDone: einde });
  });
}

/** 1-based pagina's -> 0-based indexen, gesorteerd, uniek, binnen het bereik. */
export function naarIndexen(paginas, aantal) {
  return [...new Set(paginas)]
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= aantal)
    .sort((a, b) => a - b)
    .map((p) => p - 1);
}

/** "1-3, 5" voor een lijst 1-based pagina's. */
export function bereikTekst(paginas) {
  const lijst = [...new Set(paginas || [])].filter(Number.isInteger).sort((a, b) => a - b);
  const delen = [];
  for (let i = 0; i < lijst.length; i++) {
    const begin = lijst[i];
    while (i + 1 < lijst.length && lijst[i + 1] === lijst[i] + 1) i++;
    delen.push(begin === lijst[i] ? String(begin) : `${begin}-${lijst[i]}`);
  }
  return delen.join(', ');
}

/**
 * Leest een paginabereik als "1-3, 5" (spaties en een lege laatste komma
 * mogen). Een omgekeerd bereik ("5-3") telt als 3-5; een bereik dat voorbij
 * het einde loopt wordt afgekapt.
 * @returns {number[]|null} gesorteerde 1-based pagina's; null als de tekst
 *   ongeldig is of buiten de bron valt; [] als hij leeg is
 */
export function leesBereik(tekst, aantal) {
  const t = String(tekst ?? '').trim();
  if (!t) return [];
  const paginas = new Set();
  for (const deel of t.split(',')) {
    const d = deel.trim();
    if (!d) continue;
    const reeks = /^(\d+)\s*-\s*(\d+)$/.exec(d);
    if (reeks) {
      let a = Number(reeks[1]);
      let b = Number(reeks[2]);
      if (a > b) [a, b] = [b, a];
      a = Math.max(1, a);
      b = Math.min(aantal, b);
      if (a > b) return null;
      for (let p = a; p <= b; p++) paginas.add(p);
    } else if (/^\d+$/.test(d)) {
      const p = Number(d);
      if (p < 1 || p > aantal) return null;
      paginas.add(p);
    } else {
      return null;
    }
  }
  return [...paginas].sort((x, y) => x - y);
}

/**
 * Oude paginanummers -> nieuwe na het invoegen van `aantalIn` pagina's op
 * 0-based index `invoegIndex`.
 */
export function mappingNaInvoegen(oudAantal, invoegIndex, aantalIn) {
  const m = {};
  for (let p = 1; p <= oudAantal; p++) m[p] = p <= invoegIndex ? p : p + aantalIn;
  return m;
}

/**
 * Oude paginanummers -> nieuwe na het vervangen van pagina `pagina` door
 * `aantalIn` pagina's; de vervangen pagina wordt null (haar markeringen gaan weg).
 */
export function mappingNaVervangen(oudAantal, pagina, aantalIn) {
  const m = {};
  for (let p = 1; p <= oudAantal; p++) m[p] = p < pagina ? p : p === pagina ? null : p + aantalIn - 1;
  return m;
}
