// Rekenregels voor een tekening die op de huidige pagina gelegd wordt (#400):
// de maat op schaal, de plek op de pagina, en het rasterplan voor de stand
// "als afbeelding".
//
// Geen imports uit de app: de unit-tests draaien hier onder node op.

const PT_PER_MM = 72 / 25.4;
const MM_PER_MEETEENHEID = Object.freeze({ mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 });

/** Resoluties voor de stand "als afbeelding". */
export const ONDERLEGGER_DPI = Object.freeze([150, 300, 600]);
export const ONDERLEGGER_DPI_STANDAARD = 300;

/** Grootste afbeelding die gemaakt wordt; daarboven zakt de resolutie. */
export const MAX_RASTER_PIXELS = 64_000_000;
/** Langste zijde van de afbeelding in beeldpunten (grens van een tekenvlak). */
export const MAX_RASTER_ZIJDE = 16_000;
/** Grootste strook die in één keer gerasterd wordt (past in het gedeelde geheugen van de renderer). */
export const STROOK_PIXELS = 12_000_000;

/** Dekking uit een percentage, tussen 5 % en 100 %. */
export function dekkingUitProcent(procent) {
  const n = Number(procent);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(100, Math.max(5, n)) / 100;
}

/**
 * De schaalnoemer N (1:N) van een meetschaal `{pixelsPerUnit, unit}`, of null
 * als er geen bruikbare meetschaal is. `pixelsPerUnit` is in paginapunten per
 * meeteenheid; precies 1 punt per mm is de terugval "geen schaal".
 */
export function paginaNoemer(meetschaal) {
  const ppu = Number(meetschaal?.pixelsPerUnit);
  const mm = MM_PER_MEETEENHEID[meetschaal?.unit || 'mm'];
  if (!(ppu > 0) || !mm || !Number.isFinite(ppu)) return null;
  if (ppu === 1 && mm === 1) return null;
  const noemer = (PT_PER_MM * mm) / ppu;
  return noemer > 0 && Number.isFinite(noemer) ? noemer : null;
}

/**
 * Factor waarmee de omgezette pagina op ware grootte over de tekening valt:
 * de pagina is gemaakt op 1:`bladNoemer`, de doelpagina staat op
 * 1:`paginaNoemer`. Een layout (papierruimte) heeft geen modelschaal: null.
 * @returns {number|null}
 */
export function onderleggerFactor(bladNoemer, meetschaal, isModel = true) {
  if (!isModel) return null;
  const blad = Number(bladNoemer);
  const pagina = paginaNoemer(meetschaal);
  if (!(blad > 0) || !pagina) return null;
  const factor = blad / pagina;
  return factor > 0 && Number.isFinite(factor) ? factor : null;
}

/**
 * Het vak van het object op de pagina (punten, linksboven, y omlaag), in het
 * midden. Met een factor op schaal; zonder factor op papiermaat, passend
 * verkleind als het blad groter is dan de pagina.
 * @param {{breedte:number, hoogte:number}} bladPt
 * @param {{breedte:number, hoogte:number}|null} paginaPt
 * @param {number|null} factor
 * @returns {{x:number, y:number, width:number, height:number, factor:number, opSchaal:boolean}|null}
 */
export function onderleggerVak(bladPt, paginaPt, factor = null) {
  const b = Number(bladPt?.breedte);
  const h = Number(bladPt?.hoogte);
  if (!(b > 0) || !(h > 0)) return null;
  const pb = Number(paginaPt?.breedte);
  const ph = Number(paginaPt?.hoogte);
  const heeftPagina = pb > 0 && ph > 0;
  const opSchaal = Number(factor) > 0 && Number.isFinite(Number(factor));
  let f = opSchaal ? Number(factor) : 1;
  if (!opSchaal && heeftPagina) f = Math.min(1, pb / b, ph / h);
  const width = b * f;
  const height = h * f;
  return {
    x: heeftPagina ? (pb - width) / 2 : 0,
    y: heeftPagina ? (ph - height) / 2 : 0,
    width,
    height,
    factor: f,
    opSchaal,
  };
}

