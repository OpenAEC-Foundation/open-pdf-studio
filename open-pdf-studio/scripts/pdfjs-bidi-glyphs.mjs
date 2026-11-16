// Backport of mozilla/pdf.js #22521, commit
// 5f2d7186f72c87e40150314c5cf856133f0b2466 (src/core/bidi.js, evaluator.js, fonts.js).
// Copyright Mozilla Foundation, Apache-2.0:
// https://www.apache.org/licenses/LICENSE-2.0
// #1078: behoud de logische tekst binnen een glyph bij bidi-herschikking;
// normaliseer per glyph, met een niet-serialiseerbare cache zoals upstream.
// Verwijder pas na kwalificatie van een pdfjs-dist-release met deze fix.
const REPLACEMENTS = [
  [
    `function findUnequal(arr, start, value) {
  let j, jj;
  for (j = start, jj = arr.length; j < jj; ++j) {
    if (arr[j] !== value) {
      return j;
    }
  }
  return j;
}
`,
    `function findUnequal(arr, start, value, end = arr.length) {
  for (let j = start; j < end; ++j) {
    if (arr[j] !== value) {
      return j;
    }
  }
  return end;
}
`
  ],
  [
    `function bidi(str, startLevel = -1, vertical = false) {
  let isLTR = true;
`,
    `function bidi(text, startLevel = -1, vertical = false) {
  let isLTR = true;
  const glyphs = Array.isArray(text) ? text : null;
  const str = glyphs ? glyphs.join("") : text;
`
  ],
  [
    `  for (level = highestLevel; level >= lowestOddLevel; --level) {`,
    `  if (glyphs) {
    let pos = 0;
    for (const glyph of glyphs) {
      const end = pos + glyph.length;
      if (glyph.length > 1 && findUnequal(levels, pos + 1, levels[pos], end) === end) {
        // Keep each same-level glyph intact while retaining level indices (#1078).
        chars[pos] = glyph;
        chars.fill("", pos + 1, end);
      }
      pos = end;
    }
  }
  for (level = highestLevel; level >= lowestOddLevel; --level) {`
  ],
  [
    `  for (i = 0, ii = chars.length; i < ii; ++i) {
    const ch = chars[i];
    if (ch === "<" || ch === ">") {
      chars[i] = "";
    }
  }
  return createBidiText(chars.join(""), isLTR);`,
    `  return createBidiText(chars.join("").replaceAll(/[<>]/g, ""), isLTR);`
  ],
  [
    `    function runBidiTransform(textChunk) {
      let text = textChunk.str.join("");
      if (!disableNormalization) {
        text = normalizeUnicode(text);
      }
      const bidiResult = bidi(text, -1, textChunk.vertical);`,
    `    function runBidiTransform(textChunk) {
      const bidiResult = bidi(textChunk.str, -1, textChunk.vertical);`
  ],
  [
    `          textChunk.str.push(glyphUnicode);`,
    `          textChunk.str.push(disableNormalization ? glyphUnicode : glyph.normalizedUnicode);`
  ],
  [
    `  get category() {
    return util_shadow(this, "category", getCharUnicodeCategory(this.unicode), true);
  }
}`,
    `  get category() {
    return util_shadow(this, "category", getCharUnicodeCategory(this.unicode), true);
  }
  get normalizedUnicode() {
    return util_shadow(this, "normalizedUnicode", normalizeUnicode(this.unicode), true);
  }
}`
  ],
];

export function patchBidiGlyphs(source) {
  // Validate all sites before replacing any. A partial patch or dependency
  // drift must fail closed; tolerate only a complete idempotent reapplication.
  // Webpack names shadow differently in the modern and legacy workers.
  const replacements = source.includes('function util_shadow(') ? REPLACEMENTS
    : REPLACEMENTS.map(pair => pair.map(part => part.replaceAll('util_shadow', 'shadow')));
  const clean = replacements.every(([before]) => source.split(before).length === 2);
  const patched = replacements.every(([, after]) => source.split(after).length === 2)
    && replacements.every(([before, after]) => source.split(before).length - 1 === (after.includes(before) ? 1 : 0));
  if (patched) return source;
  if (!clean || replacements.some(([, after]) => source.includes(after))) {
    throw new Error('PDF.js bidi glyph patch no longer matches; qualify the worker before updating PDF.js (#1078).');
  }
  for (const [before, after] of replacements) source = source.replace(before, after);
  return source;
}
