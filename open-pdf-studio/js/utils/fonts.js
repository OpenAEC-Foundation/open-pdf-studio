// Font utilities - system font enumeration and dropdown population
import { systemFontList, setSystemFontList } from '../bridge.js';

// Comprehensive fallback list (common Windows + macOS + Linux fonts)
const FALLBACK_FONTS = [
  'Agency FB',
  'Algerian',
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Arial Rounded MT Bold',
  'Bahnschrift',
  'Baskerville Old Face',
  'Bauhaus 93',
  'Bell MT',
  'Berlin Sans FB',
  'Bernard MT Condensed',
  'Bodoni MT',
  'Book Antiqua',
  'Bookman Old Style',
  'Bookshelf Symbol 7',
  'Bradley Hand ITC',
  'Britannic Bold',
  'Broadway',
  'Brush Script MT',
  'Calibri',
  'Californian FB',
  'Calisto MT',
  'Cambria',
  'Cambria Math',
  'Candara',
  'Cascadia Code',
  'Cascadia Mono',
  'Castellar',
  'Centaur',
  'Century',
  'Century Gothic',
  'Century Schoolbook',
  'Chiller',
  'Colonna MT',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Cooper Black',
  'Copperplate Gothic Bold',
  'Copperplate Gothic Light',
  'Corbel',
  'Courier New',
  'Curlz MT',
  'Dubai',
  'Ebrima',
  'Elephant',
  'Engravers MT',
  'Eras Bold ITC',
  'Eras Demi ITC',
  'Eras Light ITC',
  'Eras Medium ITC',
  'Felix Titling',
  'Footlight MT Light',
  'Forte',
  'Franklin Gothic Book',
  'Franklin Gothic Demi',
  'Franklin Gothic Heavy',
  'Franklin Gothic Medium',
  'Freestyle Script',
  'French Script MT',
  'Gabriola',
  'Gadugi',
  'Garamond',
  'Georgia',
  'Gigi',
  'Gill Sans MT',
  'Gill Sans Ultra Bold',
  'Gloucester MT Extra Condensed',
  'Goudy Old Style',
  'Goudy Stout',
  'Haettenschweiler',
  'Harlow Solid Italic',
  'Harrington',
  'Helvetica',
  'High Tower Text',
  'HoloLens MDL2 Assets',
  'Impact',
  'Imprint MT Shadow',
  'Informal Roman',
  'Ink Free',
  'Javanese Text',
  'Jokerman',
  'Juice ITC',
  'Kristen ITC',
  'Kunstler Script',
  'Leelawadee UI',
  'Lucida Bright',
  'Lucida Calligraphy',
  'Lucida Console',
  'Lucida Fax',
  'Lucida Handwriting',
  'Lucida Sans',
  'Lucida Sans Typewriter',
  'Lucida Sans Unicode',
  'Magneto',
  'Maiandra GD',
  'Malgun Gothic',
  'Marlett',
  'Matura MT Script Capitals',
  'Microsoft Himalaya',
  'Microsoft JhengHei',
  'Microsoft New Tai Lue',
  'Microsoft PhagsPa',
  'Microsoft Sans Serif',
  'Microsoft Tai Le',
  'Microsoft YaHei',
  'Microsoft Yi Baiti',
  'MingLiU-ExtB',
  'Mistral',
  'Modern No. 20',
  'Mongolian Baiti',
  'Monotype Corsiva',
  'MS Gothic',
  'MS PGothic',
  'MS Reference Sans Serif',
  'MS Reference Specialty',
  'MS UI Gothic',
  'MT Extra',
  'MV Boli',
  'Myanmar Text',
  'Niagara Engraved',
  'Niagara Solid',
  'Nirmala UI',
  'OCR A Extended',
  'Old English Text MT',
  'Onyx',
  'Palace Script MT',
  'Palatino Linotype',
  'Papyrus',
  'Parchment',
  'Perpetua',
  'Perpetua Titling MT',
  'Playbill',
  'Poor Richard',
  'Pristina',
  'Rage Italic',
  'Ravie',
  'Rockwell',
  'Rockwell Condensed',
  'Rockwell Extra Bold',
  'Script MT Bold',
  'Segoe MDL2 Assets',
  'Segoe Print',
  'Segoe Script',
  'Segoe UI',
  'Segoe UI Emoji',
  'Segoe UI Historic',
  'Segoe UI Symbol',
  'Showcard Gothic',
  'SimSun',
  'Sitka Banner',
  'Sitka Display',
  'Sitka Heading',
  'Sitka Small',
  'Sitka Subheading',
  'Sitka Text',
  'Snap ITC',
  'Stencil',
  'Sylfaen',
  'Symbol',
  'Tahoma',
  'Tempus Sans ITC',
  'Times New Roman',
  'Trebuchet MS',
  'Tw Cen MT',
  'Verdana',
  'Viner Hand ITC',
  'Vivaldi',
  'Vladimir Script',
  'Webdings',
  'Wide Latin',
  'Wingdings',
  'Wingdings 2',
  'Wingdings 3',
  'Yu Gothic',
  'Yu Gothic UI'
];

