// Font utilities - system font enumeration and dropdown population
import { systemFontList, setSystemFontList } from '../solid/stores/fontStore.js';

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

// Cached system fonts (populated once)
let systemFonts = null;

// Get system fonts using Local Font Access API, with fallback
async function getSystemFonts() {
  if (systemFonts) return systemFonts;

  try {
    if ('queryLocalFonts' in window) {
      const fonts = await window.queryLocalFonts();
      const familySet = new Set();
      for (const font of fonts) {
        familySet.add(font.family);
      }
      // Sort alphabetically
      systemFonts = [...familySet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      if (systemFonts.length > 0) {
        return systemFonts;
      }
    }
  } catch (err) {
    console.warn('[Fonts] Local Font Access API not available:', err.message);
  }

  // Fallback: filter to fonts that actually render (canvas detection)
  systemFonts = detectAvailableFonts(FALLBACK_FONTS);
  return systemFonts;
}

// Detect which fonts from the list are actually available on the system
function detectAvailableFonts(fontList) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const testString = 'mmmmmmmmmmlli';
  const testSize = '72px';
  const baselineFont = 'monospace';

  // Measure baseline
  ctx.font = `${testSize} ${baselineFont}`;
  const baselineWidth = ctx.measureText(testString).width;

  const available = [];
  for (const font of fontList) {
    ctx.font = `${testSize} '${font}', ${baselineFont}`;
    const width = ctx.measureText(testString).width;
    if (width !== baselineWidth) {
      available.push(font);
    }
  }
  return available;
}

// Ensure a font exists in the store; if not, add it in sorted order
export function ensureFontInStore(fontFamily) {
  if (!fontFamily) return;
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
