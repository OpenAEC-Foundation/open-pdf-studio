// Bladeren met PageUp / PageDown in de hoofdweergave (#751, #713).
//
//   PageDown → volgende pagina (facing: volgende spread)
//   PageUp   → vorige pagina   (facing: vorige spread)
//
// Geen omloop: op de eerste/laatste pagina gebeurt niets. Alleen de kale
// toets; Ctrl+PageUp/PageDown is de tabwissel (#539) en Shift/Alt erbij
// blijven vrij. De navigatie zelf is goToPage, hetzelfde pad als de knoppen
// Vorige/Volgende in het lint: de zoom blijft dus staan.
//
// Ingedrukt houden mag geen achterstand opbouwen: maakPaginaBladeraar laat
// toetsherhalingen vallen zolang een vorige sprong nog loopt (render of
// vloeiende scroll), zodat elke getoonde stap één pagina is.
//
// Dit bestand importeert niets uit de app (geen DOM, geen state), zodat de
// richting, het doel en de rem in node te testen zijn.

/**
 * Welke kant de toets op bladert: 1 = volgende, -1 = vorige, 0 = geen
 * paginasprong (andere toets, of met Ctrl/Shift/Alt/Meta erbij).
 * @param {any} e  toetsenbordevent
 * @returns {-1|0|1}
 */
export function paginaSneltoetsRichting(e) {
  if (!e || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return 0;
  if (e.key === 'PageDown') return 1;
  if (e.key === 'PageUp') return -1;
  return 0;
}

/**
 * Hoort de toets bij een besturingselement dat hem zelf gebruikt? Tekstvelden,
 * keuzelijsten en contenteditable-editors houden PageUp/PageDown.
 * @param {any} t  het doel van het toetsenbordevent
 * @returns {boolean}
 */
export function paginaToetsVoorInvoer(t) {
  if (!t) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return true;
  if (t.isContentEditable) return true;
  return typeof t.closest === 'function' && !!t.closest('[contenteditable="true"], select');
}

// Spread-anker zoals renderer.js het bijhoudt: pagina 1 staat alleen, daarna
// paren met de even pagina links (2-3, 4-5, ...).
function spreadAnker(p) {
  if (p <= 1) return 1;
  return p % 2 === 0 ? p : p - 1;
}

/**
 * De pagina waar de sprong heen gaat, of null als er niets te bladeren valt
 * (eerste/laatste pagina of spread, geen richting).
 *
 * In facing-modus is het resultaat het anker van de volgende/vorige spread;
 * goToPage springt daar rechtstreeks heen, één hele spread per toets.
 * @param {{huidig: number, totaal: number, facing?: boolean}} stand
 * @param {number} richting  1 = volgende, -1 = vorige
 * @returns {number|null}
 */
export function paginaSprongDoel({ huidig, totaal, facing = false }, richting) {
  const stap = Math.sign(Number(richting) || 0);
  const aantal = Math.max(0, Math.floor(Number(totaal) || 0));
  if (!stap || aantal < 1) return null;
  const nu = Math.min(aantal, Math.max(1, Math.floor(Number(huidig) || 1)));
  let doel;
  if (facing) {
    const anker = spreadAnker(nu);
    if (stap > 0) doel = anker <= 1 ? 2 : anker + 2;
    else doel = anker <= 1 ? 0 : (anker <= 2 ? 1 : anker - 2);
  } else {
    doel = nu + stap;
  }
  if (doel < 1 || doel > aantal) return null;
  return doel;
}

/**
 * Rem op toetsherhaling. `vraag(richting, herhaling)` voert een sprong direct
 * uit als er niets loopt. Loopt er wel een, dan valt een toetsherhaling (de
 * ingedrukt gehouden toets) weg; een nieuwe, losse aanslag wordt onthouden
 * als hoogstens één wachtende sprong (de laatst gevraagde richting). Zo komen
 * er nooit opgespaarde sprongen achteraan.
 *
 * `blader(richting)` start de sprong en geeft de belofte van goToPage terug;
 * `naBeeld()` wacht tot de sprong in beeld staat (in de doorlopende weergave:
 * tot de vloeiende scroll stilstaat). `maxWachtMs` is een vangnet tegen een
 * hangende render.
 * @param {{
 *   blader: (richting: number) => any,
 *   naBeeld: () => Promise<void>,
 *   wacht: (ms: number) => Promise<void>,
 *   maxWachtMs?: number,
 * }} middelen
 */
export function maakPaginaBladeraar({ blader, naBeeld, wacht, maxWachtMs = 2000 }) {
  let bezig = false;
  let wachtend = 0;

  async function voerUit(richting) {
    let volgende = richting;
    while (volgende) {
      bezig = true;
      try {
        let render;
        try {
          render = blader(volgende);
        } catch (err) {
          console.warn('[pagina-sneltoets] bladeren mislukt:', err);
        }
        if (render && typeof render.then === 'function') {
          await Promise.race([
            Promise.resolve(render).catch(() => {}),
            wacht(maxWachtMs),
          ]);
        }
        await Promise.race([naBeeld(), wacht(maxWachtMs)]);
      } catch (err) {
        console.warn('[pagina-sneltoets] wachten op beeld mislukt:', err);
      } finally {
        bezig = false;
      }
      volgende = wachtend;
      wachtend = 0;
    }
  }

  return {
    /** @returns {boolean} true als de sprong direct is uitgevoerd */
    vraag(richting, herhaling = false) {
      const stap = Math.sign(Number(richting) || 0);
      if (!stap) return false;
      if (bezig) {
        if (!herhaling) wachtend = stap;
        return false;
      }
      voerUit(stap);
      return true;
    },
    get bezig() { return bezig; },
    get wachtend() { return wachtend; },
  };
}
