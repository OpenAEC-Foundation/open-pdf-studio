// Pointer-events-doorval van het selectiegereedschap.
//
// In select-modus ligt het annotatiecanvas (z 6) boven de tekstlaag (z 5).
// Bij elke muisbeweging bepaalt tools/manager.js wie de volgende pointerdown
// krijgt:
//   - boven een annotatie (of greep): het canvas → klikken/slepen/grepen;
//   - boven PDF-tekst: de tekstlaag → native tekstselectie;
//   - boven leeg paginavlak: het canvas → selectierechthoek.
//
// Voorheen viel ook het lege paginavlak door naar de tekstlaag. Een
// selectierechthoek kwam dan alleen nog bij het selectiegereedschap aan
// wanneer de "armed marquee" (knop Selecteren / Escape) het canvas eenmalig
// forceerde; de tweede rechthoek belandde in de (lege) tekstlaag en
// selecteerde niets.

/**
 * @param {{overAnnotatie: boolean, overTekst: boolean, knopIngedrukt: boolean}} p
 * @returns {null | {canvas: 'auto'|'none', tekstlaag: 'auto'|'none', spanCursor: ''|'text'}}
 *   null = niets omschakelen (lopende sleep, bv. een tekstselectie).
 */
export function doorvalVoorSelectie({ overAnnotatie, overTekst, knopIngedrukt }) {
  if (knopIngedrukt) return null;
  if (overAnnotatie) return { canvas: 'auto', tekstlaag: 'none', spanCursor: '' };
  if (overTekst) return { canvas: 'none', tekstlaag: 'auto', spanCursor: 'text' };
  // Leeg vlak: het canvas vangt de pointerdown (selectierechthoek). De
  // tekstlaag blijft raakbaar zodat staatBovenTekst() de tekst onder het
  // canvas via elementsFromPoint blijft zien.
  return { canvas: 'auto', tekstlaag: 'auto', spanCursor: 'text' };
}

/** Is dit element tekstinhoud van een tekstlaag (niet de laag zelf)? */
export function isTekstElement(el) {
  const laag = el?.closest?.('.textLayer');
  return !!laag && laag !== el && !el.classList?.contains?.('endOfContent');
}

/** Ligt er tekst in de elementstapel onder de aanwijzer (document.elementsFromPoint)? */
export function staatBovenTekst(elementen) {
  return Array.isArray(elementen) && elementen.some(isTekstElement);
}

// ── Klik naast een geselecteerd element ─────────────────────────────────────
//
// Het selectiegereedschap heft de selectie zelf op zodra een pointerdown op
// het annotatiecanvas in leeg vlak landt (start van de selectierechthoek).
// Een pointerdown die NIET bij het canvas aankomt, bereikt het gereedschap
// nooit: boven PDF-tekst krijgt de tekstlaag hem (zie doorvalVoorSelectie),
// en rond of tussen de pagina's ligt helemaal geen canvas. Die klikken moeten
// de selectie evengoed opheffen; tools/manager.js vraagt dat hier na.

const ACHTERGROND_IDS = ['pdf-container', 'canvas-wrapper', 'canvas-container', 'continuous-container'];
const CANVAS_IDS = ['annotation-canvas', 'pdf-canvas', 'text-highlight-canvas'];
const CANVAS_KLASSEN = ['annotation-canvas', 'pdf-canvas', 'canvas-container-cont'];

/**
 * Waar landt deze pointerdown?
 *   'tekst'         — PDF-tekst of de tekstlaag zelf;
 *   'pagina-inhoud' — link- of formulierlaag van de pagina;
 *   'achtergrond'   — het vlak rond en tussen de pagina's;
 *   'canvas'        — het paginacanvas: het selectiegereedschap beslist zelf
 *                     (annotatie, greep, kader of selectierechthoek);
 *   'anders'        — panelen, ribbon, schuifbalken, editors, pop-ups.
 * @param {Element|null} doel  event.target
 */
export function klikDoelSoort(doel) {
  if (!doel || typeof doel.closest !== 'function') return 'anders';
  const heeftKlasse = (k) => !!doel.classList?.contains?.(k);
  if (doel.closest('.textLayer')) return 'tekst';
  if (doel.closest('.linkLayer') || doel.closest('.formLayer')) return 'pagina-inhoud';
  if (CANVAS_IDS.includes(doel.id) || CANVAS_KLASSEN.some(heeftKlasse)) return 'canvas';
  if (ACHTERGROND_IDS.includes(doel.id) || heeftKlasse('page-wrapper')) return 'achtergrond';
  return 'anders';
}

/**
 * Heft een pointerdown buiten het annotatiecanvas de annotatieselectie op?
 * Shift/Ctrl houden de selectie vast, zoals bij de selectierechthoek
 * (toevoegen/omschakelen); rechts en midden zijn contextmenu en pannen.
 * @param {{gereedschap: string, knop: number, shift: boolean, ctrl: boolean,
 *   soort: string, heeftSelectie: boolean, opSchuifbalk: boolean,
 *   modusBezig: boolean}} p
 *   modusBezig: een modus die de klik zelf opeist en de selectie nodig heeft
 *   (verplaatsen/roteren met G en R, bijsnijden van een afbeelding).
 */
export function heftKlikSelectieOp({
  gereedschap, knop, shift, ctrl, soort, heeftSelectie, opSchuifbalk, modusBezig,
}) {
  if (gereedschap !== 'select' || knop !== 0) return false;
  if (!heeftSelectie || shift || ctrl) return false;
  if (opSchuifbalk || modusBezig) return false;
  return soort === 'tekst' || soort === 'pagina-inhoud' || soort === 'achtergrond';
}
