// Regelindeling van een tekstvlak met inline opmaak (runs).
//
// Een tekstvlak heeft een basisstijl (fontBold/fontItalic van het hele vlak)
// en optioneel `textRuns`: per regel (gesplitst op '\n') een reeks
// { text, bold, italic } die delen van de tekst een eigen vet/cursief geeft.
// De runs zijn absoluut (bold:true = vet, ongeacht de basisstijl) en zijn
// alleen geldig als hun platte tekst gelijk is aan `text`; anders zijn ze
// verouderd en telt alleen de basisstijl.
//
// Deze module is puur: het meten van tekst gebeurt via een meegegeven
// `measure(text, bold, italic)` zodat renderer, saver en tests dezelfde
// regelafbraak krijgen.

/**
 * Hoe ver de tekst van een tekstvlak van de rand van het vak begint: de inzet
 * die het bestand opgeeft (textPadding, zie inzetUitDsMarge), anders de
 * lijndikte, zonder minimum. Canvas, editor en opslag gebruiken deze ene regel.
 */
export function textboxTekstInzet(ann) {
  return ann?.textPadding ?? ann?.lineWidth ?? 0;
}

/**
 * De tekstinzet van een vak met een /DS-marge. Gemeten in de appearances van
 * zulke bestanden (horizontaal en verticaal): randdikte + marge + 1.
 */
export function inzetUitDsMarge(lineWidth, marge) {
  return (lineWidth ?? 0) + marge + 1;
}

/**
 * Hoeveel de tekst van een vak met /DS-inzet over de doos mag lopen voordat
 * die groeit: de onderinzet plus de halve regelafstand onder de laatste regel
 * (geen tekst). Zo houdt de loader de doos die de schrijver tekende.
 */
export function tolerantieVoorDsInzet(inzet, fontSize, lineSpacing) {
  const fs = fontSize > 0 ? fontSize : 0;
  const ls = lineSpacing > 0 ? lineSpacing : STANDAARD_REGELAFSTAND;
  return inzet + Math.max(0, (fs * ls - fs) / 2);
}

/**
 * Groei van een vak in de inline editor, in px. Een vak met /DS-inzet volgt
 * dezelfde regel als de loader (tolerantieVoorDsInzet): openen en sluiten
 * zonder wijziging laat het dan even groot. onderinzetPx is de onderste
 * padding van de editor, dus de inzet op de huidige schaal.
 */
export function editorGroei(overloopPx, ann, onderinzetPx) {
  if (!(overloopPx > 0)) return 0;
  if (ann?.textPadding == null || !(ann.textPadding > 0) || !(onderinzetPx > 0)) return overloopPx;
  const schaal = onderinzetPx / ann.textPadding;
  const ruimte = tolerantieVoorDsInzet(ann.textPadding, ann.fontSize, ann.lineSpacing) * schaal;
  return overloopPx > ruimte ? overloopPx : 0;
}

/** Terug naar de /DS-marge bij opslaan (omgekeerde van inzetUitDsMarge). */
export function dsMargeUitInzet(inzet, lineWidth) {
  return Math.max(0, Math.round((inzet - (lineWidth ?? 0) - 1) * 1000) / 1000);
}

/**
 * Zet de randdikte. Verandert die echt, dan vervalt een tekstinzet uit het
 * bestand: wie de rand wijzigt, krijgt de regel van de app terug (tekst op
 * randdikte). Dezelfde dikte opnieuw zetten (stijl plakken) laat hem staan.
 */
export function zetRanddikte(ann, lineWidth) {
  if (ann.lineWidth === lineWidth) return;
  ann.lineWidth = lineWidth;
  if (ann.textPadding != null) delete ann.textPadding;
}

/** De breedte waarop de tekst van een tekstvlak afbreekt, in paginapunten. */
export function textboxTekstBreedte(ann) {
  return (ann?.width || 150) - 2 * textboxTekstInzet(ann);
}

/**
 * Het knipvlak voor de tekst op het canvas: het vak met 2 pt speling, want
 * andere lezers tonen tekst die net over de rand loopt. Een typemachine-tekst
 * (noWrap) breekt niet af en mag horizontaal over het vak lopen: geen knipvlak.
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
export function tekstvakKnipvlak(ann, breedte, hoogte) {
  if (ann?.noWrap) return null;
  return { x: ann.x - 2, y: ann.y - 2, width: breedte + 4, height: hoogte + 4 };
}

/** Platte tekst van run-regels. */
export function runsToText(lines) {
  return (lines || []).map(r => (r || []).map(x => String(x?.text ?? '')).join('')).join('\n');
}

/**
 * De run-regels van een tekstvlak: `textRuns` als die bij `text` horen,
 * anders elke regel als één run in de basisstijl.
 */