/**
 * Plan voor het rasteren van een blad: de maat in beeldpunten op de gevraagde
 * resolutie, begrensd op een veilig aantal beeldpunten en een langste zijde,
 * en verdeeld in liggende stroken die elk in één keer gerasterd worden.
 * @param {{breedte:number, hoogte:number}} bladPt  maat van het blad in punten
 * @param {number} dpi
 * @returns {{breedtePx:number, hoogtePx:number, dpi:number, schaal:number, begrensd:boolean,
 *   stroken:{yPx:number, hoogtePx:number}[]}|null}  `schaal` is beeldpunten per punt
 */
export function rasterPlan(bladPt, dpi, grenzen = {}) {
  const b = Number(bladPt?.breedte);
  const h = Number(bladPt?.hoogte);
  if (!(b > 0) || !(h > 0)) return null;
  const maxPixels = Number(grenzen.maxPixels) > 0 ? Number(grenzen.maxPixels) : MAX_RASTER_PIXELS;
  const maxZijde = Number(grenzen.maxZijde) > 0 ? Number(grenzen.maxZijde) : MAX_RASTER_ZIJDE;
  const strookPixels = Number(grenzen.strookPixels) > 0 ? Number(grenzen.strookPixels) : STROOK_PIXELS;
  const gevraagd = ONDERLEGGER_DPI.includes(Number(dpi)) ? Number(dpi) : ONDERLEGGER_DPI_STANDAARD;
  let schaal = gevraagd / 72;
  const teVeel = Math.sqrt((b * schaal * h * schaal) / maxPixels);
  if (teVeel > 1) schaal /= teVeel;
  const teLang = (Math.max(b, h) * schaal) / maxZijde;
  if (teLang > 1) schaal /= teLang;
  const breedtePx = Math.max(1, Math.floor(b * schaal));
  const hoogtePx = Math.max(1, Math.floor(h * schaal));
  const perStrook = Math.max(1, Math.floor(strookPixels / breedtePx));
  const stroken = [];
  for (let y = 0; y < hoogtePx; y += perStrook) stroken.push({ yPx: y, hoogtePx: Math.min(perStrook, hoogtePx - y) });
  return {
    breedtePx,
    hoogtePx,
    dpi: schaal * 72,
    schaal,
    begrensd: schaal * 72 < gevraagd - 1e-9,
    stroken,
  };
}

/**
 * Rasterplan voor een blad dat in `vak` op de pagina komt. De beeldpunten
 * volgen de maat op de pagina (`vak.width` × `vak.height`), niet de bladmaat:
 * een blad dat op schaal wordt uitgerekt krijgt zo echt de gekozen resolutie,
 * en een groot blad dat verkleind wordt kost geen geheugen voor beeldpunten
 * die toch niet te zien zijn. `bronSchaal` is beeldpunten per punt van het
 * blad zelf: daarmee wordt het gerasterd, zodat het beeld het vak precies vult.
 * @param {{width:number, height:number, factor:number}|null} vak  uit `onderleggerVak`
 * @returns {(ReturnType<typeof rasterPlan> & {bronSchaal:number})|null}
 */
export function rasterPlanVoorVak(vak, dpi, grenzen = {}) {
  const plan = rasterPlan({ breedte: vak?.width, hoogte: vak?.height }, dpi, grenzen);
  if (!plan) return null;
  const factor = Number(vak.factor) > 0 && Number.isFinite(Number(vak.factor)) ? Number(vak.factor) : 1;
  return { ...plan, bronSchaal: plan.schaal * factor };
}

/**
 * Maakt het witte papier van een gerasterd blad doorzichtig, in de buffer
 * zelf: over wit gelegd geeft elke beeldpunt precies de oude kleur terug, over
 * een tekening schijnt die erdoorheen. RGBA, niet voorvermenigvuldigd.
 * @param {Uint8ClampedArray|Uint8Array} rgba
 */
export function witNaarDoorzichtig(rgba) {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const bl = rgba[i + 2];
    const dekking = 255 - Math.min(r, g, bl);
    if (dekking === 0) {
      rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
      continue;
    }
    if (dekking < 255) {
      const k = 255 / dekking;
      rgba[i] = Math.max(0, Math.round(255 - (255 - r) * k));
      rgba[i + 1] = Math.max(0, Math.round(255 - (255 - g) * k));
      rgba[i + 2] = Math.max(0, Math.round(255 - (255 - bl) * k));
    }
    rgba[i + 3] = Math.round((dekking * rgba[i + 3]) / 255);
  }
  return rgba;
}