// Gangbare lettertypen op Linux en macOS (#765). De lijst hierboven komt van
// Windows; op andere systemen bleven daarvan vaak alleen Arial, Courier New,
// Helvetica en Times New Roman over. De detectie hieronder laat alleen
// staan wat echt geïnstalleerd is.
const ANDERE_PLATFORMS = [
  // Linux
  'Cantarell', 'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Droid Sans',
  'Fira Sans', 'Liberation Mono', 'Liberation Sans', 'Liberation Serif',
  'Nimbus Mono PS', 'Nimbus Roman', 'Nimbus Sans', 'Noto Sans', 'Noto Sans Mono',
  'Noto Serif', 'Open Sans', 'Roboto', 'Source Sans Pro', 'Ubuntu', 'Ubuntu Mono',
  // macOS
  'American Typewriter', 'Avenir', 'Avenir Next', 'Futura', 'Geneva', 'Gill Sans',
  'Helvetica Neue', 'Menlo', 'Monaco', 'Optima',
];

/** Alle kandidaten, zonder dubbele, alfabetisch. */
export function lettertypeKandidaten() {
  return [...new Set([...FALLBACK_FONTS, ...ANDERE_PLATFORMS])]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// Cached system fonts (populated once)
let systemFonts = null;

// Get system fonts using canvas-based detection, with fallback
async function getSystemFonts() {
  if (systemFonts) return systemFonts;

  // Use canvas-based font detection (avoids browser permission prompt from queryLocalFonts)
  systemFonts = detectAvailableFonts(lettertypeKandidaten()).then(
    (gevonden) => (gevonden.length ? gevonden : lettertypeKandidaten()),
    // Geen canvas of een fout tijdens het meten: dan de hele lijst, niet
    // alleen het lettertype van de selectie (#765).
    () => lettertypeKandidaten(),
  );
  return systemFonts;
}

// Basisletters waartegen gemeten wordt. Een lettertype dat gelijk is aan de
// standaard-monospace van de browser (Courier New of Consolas op Windows)
// meet tegen 'monospace' alleen precies even breed: met maar die ene basis
// viel het juist uit de lijst (#765). Het is er als het tegen minstens een
// basis anders meet.
const BASISLETTERS = ['monospace', 'sans-serif', 'serif'];
const TEST_TEKST = 'mmmmmmmmmmlli';
const TEST_GROOTTE = '72px';

/**
 * Is `font` op dit systeem aanwezig? `meet(cssFont)` geeft de breedte van de
 * testtekst in dat CSS-font; `basis` de breedtes van de basisletters.
 */
export function lettertypeAanwezig(meet, font, basis) {
  const naam = String(font).replace(/'/g, "\\'");
  return BASISLETTERS.some((b) => meet(`${TEST_GROOTTE} '${naam}', ${b}`) !== basis[b]);
}

// Detect which fonts from the list are actually available on the system.
// Probing the full list with measureText in one pass blocks the main thread
// for up to ~1s on slower machines, so probe in batches spread across idle
// slices and yield between them. Met een timeout: een hoofdthread die nooit
// stil is, mag de lijst niet eindeloos leeg laten (dan stond alleen het
// lettertype van de selectie, meestal Arial, in de keuzelijst; #765).
export async function detectAvailableFonts(fontList, {
  maakContext = () => document.createElement('canvas').getContext('2d'),
  idle = (typeof window !== 'undefined' && window.requestIdleCallback)
    ? (cb) => window.requestIdleCallback(cb, { timeout: 200 })
    : (cb) => setTimeout(() => cb({ timeRemaining: () => 8, didTimeout: false }), 16),
} = {}) {
  const ctx = maakContext();
  if (!ctx) throw new Error('canvas 2d context not available');
  const meet = (cssFont) => { ctx.font = cssFont; return ctx.measureText(TEST_TEKST).width; };
  const basis = Object.fromEntries(BASISLETTERS.map((b) => [b, meet(`${TEST_GROOTTE} ${b}`)]));

  const available = [];
  let i = 0;
  while (i < fontList.length) {
    await new Promise((resolve) => idle((deadline) => {
      // Na een timeout is er geen vrije tijd: dan toch een klein stuk.
      const eind = deadline.didTimeout ? Math.min(fontList.length, i + 8) : fontList.length;
      do {
        const font = fontList[i++];
        if (lettertypeAanwezig(meet, font, basis)) available.push(font);
      } while (i < eind && (deadline.didTimeout || deadline.timeRemaining() > 4));
      resolve();
    }));
  }
  return available;
}

// Ensure a font exists in the store; if not, add it in sorted order
export function ensureFontInStore(fontFamily) {
  // 'mixed' is de waarde van een meervoudige selectie, geen lettertype.
  if (!fontFamily || fontFamily === 'mixed') return;
  const fonts = systemFontList();
  if (fonts.includes(fontFamily)) return;
  const newFonts = [...fonts, fontFamily].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  setSystemFontList(newFonts);
}

// Initialize font list into the reactive store
export async function initFontDropdowns() {
  const fonts = await getSystemFonts();
  setSystemFontList(fonts);
}
