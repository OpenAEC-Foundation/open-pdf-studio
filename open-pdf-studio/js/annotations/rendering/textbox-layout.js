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
  const base = { bold: !!ann?.fontBold, italic: !!ann?.fontItalic };
  const runs = ann?.textRuns;
  if (Array.isArray(runs) && runs.length && runsToText(runs) === text) {
    return runs.map(line => (line || []).map(r => ({
      text: String(r?.text ?? ''), bold: !!r?.bold, italic: !!r?.italic,
      ...(r?.color ? { color: r.color } : {}),
    })));
  }
  return text.split('\n').map(t => (t ? [{ text: t, ...base }] : []));
}

/** Heeft het vlak opmaak die afwijkt van de basisstijl (dus echte runs)? */
export function hasMixedRuns(ann) {
  const lines = textboxLineRuns(ann);
  const base = { bold: !!ann?.fontBold, italic: !!ann?.fontItalic };
  return lines.some(line => line.some(r => r.bold !== base.bold || r.italic !== base.italic || r.color));
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
      if (laatste && laatste.bold === !!r.bold && laatste.italic === !!r.italic && (laatste.color || null) === (r.color || null)) {
        laatste.text += ch;
      } else {
        huidig.delen.push({ text: ch, bold: !!r.bold, italic: !!r.italic, ...(r.color ? { color: r.color } : {}) });
      }
      if (ch === ' ') { huidig.eindigtMetSpatie = true; woorden.push(huidig); huidig = null; }
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
    if (p && p.bold === d.bold && p.italic === d.italic && (p.color || null) === (d.color || null)) p.text += d.text;
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
 * Breekt de regels van een tekstvlak af op `maxWidth`.
 * @returns {Array<{chunks: Array<{text,bold,italic,color?}>, width: number}>}
 *   Eén element per uitvoerregel; een lege bronregel geeft { chunks: [], width: 0 }.
 */
export function layoutTextboxLines(ann, maxWidth, measure) {
  const uit = [];
  for (const runs of textboxLineRuns(ann)) {
    if (!runs.length) { uit.push({ chunks: [], width: 0 }); continue; }
    const woorden = woordenVanRegel(runs);
    let regel = [];      // delen van de lopende regel (inclusief scheidings-spaties)
    let eerste = true;
    for (const w of woorden) {
      const kandidaat = trimEinde(voegSamen([...regel, ...w.delen]));
      if (!eerste && meetDelen(kandidaat, measure) > maxWidth) {
        const klaar = trimEinde(voegSamen(regel));
        uit.push({ chunks: klaar, width: meetDelen(klaar, measure) });
        regel = [...w.delen];
      } else {
        regel = [...regel, ...w.delen];
      }
      eerste = false;
    }
    const klaar = trimEinde(voegSamen(regel));
    if (klaar.length) uit.push({ chunks: klaar, width: meetDelen(klaar, measure) });
  }
  return uit;
}