export function textboxLineRuns(ann) {
  const text = String(ann?.text ?? '');
  const base = {
    bold: !!ann?.fontBold, italic: !!ann?.fontItalic,
    ...(ann?.fontUnderline ? { underline: true } : {}),
    ...(ann?.fontStrikethrough ? { strikethrough: true } : {}),
  };
  const runs = ann?.textRuns;
  if (Array.isArray(runs) && runs.length && runsToText(runs) === text) {
    return runs.map(line => (line || []).map(r => ({
      text: String(r?.text ?? ''), bold: !!r?.bold, italic: !!r?.italic,
      ...(r?.color ? { color: r.color } : {}),
      ...(r?.underline ? { underline: true } : {}),
      ...(r?.strikethrough ? { strikethrough: true } : {}),
    })));
  }
  return text.split('\n').map(t => (t ? [{ text: t, ...base }] : []));
}

/** Heeft het vlak opmaak die afwijkt van de basisstijl (dus echte runs)? */
export function hasMixedRuns(ann) {
  const lines = textboxLineRuns(ann);
  const base = { bold: !!ann?.fontBold, italic: !!ann?.fontItalic };
  return lines.some(line => line.some(r => r.bold !== base.bold || r.italic !== base.italic || r.color
    || r.underline || r.strikethrough));
}

// CJK text (Chinese/Japanese/Korean) has no spaces between "words" — every
// character is its own valid break point, unlike space-delimited scripts.
// Without this, a whole CJK sentence became a single unbreakable "word"
// below (nothing to split on but a space that never comes), so it just
// overflowed the box's width instead of wrapping like other editors do.
function isCJK(ch) {
  const cp = ch.codePointAt(0);
  return (
    (cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Unified Ideographs Extension A
    (cp >= 0x3040 && cp <= 0x30FF) ||   // Hiragana + Katakana
    (cp >= 0xAC00 && cp <= 0xD7A3) ||   // Hangul syllables
    (cp >= 0x3000 && cp <= 0x303F) ||   // CJK punctuation
    (cp >= 0xFF00 && cp <= 0xFFEF)      // Fullwidth forms
  );
}

// Splits runs in woorden mét hun stijl. Spaties horen bij het woord ervoor
// (als scheidingsteken), zodat de regelafbraak per woord kan beslissen.
function woordenVanRegel(runs) {
  const woorden = [];
  let huidig = null;
  for (const r of runs) {
    const t = String(r.text ?? '');
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (!huidig) huidig = { delen: [], eindigtMetSpatie: false };
      const laatste = huidig.delen[huidig.delen.length - 1];
      if (laatste && laatste.bold === !!r.bold && laatste.italic === !!r.italic && (laatste.color || null) === (r.color || null)
        && !!laatste.underline === !!r.underline && !!laatste.strikethrough === !!r.strikethrough) {
        laatste.text += ch;
      } else {
        huidig.delen.push({
          text: ch, bold: !!r.bold, italic: !!r.italic, ...(r.color ? { color: r.color } : {}),
          ...(r.underline ? { underline: true } : {}),
          ...(r.strikethrough ? { strikethrough: true } : {}),
        });
      }
      if (ch === ' ') { huidig.eindigtMetSpatie = true; woorden.push(huidig); huidig = null; }
      else if (isCJK(ch)) { woorden.push(huidig); huidig = null; }
    }
  }
  if (huidig) woorden.push(huidig);
  return woorden;
}

const meetDelen = (delen, measure) => delen.reduce((w, d) => w + measure(d.text, d.bold, d.italic), 0);

// Voeg delen samen met dezelfde stijl (aangrenzend).
function voegSamen(delen) {
  const uit = [];
  for (const d of delen) {
    if (!d.text) continue;
    const p = uit[uit.length - 1];
    if (p && p.bold === d.bold && p.italic === d.italic && (p.color || null) === (d.color || null)
      && !!p.underline === !!d.underline && !!p.strikethrough === !!d.strikethrough) p.text += d.text;
    else uit.push({ ...d });
  }
  return uit;
}

// Spatie aan het einde van een regel telt niet mee (canvas tekent hem niet).
function trimEinde(delen) {
  const uit = delen.map(d => ({ ...d }));
  while (uit.length) {
    const l = uit[uit.length - 1];
    l.text = l.text.replace(/ +$/, '');
    if (l.text) break;
    uit.pop();
  }
  return uit;
}

/**
 * Breekt de regels van een tekstvlak af op `maxWidth`. Een typemachine-tekst
 * (`noWrap`, /IT /FreeTextTypewriter) breekt alleen op een harde
 * regelovergang en mag breder zijn dan het vak.
 * @returns {Array<{chunks: Array<{text,bold,italic,color?,underline?,strikethrough?}>, width: number}>}
 *   Eén element per uitvoerregel; een lege bronregel geeft { chunks: [], width: 0 }.
 */
