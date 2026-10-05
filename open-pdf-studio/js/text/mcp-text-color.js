const compact = text => String(text || '').replace(/\s+/g, '');
const byte = value => Math.round(Math.max(0, Math.min(1, Number(value))) * 255);
const hex = (red, green, blue) => `#${[red, green, blue]
  .map(value => byte(value).toString(16).padStart(2, '0')).join('')}`;

/** Match PDF.js text items to painted glyphs, retaining the active fill colour. */
export function textItemColors(items, operatorList, OPS) {
  const painted = [];
  // PDF graphics state starts with black fill even when no colour operator is
  // present before the first text run.
  let color = '#000000';
  const stack = [];
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const op = operatorList.fnArray[i], args = operatorList.argsArray[i];
    if (op === OPS.save) stack.push(color);
    else if (op === OPS.restore) color = stack.pop() ?? '#000000';
    else if (op === OPS.setFillRGBColor) {
      const value = args?.[0];
      color = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
    } else if (op === OPS.setFillGray) {
      const value = args?.[0];
      color = typeof value === 'number' && Number.isFinite(value) ? hex(value, value, value) : null;
    } else if (op === OPS.setFillCMYKColor) {
      const value = args?.[0];
      if (Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)) {
        const [cyan, magenta, yellow, black] = value;
        color = hex((1 - cyan) * (1 - black), (1 - magenta) * (1 - black),
          (1 - yellow) * (1 - black));
      } else color = null;
    } else if (op === OPS.setFillColor || op === OPS.setFillColorN) {
      color = null; // arbitrary colour spaces are not reliably RGB
    } else if (op === OPS.showText || op === OPS.showSpacedText
        || op === OPS.nextLineShowText || op === OPS.nextLineSetSpacingShowText) {
      const glyphs = Array.isArray(args?.[0]) ? args[0] : [];
      for (const glyph of glyphs) {
        if (typeof glyph !== 'object' || typeof glyph?.unicode !== 'string') continue;
        for (const character of compact(glyph.unicode).split('')) painted.push({ character, color });
      }
    }
  }
  const letters = painted.map(entry => entry.character).join('');
  const colors = Array(items.length).fill(null);
  let cursor = 0;
  for (let index = 0; index < items.length; index++) {
    const value = compact(items[index]?.str);
    if (!value) continue;
    const at = letters.startsWith(value, cursor) ? cursor : letters.indexOf(value, cursor);
    if (at < 0 || at - cursor > 200) continue;
    const segment = painted.slice(at, at + value.length);
    const counts = new Map();
    for (const glyph of segment) if (glyph.color) counts.set(glyph.color, (counts.get(glyph.color) || 0) + 1);
    colors[index] = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    cursor = at + value.length;
  }
  return colors;
}
