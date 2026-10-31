/**
 * Woordafstanden in de selectiemarkering (#506).
 *
 * Veel brieven en formulieren zetten elk woord als eigen tekstrun neer. PDF.js
 * maakt dan per woord een span en voor de spatie ertussen een aparte span met
 * alleen " ". tagWhitespaceSpans (text-layer.js) geeft zulke witruimte-spans
 * geen selectievlak, tegen de spook-selectie in marges en kolomgaten. Tussen
 * twee woorden op dezelfde regel bleef daardoor alleen het regeleinde-vlak
 * over dat de browser na elke span tekent: dat is één spatiebreedte in het
 * vervangende lettertype, afgerond op de lettergrootte van de laag, en dekt de
 * echte woordafstand niet altijd. In de enkele-paginaweergave (laag op schaal
 * 1, zoom als transform) bleven zo lichte strepen tussen de woorden staan.
 *
 * Een witruimte-span die precies tussen twee woorden op dezelfde basislijn
 * zit, is gewoon een woordafstand: die krijgt zijn selectievlak terug en wordt
 * (zoals PDF.js met tekst doet) met --scale-x op de breedte uit de PDF
 * gezet, zodat hij de afstand tussen de woorden precies vult. Kantlijnen,
 * inspringingen, regeleindes en kolomgaten blijven zonder vlak.
 */

// Grenzen in letterhoogtes van de spatie.
const MAX_BREEDTE = 1.5; // een paar spaties; een kolomgat is breder
const MAX_NAAD = 0.35; // ruimte tussen spatie en woord
const MAX_BASISLIJN = 0.2; // verschil in basislijn

// Alleen gewone spaties (geen nulbreedte- of opmaaktekens: die tekenen niets).
const SPATIES = /^[   -   　]+$/;

/**
 * Is `spatie` een woordafstand tussen `vorige` en `volgende`?
 * Elk item: { str, transform: [a, b, c, d, e, f], width } in PDF-punten,
 * zoals PDF.js' getTextContent ze geeft.
 * @returns {boolean}
 */
export function isWoordafstand(vorige, spatie, volgende) {
  if (!vorige || !spatie || !volgende) return false;
  if (!SPATIES.test(spatie.str || '')) return false;
  if (!(vorige.str || '').trim() || !(volgende.str || '').trim()) return false;
  const tx = spatie.transform;
  if (!Array.isArray(tx) || tx.length < 6) return false;
  const h = Math.hypot(tx[2], tx[3]);
  const w = Number(spatie.width);
  if (!(h > 0) || !(w > 0) || w > MAX_BREEDTE * h) return false;
  // Alleen horizontale tekst; gedraaide regels houden het oude gedrag.
  for (const item of [vorige, spatie, volgende]) {
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6 || !(t[0] > 0) || Math.abs(t[1]) > 1e-6 * t[0] || Math.abs(t[2]) > 1e-6 * t[0]) return false;
    if (Math.abs(t[5] - tx[5]) > MAX_BASISLIJN * h) return false;
  }
  const vak = (item) => [item.transform[4], item.transform[4] + Math.max(0, Number(item.width) || 0)];
  const [sl, sr] = vak(spatie);
  const [vl, vr] = vak(vorige);
  const [nl, nr] = vak(volgende);
  const naad = MAX_NAAD * h;
  // Het ene woord links van de spatie, het andere rechts (of andersom bij
  // tekst die van rechts naar links in de inhoud staat), beide aansluitend.
  const links = (a, b) => Math.abs(b - a) <= naad;
  return (links(vr, sl) && links(sr, nl)) || (links(nr, sl) && links(sr, vl));
}

function itemVan(span) {
  if (span?.tagName !== 'SPAN' || !span.dataset.pdfTransform) return null;
  try {
    return { str: span.textContent, transform: JSON.parse(span.dataset.pdfTransform), width: Number(span.dataset.pdfWidth) };
  } catch (_) {
    return null;
  }
}

/**
 * Geef woordafstand-spans in een PDF.js-tekstlaag hun selectievlak terug en
 * rek ze op de breedte uit de PDF. Na tagWhitespaceSpans aanroepen; werkt
 * alleen op spans met data-pdf-transform/data-pdf-width (createTextLayer).
 * @param {HTMLElement} textLayerDiv
 * @returns {number} aantal woordafstanden
 */
export function markeerWoordafstanden(textLayerDiv) {
  if (!textLayerDiv) return 0;
  const gevonden = [];
  for (const span of textLayerDiv.querySelectorAll('span[data-ws][data-pdf-transform]')) {
    const spatie = itemVan(span);
    if (isWoordafstand(itemVan(span.previousElementSibling), spatie, itemVan(span.nextElementSibling))) {
      gevonden.push({ span, spatie });
    }
  }
  // Eerst alles meten, dan schrijven (één layout).
  const metingen = gevonden.map(({ span, spatie }) => {
    const breedte = span.offsetWidth;
    const fontPx = parseFloat(getComputedStyle(span).fontSize);
    return { span, spatie, breedte, fontPx };
  });
  for (const { span, spatie, breedte, fontPx } of metingen) {
    delete span.dataset.ws;
    span.dataset.woordafstand = '1';
    const h = Math.hypot(spatie.transform[2], spatie.transform[3]);
    // Doelbreedte in laagpixels = PDF-breedte × (fontPx / letterhoogte).
    if (breedte > 0 && fontPx > 0) {
      span.style.setProperty('--scale-x', String((spatie.width * fontPx) / (h * breedte)));
    }
  }
  return metingen.length;
}
