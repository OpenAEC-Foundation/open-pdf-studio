// Rekenregels van de Verkenner-rechtermuisknop-acties (#945), zonder Tauri of
// DOM zodat ze los getest worden (shell-acties-logica.test.mjs). De
// bedrading staat in shell-acties.js, de installer-kant in
// src-tauri/nsis/hooks.nsh en de opdrachtregel in src-tauri/src/verkenner_acties.rs.

/** Afbeeldingen die "Omzetten naar PDF" kent (zelfde lijst als de installer). */
export const AFBEELDING = /\.(jpe?g|png|bmp|gif|webp)$/i;
/** Tekeningen: die gaan door het bestaande CAD-importvenster. */
export const CAD = /\.(dwg|dxf)$/i;
export const PDF = /\.pdf$/i;

/** Hoe lang de app na de laatste Verkenner-start wacht op de rest van de selectie. */
export const VERZAMEL_MS = 900;

export const naamVan = (pad) => String(pad).split(/[\\/]/).pop();

const sorteerder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Natuurlijke naamvolgorde op bestandsnaam: `S1.2` voor `S1.10`, hoofdletters
 * gelijk aan kleine letters. Bij gelijke naam beslist het volledige pad, zodat
 * de volgorde vast ligt.
 */
export function vergelijkNatuurlijk(a, b) {
  return sorteerder.compare(naamVan(a), naamVan(b)) || sorteerder.compare(String(a), String(b));
}

/** Kopie in natuurlijke volgorde, dubbele paden eruit. */
export function natuurlijkGesorteerd(paden) {
  return [...new Set(paden)].sort(vergelijkNatuurlijk);
}

/**
 * Zet de acties uit de Rust-wachtrij (`{ mode, files }`) om naar twee lijsten.
 * Onbekende modi en bestandstypen die bij de actie niet horen vallen weg:
 * combineren neemt PDF's en afbeeldingen, omzetten afbeeldingen en tekeningen.
 */
export function verdeelActies(acties) {
  const combine = [];
  const convert = [];
  for (const a of acties || []) {
    if (!a || !Array.isArray(a.files)) continue;
    for (const f of a.files) {
      if (typeof f !== 'string' || !f) continue;
      if (a.mode === 'combine' && (PDF.test(f) || AFBEELDING.test(f))) combine.push(f);
      else if (a.mode === 'convert' && (AFBEELDING.test(f) || CAD.test(f))) convert.push(f);
    }
  }
  return { combine, convert };
}

/** Het PDF-pad naast een bron: `naam.pdf`, en bij `n` > 1 `naam (n).pdf`. */
export function pdfPadNaast(bron, n = 1) {
  const basis = String(bron).replace(/\.[^.\\/]+$/, '');
  return n > 1 ? `${basis} (${n}).pdf` : `${basis}.pdf`;
}

/**
 * Schrijft naar het eerste vrije PDF-pad naast `bron`. `schrijfNieuw` mag
 * nooit overschrijven en gooit `CHOOSE_NEW_FILE` als het pad al bestaat
 * (platform.writeBinaryFileNew), dus ook een race met een ander programma
 * overschrijft niets.
 * @returns {Promise<string>} het geschreven pad
 */
export async function schrijfNaastBron(bron, bytes, schrijfNieuw, { maxPogingen = 999 } = {}) {
  for (let n = 1; n <= maxPogingen; n++) {
    const doel = pdfPadNaast(bron, n);
    try {
      await schrijfNieuw(doel, bytes);
      return doel;
    } catch (e) {
      if (String(e?.message ?? e) !== 'CHOOSE_NEW_FILE') throw e;
    }
  }
  throw new Error(`no free PDF name next to ${bron}`);
}

/** Paginamaat in punten voor een afbeelding van `breedte` x `hoogte` pixels op 96 dpi. */
export function paginaMaatVoorAfbeelding(breedte, hoogte) {
  return { breedte: breedte * 0.75, hoogte: hoogte * 0.75 };
}

/**
 * Verzamelt de bestanden van één Verkenner-selectie: elke `seintje()` schuift
 * de verwerking `wachtMs` op; daarna roept hij `verwerk()` een keer aan.
 */
export function maakVerzamelaar(verwerk, { wachtMs = VERZAMEL_MS, zetTimer = setTimeout, wisTimer = clearTimeout } = {}) {
  let timer = null;
  return {
    seintje() {
      if (timer !== null) wisTimer(timer);
      timer = zetTimer(() => { timer = null; verwerk(); }, wachtMs);
    },
    wachtend: () => timer !== null,
  };
}

/**
 * Wat het venster "PDF's samenvoegen" laat zien. `data.combineNew` (Verkenner
 * "Combineren tot één PDF") maakt er een venster voor een NIEUW document van:
 * eigen titel en knop, geen rij "Invoegen op". `data.files` staat er dan
 * meteen in, in natuurlijke volgorde.
 */
export function mergeVensterModus(data) {
  const combineNew = !!data?.combineNew;
  const files = Array.isArray(data?.files) ? data.files.filter((f) => typeof f === 'string' && f) : [];
  return {
    combineNew,
    titelSleutel: combineNew ? 'mergePdfs.combineTitle' : 'mergePdfs.title',
    knopSleutel: combineNew ? 'mergePdfs.combineButton' : null,
    toonInvoegpositie: !combineNew,
    beginBestanden: combineNew ? natuurlijkGesorteerd(files) : files,
  };
}

/**
 * Combineert `paden` tot een NIEUW naamloos document: het eerste bestand
 * wordt het document (een kopie, het origineel blijft onaangeroerd), de rest
 * gaat er achter. Het document dat open stond wordt nooit aangeraakt: lukt
 * het maken van het nieuwe document niet, dan wordt er niets samengevoegd.
 * @param {string[]} paden
 * @param {{ maakNieuw: (pad: string) => Promise<void>,
 *           voegSamen: (paden: string[], positie: string) => Promise<object>,
 *           actiefDocument: () => object|null|undefined }} deps
 */
export async function combineerTotNieuwDocument(paden, { maakNieuw, voegSamen, actiefDocument }) {
  if (!Array.isArray(paden) || paden.length === 0) return { ok: false, reden: 'no-files' };
  const voor = actiefDocument();
  const voorPad = voor?.filePath ?? null;
  await maakNieuw(paden[0]);
  const na = actiefDocument();
  if (!na?.pdfDoc || !na.isUntitled || (na.filePath ?? null) === voorPad) {
    return { ok: false, reden: 'not-created' };
  }
  if (paden.length === 1) return { ok: true, verslag: null };
  return { ok: true, verslag: await voegSamen(paden.slice(1), 'end') };
}