export function layoutTextboxLines(ann, maxWidth, measure) {
  const uit = [];
  const afbreken = !ann?.noWrap;
  for (const runs of textboxLineRuns(ann)) {
    if (!runs.length) { uit.push({ chunks: [], width: 0 }); continue; }
    const woorden = woordenVanRegel(runs);
    let regel = [];      // delen van de lopende regel (inclusief scheidings-spaties)
    let regelBreedte = 0; // lopende breedte van `regel` — bijgehouden i.p.v.
    // elke iteratie opnieuw de HELE kandidaat-regel te meten. Voor CJK-tekst
    // is elk teken een eigen "woord" (zie woordenVanRegel), dus zonder dit
    // werd de groeiende regel bij ELK teken opnieuw volledig samengevoegd +
    // gemeten — O(n²) canvas-measureText-aanroepen die een tekstvlak met
    // een paar honderd Chinese tekens de hoofdthread seconden liet blokkeren.
    let eerste = true;
    for (const w of woorden) {
      const woordBreedte = meetDelen(w.delen, measure);
      // De pas-het-nog-check gebruikt de breedte ZONDER een evt. spatie aan
      // het eind van dit woord (zoals trimEinde op de hele kandidaat-regel
      // vroeger deed) — een woord dat alleen dankzij zijn eigen afsluitende
      // spatie net over maxWidth gaat, hoort niet vroegtijdig af te breken.
      const woordBreedteVoorPast = meetDelen(trimEinde(w.delen), measure);
      if (afbreken && !eerste && regelBreedte + woordBreedteVoorPast > maxWidth) {
        const klaar = trimEinde(voegSamen(regel));
        uit.push({ chunks: klaar, width: meetDelen(klaar, measure) });
        regel = [...w.delen];
        regelBreedte = woordBreedte;
      } else {
        regel = [...regel, ...w.delen];
        regelBreedte += woordBreedte;
      }
      eerste = false;
    }
    const klaar = trimEinde(voegSamen(regel));
    if (klaar.length) uit.push({ chunks: klaar, width: meetDelen(klaar, measure) });
  }
  return uit;
}

// Regelafstand en hoogte bij het inladen van een FreeText/callout.
//
// Sommige bestanden geven in /DS een regelhoogte die veel groter is dan de
// letter (bijvoorbeeld 4pt tekst met line-height:18.4pt). De eerste basislijn
// ligt een regelhoogte onder de bovenrand, dus zo'n regel valt buiten de doos:
// vroeger verdween de tekst, en de groei-tot-passend-regel liet de doos daarna
// meegroeien over de tekening heen. Regel:
//  1. past de inhoud in de doos, dan verandert er niets;
//  2. bij een onwaarschijnlijke regelafstand (meer dan 2x de lettergrootte)
//     wordt de afstand verkleind tot de inhoud in de oorspronkelijke doos
//     past (minimaal 1x); de doos blijft even groot;
//  3. anders, of als ook afstand 1x niet past, groeit de doos.
export const STANDAARD_REGELAFSTAND = 1.2;
export const MAX_AANNEMELIJKE_REGELAFSTAND = 2;

/**
 * @param {{ lineSpacing?: number, fontSize: number, boxHeight: number,
 *           padding?: number, neededHeight: number, tolerantie?: number }} o
 *   neededHeight is de uitkomst van computeTextboxContentHeight met dezelfde
 *   lineSpacing en padding: padding*2 + regels*fontSize*lineSpacing.
 * @returns {{ lineSpacing: (number|undefined), height: number }}
 */
export function pasRegelafstandAanDoos({ lineSpacing, fontSize, boxHeight, padding = 0, neededHeight, tolerantie = 0 }) {
  // tolerantie: zoveel mag de tekst de doos overschrijden voordat die groeit
  // (een /DS-inzet: de schrijver gebruikt de onderinzet mee). Groeit hij toch,
  // dan naar de volle hoogte.
  if (!(neededHeight - tolerantie > boxHeight)) return { lineSpacing, height: boxHeight };
  if (!(fontSize > 0)) return { lineSpacing, height: neededHeight };
  const ls = lineSpacing > 0 ? lineSpacing : STANDAARD_REGELAFSTAND;
  const regels = Math.max(1, Math.round((neededHeight - padding * 2) / (fontSize * ls)));
  if (ls > MAX_AANNEMELIJKE_REGELAFSTAND) {
    const passend = (boxHeight - padding * 2) / (regels * fontSize);
    if (passend >= 1) {
      return { lineSpacing: Math.round(Math.min(ls, passend) * 1000) / 1000, height: boxHeight };
    }
    const hoogte = padding * 2 + regels * fontSize * STANDAARD_REGELAFSTAND;
    return {
      lineSpacing: STANDAARD_REGELAFSTAND,
      height: Math.max(boxHeight, Math.round(hoogte * 1000) / 1000),
    };
  }
  return { lineSpacing, height: neededHeight };
}
