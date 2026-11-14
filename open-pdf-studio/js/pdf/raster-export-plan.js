// Rekenwerk van de snelle rasterexport (#701), zonder DOM of Tauri: tegels,
// rotatie, het geheugenbudget en de volgorde-bewaker. raster-export.js doet
// het eigenlijke werk; deze functies zijn los te testen.

/** Ruimte voor één bitmap in het gedeelde geheugen van een PDFium-worker
 *  (64 MB min de kop van 32 bytes, pdfium-worker/src/shm.rs). */
export const WORKER_BITMAP_BYTES = 64 * 1024 * 1024 - 32;

/**
 * Verdeelt een pagina van w×h pixels in zo weinig mogelijk tegels die elk in
 * het workergeheugen passen. Weinig tegels is belangrijk: PDFium loopt per
 * tegel de hele pagina-inhoud door. De worker rondt een tegelmaat naar boven
 * af, daarom telt hier één pixel marge per as.
 * @returns {{ px: number, py: number, pw: number, ph: number }[]}
 *   aaneensluitend, van boven naar onder en links naar rechts, dekt [0,w)×[0,h)
 */
export function tegelRaster(w, h, maxBytes = WORKER_BITMAP_BYTES) {
  w = Math.max(1, Math.floor(w));
  h = Math.max(1, Math.floor(h));
  let kol = 1;
  let rij = 1;
  const past = () => (Math.ceil(w / kol) + 1) * (Math.ceil(h / rij) + 1) * 4 <= maxBytes;
  while (!past()) {
    // De langste tegelzijde eerst halveren: tegels blijven zo vierkant.
    if (Math.ceil(w / kol) >= Math.ceil(h / rij)) kol++;
    else rij++;
  }
  const tw = Math.ceil(w / kol);
  const th = Math.ceil(h / rij);
  const tegels = [];
  for (let py = 0; py < h; py += th) {
    for (let px = 0; px < w; px += tw) {
      tegels.push({ px, py, pw: Math.min(tw, w - px), ph: Math.min(th, h - py) });
    }
  }
  return tegels;
}

/**
 * Canvasmatrix [a, b, c, d, e, f] die een beeld van w0×h0 pixels (de pagina
 * zonder extra gebruikersrotatie) met de klok mee over `graden` draait naar
 * het uitvoercanvas, zoals PDF.js met viewport.rotation doet. De
 * PDFium-worker rendert tegels alleen zonder extra rotatie; deze matrix
 * zet ze op hun plek in de gedraaide pagina.
 */
export function draaiMatrix(graden, w0, h0) {
  switch (((Math.round(Number(graden) || 0) % 360) + 360) % 360) {
    case 90: return [0, 1, -1, 0, h0, 0];
    case 180: return [-1, 0, 0, -1, w0, h0];
    case 270: return [0, -1, 1, 0, 0, w0];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

/**
 * De tegels die een deel van de gedraaide pagina raken. `matrix` is de
 * draaiMatrix van de pagina (ongedraaide tegelpixels naar de gedraaide
 * pagina), `deel` een rechthoek in pixels van die gedraaide pagina
 * ({x, y, breedte, hoogte}); zonder deel alle tegels. Afdrukken rendert
 * alleen wat op het vel komt, dus hoeven de andere tegels niet opgehaald.
 */
export function tegelsVoorDeel(tegels, matrix, deel) {
  if (!deel) return tegels;
  const [a, b, c, d, e, f] = matrix;
  const x1 = deel.x + deel.breedte;
  const y1 = deel.y + deel.hoogte;
  return tegels.filter((t) => {
    const xs = [t.px, t.px + t.pw].flatMap((x) => [t.py, t.py + t.ph].map((y) => a * x + c * y + e));
    const ys = [t.px, t.px + t.pw].flatMap((x) => [t.py, t.py + t.ph].map((y) => b * x + d * y + f));
    return Math.min(...xs) < x1 && Math.max(...xs) > deel.x && Math.min(...ys) < y1 && Math.max(...ys) > deel.y;
  });
}

/**
 * Begrenst hoeveel pagina's tegelijk in bewerking zijn, op aantal én op
 * pixels: een A4 op 300 dpi is 9 Mpx, een A0 140 Mpx. Eén pagina mag altijd,
 * ook als hij alleen al groter is dan het budget.
 * @param {{ maxPaginas: number, maxPixels: number }} grenzen
 */
export function maakPixelPoort({ maxPaginas, maxPixels }) {
  let paginas = 0;
  let pixels = 0;
  const wachtrij = [];
  const magErbij = (px) => paginas === 0 || (paginas < maxPaginas && pixels + px <= maxPixels);
  const verder = () => {
    while (wachtrij.length && magErbij(wachtrij[0].px)) {
      const { px, klaar } = wachtrij.shift();
      paginas++;
      pixels += px;
      klaar();
    }
  };
  return {
    /** Wacht op plaats voor een pagina van `px` pixels; geeft vrijgeven(). */
    async neem(px) {
      await new Promise((klaar) => { wachtrij.push({ px, klaar }); verder(); });
      let vrij = false;
      return () => {
        if (vrij) return;
        vrij = true;
        paginas--;
        pixels -= px;
        verder();
      };
    },
    get bezet() { return { paginas, pixels }; },
  };
}

/**
 * Levert resultaten in volgorde af terwijl ze in willekeurige volgorde
 * binnenkomen: zet(i, waarde) en daarna afnemen() voor wat aaneensluitend
 * vanaf het begin klaarligt. De PDF krijgt zijn pagina's zo in de gevraagde
 * volgorde, terwijl latere pagina's al gerenderd worden.
 */
export function maakVolgorde() {
  const klaar = new Map();
  let volgende = 0;
  return {
    zet(i, waarde) { klaar.set(i, waarde); },
    afnemen() {
      const uit = [];
      while (klaar.has(volgende)) {
        uit.push(klaar.get(volgende));
        klaar.delete(volgende);
        volgende++;
      }
      return uit;
    },
    get volgende() { return volgende; },
  };
}

/** Mag een pagina over alle workers verspreid worden? Niet bij extreem zware
 *  inhoud: dan zou elke worker zelf de hele inhoud parsen (gigabytes). Zelfde
 *  grens als het progressieve renderpad (SCENE_CONTENT_BYTES). */
export const ZWARE_INHOUD_BYTES = 6_000_000;
export function spreidOverWorkers(inhoudBytes) {
  return !(Number(inhoudBytes) > ZWARE_INHOUD_BYTES);
}
