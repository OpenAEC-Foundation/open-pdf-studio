// The stroke colour an appearance stream draws its border with.
//
// The loader only recognised `r g b RG`. Other programs set the same colour
// with `SC`/`SCN` after choosing a colour space, in CMYK (`K`) or as a grey
// (`G`); the border of such a text box then came back black. This reads all
// of them and returns the colour that is in effect at the first stroke, which
// is the border. A stream without a stroke gives the first colour it sets.

const GETAL = '(-?\\d*\\.?\\d+)';
const KLEUR = new RegExp(`(?:${GETAL}\\s+${GETAL}\\s+${GETAL}\\s+${GETAL}\\s+(K|SCN|SC)|${GETAL}\\s+${GETAL}\\s+${GETAL}\\s+(RG|SCN|SC)|${GETAL}\\s+(G|SCN|SC))(?![A-Za-z*])`, 'g');
// Path painting that strokes: S, s, B, B*, b, b*.
const LIJN = /(?:^|[\s\]>)])(S|s|B\*?|b\*?)(?=\s|$)/g;

const hex = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

function naarHex(delen) {
  const n = delen.map(Number);
  if (n.some((v) => !Number.isFinite(v))) return null;
  if (n.length === 1) return `#${hex(n[0])}${hex(n[0])}${hex(n[0])}`;
  if (n.length === 3) return `#${hex(n[0])}${hex(n[1])}${hex(n[2])}`;
  const [c, m, y, k] = n;
  return `#${hex((1 - c) * (1 - k))}${hex((1 - m) * (1 - k))}${hex((1 - y) * (1 - k))}`;
}

/**
 * @param {string} inhoud  the decoded content stream
 * @returns {string|null} `#rrggbb`, or null when the stream sets no stroke colour
 */
export function lijnkleurUitAp(inhoud) {
  if (typeof inhoud !== 'string' || !inhoud) return null;
  const kleuren = [];
  for (const m of inhoud.matchAll(KLEUR)) {
    const delen = m[5] ? [m[1], m[2], m[3], m[4]] : m[9] ? [m[6], m[7], m[8]] : [m[10]];
    const kleur = naarHex(delen);
    if (kleur) kleuren.push({ plek: m.index, kleur });
  }
  if (!kleuren.length) return null;
  LIJN.lastIndex = 0;
  const eerste = LIJN.exec(inhoud);
  if (!eerste) return kleuren[0].kleur;
  const voor = kleuren.filter((k) => k.plek < eerste.index);
  return (voor.length ? voor[voor.length - 1] : kleuren[0]).kleur;
}
