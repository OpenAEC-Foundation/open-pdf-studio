// De zichtbare rand van een link uit het bestand (#1146), als CSS voor het
// klikvlak in de linklaag (link-layer.js). De paginarender tekent geen
// annotaties; een link die een ander programma met een rand opsloeg (/C met
// /Border of /BS) was daardoor na openen onzichtbaar.
//
// PDF.js leest de rand al uit: `borderStyle` (dikte in punten en de stijl uit
// /BS /S of het streeppatroon van /Border) en `color` (/C als 0..255, null bij
// een lege /C: doorzichtig). Zonder /Border en /BS geeft PDF.js dikte 0: geen
// rand, zoals de gangbare lezers doen.
//
// Geen DOM en geen app-imports: los te testen.

// AnnotationBorderStyleType van PDF.js.
const GESTREEPT = 2;
const ONDERSTREEPT = 5;

function kleurVan(ann) {
  const c = ann?.color;
  if (!c || c.length < 3) return null;
  const [r, g, b] = Array.from(c).slice(0, 3).map((v) => Math.round(Number(v)));
  if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return null;
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * De stijl voor het linkelement, of null als de link geen zichtbare rand
 * heeft (dikte 0 of geen kleur).
 * @param {object} ann     linkannotatie zoals PDF.js hem levert
 * @param {number} schaal  CSS-pixels per punt waarin de laag is opgebouwd
 * @returns {Record<string, string>|null}
 */
export function linkRandStijl(ann, schaal = 1) {
  const stijl = ann?.borderStyle;
  const dikte = Number(stijl?.width);
  if (!(dikte > 0)) return null;
  const kleur = kleurVan(ann);
  if (!kleur) return null;
  const px = Math.max(0.5, dikte * (Number(schaal) > 0 ? Number(schaal) : 1));
  const lijn = `${Math.round(px * 100) / 100}px ${stijl.style === GESTREEPT ? 'dashed' : 'solid'} ${kleur}`;
  // De rand valt binnen /Rect, zoals in het bestand.
  if (stijl.style === ONDERSTREEPT) return { boxSizing: 'border-box', borderBottom: lijn };
  return { boxSizing: 'border-box', border: lijn };
}
