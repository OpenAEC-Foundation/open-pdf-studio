// Maat van de paginaminiaturen (#579). De miniaturen vullen de paneelbreedte
// en lopen bij een breed paneel over in kolommen (CSS-grid in layout.css:
// repeat(auto-fill, minmax(64px, 1fr)) met 4 px tussenruimte). Ze worden
// gerenderd op de getoonde breedte maal devicePixelRatio, zodat ze ook groter
// en op een hoge-dpi-scherm scherp blijven. Pure functies, los te testen.

export const MIN_KOLOM = 64;      // px, gelijk aan minmax() in layout.css
export const KOLOM_GAP = 4;        // px, gelijk aan gap in layout.css
export const ITEM_RAND = 12;       // padding 2x4 + rand 2x2 van .thumbnail-item
export const MIN_RENDER = 280;     // ondergrens renderbreedte (apparaatpixels)
export const MAX_RENDER = 600;     // bovengrens: geheugen bij honderden bladen
const STAP = 80;                   // renderbreedte in stappen: niet bij elke pixel opnieuw

// Breedte van één kolom bij `beschikbaar` px binnenruimte van de lijst.
export function kolomBreedte(beschikbaar, min = MIN_KOLOM, gap = KOLOM_GAP) {
  if (!(beschikbaar > 0)) return 0;
  const n = aantalKolommen(beschikbaar, min, gap);
  return (beschikbaar - gap * (n - 1)) / n;
}

export function aantalKolommen(beschikbaar, min = MIN_KOLOM, gap = KOLOM_GAP) {
  if (!(beschikbaar > 0)) return 1;
  return Math.max(1, Math.floor((beschikbaar + gap) / (min + gap)));
}

// Renderbreedte in apparaatpixels voor een miniatuur die `beeldCss` px breed
// getoond wordt. Naar boven afgerond op stappen, zodat een paneel dat een paar
// pixels breder wordt niet alle miniaturen opnieuw laat maken.
export function renderBreedte(beeldCss, dpr = 1) {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const px = (beeldCss > 0 ? beeldCss : 0) * ratio;
  const gestapt = Math.ceil(px / STAP) * STAP;
  return Math.min(MAX_RENDER, Math.max(MIN_RENDER, gestapt));
}

// Renderbreedte direct uit de binnenbreedte van de miniaturenlijst.
export function renderBreedteVoorLijst(beschikbaar, dpr = 1) {
  return renderBreedte(kolomBreedte(beschikbaar) - ITEM_RAND, dpr);
}

// Tussenmaten om een grote bitmap in halveringsstappen naar (w, h) te
// verkleinen. Eén drawImage van een bitmap van 4000+ px naar ~300 px slaat
// de meeste bronpixels over, waardoor dun CAD-lijnwerk in losse stippen
// uiteenvalt; halveren met hoge kwaliteit middelt ze wel. De laatste maat is
// altijd (w, h).
export function halveerStappen(srcW, srcH, w, h) {
  const stappen = [];
  let cw = srcW;
  let ch = srcH;
  while (cw / 2 > w && ch / 2 > h) {
    cw = Math.max(w, Math.round(cw / 2));
    ch = Math.max(h, Math.round(ch / 2));
    stappen.push([cw, ch]);
  }
  const laatste = stappen[stappen.length - 1];
  if (!laatste || laatste[0] !== w || laatste[1] !== h) stappen.push([w, h]);
  return stappen;
}

// Grootste breedte van het linkerpaneel: 60% van het venster (nooit minder
// dan de oude grens van 500 px), zodat de miniaturen in kolommen passen.
export function maxPaneelBreedte(vensterBreedte) {
  const v = vensterBreedte > 0 ? vensterBreedte : 0;
  return Math.max(500, Math.round(v * 0.6));
}

// Waar een gesleepte miniatuur neerkomt: bij meerdere kolommen links/rechts
// van het doel (de buren staan naast elkaar), anders erboven/eronder.
export function dropPositie(rect, x, y, meerdereKolommen) {
  if (meerdereKolommen) return x < rect.left + rect.width / 2 ? 'before' : 'after';
  return y < rect.top + rect.height / 2 ? 'before' : 'after';
}
